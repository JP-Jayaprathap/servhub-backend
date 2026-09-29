const MaterialRequest = require("../models/materialRequestModel");
const Material = require("../models/materialModel");
const Department = require("../models/departmentModel");
const User = require("../models/userModel");
const ProjectManager = require("../models/projectManagerModel");
const { hasPrivilege, scopedMrFilter, normalizeRole } = require("../utils/privileges");
const { logAudit } = require("../utils/audit");
const {
  EDITABLE_STATUSES,
  findTransition,
  isEditableStatus,
} = require("../workflow/materialRequestFlow");

function formatDate(value = new Date()) {
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function summarizeProducts(products = []) {
  const list = Array.isArray(products)
    ? products
        .filter((item) => (item?.productId || item?.name) && String(item?.quantity || "").trim())
        .map((item) => ({
          productId: String(item.productId || "").trim().toUpperCase(),
          name: String(item.name || "").trim(),
          description: String(item.description || "").trim(),
          quantity: String(item.quantity || "").trim(),
          unit: String(item.unit || "").trim(),
          amount: Number(item.amount) || 0,
        }))
    : [];
  const quantity = list
    .map((item) => `${item.quantity || 0}${item.unit ? ` ${item.unit}` : ""} ${item.name}`.trim())
    .join(", ");
  const amount = list.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return { quantity, amount, products: list };
}

async function resolveDepartmentKey(value, fallback) {
  const key = String(value || fallback || "").trim().toLowerCase();
  if (!key) {
    const error = new Error("Select a department");
    error.statusCode = 400;
    throw error;
  }
  const department = await Department.findOne({ key });
  if (!department) {
    const error = new Error("Select a valid department");
    error.statusCode = 400;
    throw error;
  }
  return department.key;
}

async function resolveCreatedFor(createdForId, departmentKey) {
  if (!createdForId || !User.base.Types.ObjectId.isValid(createdForId)) {
    const error = new Error("Select who this request is created for");
    error.statusCode = 400;
    throw error;
  }
  const requester = await User.findOne({
    _id: createdForId,
    department: departmentKey,
    active: { $ne: false },
  });
  if (!requester) {
    const error = new Error("Select a user from this department");
    error.statusCode = 400;
    throw error;
  }
  return requester;
}

async function resolveProjectManager(project, departmentKey) {
  const projectKey = String(project || "").trim().toLowerCase();
  if (!projectKey || !departmentKey) return null;
  const appointment = await ProjectManager.findOne({ projectKey, department: departmentKey });
  if (!appointment?.managerId) return null;
  return User.findOne({ _id: appointment.managerId, active: { $ne: false } });
}

async function requireProjectManager(project, departmentKey) {
  const manager = await resolveProjectManager(project, departmentKey);
  if (!manager) {
    const error = new Error("No manager is appointed for this department on this project");
    error.statusCode = 400;
    throw error;
  }
  return manager;
}

function sameProject(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

async function resolveCatalogLines(products, departmentKey, projectName) {
  const project = String(projectName || "").trim();
  if (!project) {
    const error = new Error("Select a project");
    error.statusCode = 400;
    throw error;
  }
  const summary = summarizeProducts(products);
  if (!summary.products.length) {
    const error = new Error("Add at least one material row");
    error.statusCode = 400;
    throw error;
  }
  if (summary.products.some((item) => !item.productId)) {
    const error = new Error("Select a product id for each row");
    error.statusCode = 400;
    throw error;
  }

  const ids = [...new Set(summary.products.map((item) => item.productId))];
  const materials = await Material.find({
    productId: { $in: ids },
    department: departmentKey,
    active: { $ne: false },
  });
  const byId = new Map(materials.map((item) => [item.productId, item]));
  const lines = summary.products.map((item) => {
    const material = byId.get(item.productId);
    if (!material) {
      const error = new Error(`Product ${item.productId} is not listed for this department`);
      error.statusCode = 400;
      throw error;
    }
    if (!sameProject(material.project, project)) {
      const error = new Error(`Product ${item.productId} is not listed for this project`);
      error.statusCode = 400;
      throw error;
    }
    return {
      productId: material.productId,
      name: material.name,
      description: item.description || "",
      quantity: item.quantity,
      unit: material.unit || "",
      amount: item.amount,
    };
  });
  const quantity = lines
    .map((item) => `${item.quantity}${item.unit ? ` ${item.unit}` : ""} ${item.name}`.trim())
    .join(", ");
  const amount = lines.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return { products: lines, quantity, amount };
}

async function nextMrNo() {
  const year = new Date().getFullYear();
  const prefix = `MR-${year}-`;
  const latest = await MaterialRequest.findOne({ mrNo: new RegExp(`^${prefix}`) })
    .sort({ mrNo: -1 })
    .select("mrNo");
  const last = latest?.mrNo ? Number(String(latest.mrNo).split("-").pop()) : 1000;
  const next = Number.isFinite(last) ? last + 1 : 1001;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function toPublic(record) {
  return {
    id: record.mrNo,
    mrNo: record.mrNo,
    project: record.project,
    requestedBy: record.requestedBy,
    requestedById: record.requestedById ? String(record.requestedById) : "",
    createdBy: record.createdBy || "",
    createdById: record.createdById ? String(record.createdById) : "",
    assignedTo: record.assignedTo || "",
    assignedToId: record.assignedToId ? String(record.assignedToId) : "",
    department: record.department || "",
    justification: record.justification || "",
    products: record.products || [],
    quantity: record.quantity || "",
    amount: record.amount || 0,
    supplier: record.supplier || "",
    quotation: record.quotation || "",
    status: record.status,
    paymentStatus: record.paymentStatus,
    date: record.date,
    createdAt: record.createdAt,
  };
}

function canAccessRecord(actor, record) {
  const role = normalizeRole(actor.role);
  if (actor.role === "super_admin") return true;
  if (["procurement", "finance"].includes(role)) return true;
  if (role === "supplier") {
    return [
      "RFQ Issued",
      "Ordered",
      "In transit",
      "PO Rejected",
      "Pending Receipt",
    ].includes(record.status);
  }
  if (role === "requestor") {
    return String(record.requestedById) === actor.id || String(record.createdById) === actor.id;
  }
  if (role === "manager") {
    if (record.assignedToId) return String(record.assignedToId) === actor.id;
    const actorDept = String(actor.department || "").trim().toLowerCase();
    const recordDept = String(record.department || "").trim().toLowerCase();
    return !recordDept || !actorDept || recordDept === actorDept;
  }
  if (["department_head", "in_charge", "admin"].includes(role) || actor.role === "admin") {
    const actorDept = String(actor.department || "").trim().toLowerCase();
    if (!actorDept) return true;
    const recordDept = String(record.department || "").trim().toLowerCase();
    // Allow same department, or legacy MRs with no department set
    return !recordDept || recordDept === actorDept;
  }
  return String(record.requestedById) === actor.id;
}

function hasTransitionPrivilege(actor, transition) {
  if (actor.role === "super_admin") return true;
  if (!transition?.privilege) {
    return (
      hasPrivilege(actor, "material_requests", "edit") ||
      hasPrivilege(actor, "approvals", "approve") ||
      hasPrivilege(actor, "approvals", "reject") ||
      hasPrivilege(actor, "purchase_orders", "edit") ||
      hasPrivilege(actor, "deliveries", "edit") ||
      hasPrivilege(actor, "procurement", "edit")
    );
  }
  const [moduleKey, action] = transition.privilege.split(".");
  return hasPrivilege(actor, moduleKey, action);
}

const listAssignees = async (req, res) => {
  try {
    const canLoad =
      hasPrivilege(req.user, "material_requests", "create") ||
      hasPrivilege(req.user, "material_requests", "edit");
    if (!canLoad) return res.status(403).json({ message: "You cannot load requesters" });

    const department = await resolveDepartmentKey(req.query.department);
    const requesters = await User.find({
      department,
      active: { $ne: false },
    })
      .sort({ name: 1 })
      .select("name");
    const manager = await resolveProjectManager(req.query.project, department);
    res.status(200).json({
      requesters: requesters.map((item) => ({
        id: item._id.toString(),
        name: item.name,
        email: item.email,
      })),
      manager: manager ? { id: manager._id.toString(), name: manager.name } : null,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const listRequests = async (req, res) => {
  try {
    const filter = scopedMrFilter(req.user);
    const rows = await MaterialRequest.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ materialRequests: rows.map(toPublic) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getRequest = async (req, res) => {
  try {
    const record = await MaterialRequest.findOne({ mrNo: req.params.id });
    if (!record) return res.status(404).json({ message: "Material request not found" });
    if (!canAccessRecord(req.user, record)) {
      return res.status(403).json({ message: "You cannot view this material request" });
    }
    res.status(200).json({ materialRequest: toPublic(record) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createRequest = async (req, res) => {
  try {
    if (!hasPrivilege(req.user, "material_requests", "create")) {
      return res.status(403).json({ message: "You cannot create material requests" });
    }
    const { project, justification, products, status, department: departmentInput, createdForId } = req.body;
    if (!project) return res.status(400).json({ message: "Project is required" });

    const nextStatus = status === "Requested" ? "Requested" : "Draft";
    const department = await resolveDepartmentKey(departmentInput, req.user.department);
    const requester = await resolveCreatedFor(createdForId, department);
    const manager =
      nextStatus === "Requested"
        ? await requireProjectManager(project, department)
        : await resolveProjectManager(project, department);
    const summary = await resolveCatalogLines(products, department, project);

    const mrNo = await nextMrNo();
    const record = await MaterialRequest.create({
      mrNo,
      project,
      justification: justification || "",
      products: summary.products,
      quantity: summary.quantity,
      amount: summary.amount,
      requestedBy: requester.name,
      requestedById: requester._id,
      createdBy: req.user.name,
      createdById: req.user.id,
      assignedTo: manager?.name || "",
      assignedToId: manager?._id,
      department,
      status: nextStatus,
      paymentStatus: "Not started",
      date: formatDate(),
    });

    res.status(201).json({ message: "Material request created", materialRequest: toPublic(record) });
    await logAudit({
      action: "create",
      module: "material_requests",
      summary: `Created ${record.mrNo} (${record.status})`,
      actor: req.user,
      targetType: "material_request",
      targetId: record.mrNo,
      meta: { project: record.project, status: record.status },
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const updateRequest = async (req, res) => {
  try {
    const record = await MaterialRequest.findOne({ mrNo: req.params.id });
    if (!record) return res.status(404).json({ message: "Material request not found" });
    if (!canAccessRecord(req.user, record)) {
      return res.status(403).json({ message: "You cannot update this material request" });
    }

    const { project, justification, products, status, supplier, paymentStatus, quotation, department, createdForId } =
      req.body;
    const previousStatus = record.status;
    const contentChange =
      Boolean(project) ||
      justification !== undefined ||
      department !== undefined ||
      createdForId !== undefined ||
      Array.isArray(products);
    const statusChange = Boolean(status) && status !== previousStatus;
    const quotationUpdate = quotation !== undefined;
    const role = normalizeRole(req.user.role);

    if (contentChange) {
      if (!hasPrivilege(req.user, "material_requests", "edit")) {
        return res.status(403).json({ message: "You cannot edit material request content" });
      }
      if (!isEditableStatus(record.status)) {
        return res.status(403).json({
          message: "Sent requests cannot be edited. Only Draft or Returned requests can be changed.",
        });
      }
    }

    if (quotationUpdate) {
      const canQuote =
        req.user.role === "super_admin" ||
        role === "supplier" ||
        role === "procurement";
      if (!canQuote) {
        return res.status(403).json({ message: "You cannot submit quotations" });
      }
      if (!String(quotation || "").trim()) {
        return res.status(400).json({ message: "Quotation text is required" });
      }
      record.quotation = String(quotation).trim();
      if (supplier !== undefined) record.supplier = String(supplier).trim();
      else if (role === "supplier" && !record.supplier) {
        record.supplier = req.user.name;
      }
    }

    if (statusChange) {
      const transition = findTransition(req.user.role, previousStatus, status);
      if (!transition) {
        return res.status(403).json({
          message: `Your role cannot move this request from "${previousStatus}" to "${status}".`,
        });
      }
      if (!hasTransitionPrivilege(req.user, transition)) {
        return res.status(403).json({ message: "Missing privilege for this workflow action" });
      }
      if (transition.requiresQuotation && !String(record.quotation || quotation || "").trim()) {
        return res.status(400).json({ message: "Enter quotation text before continuing" });
      }
    } else if (!contentChange && !paymentStatus && supplier === undefined && !quotationUpdate) {
      if (!hasPrivilege(req.user, "material_requests", "edit")) {
        return res.status(403).json({ message: "You cannot update material requests" });
      }
    }

    if (project) record.project = project;
    if (justification !== undefined) record.justification = justification;
    if (department) record.department = await resolveDepartmentKey(department);
    if (createdForId) {
      const requester = await resolveCreatedFor(createdForId, record.department);
      record.requestedBy = requester.name;
      record.requestedById = requester._id;
    }
    const nextStatus = statusChange ? status : record.status;
    if (department || createdForId || nextStatus === "Requested") {
      const manager =
        nextStatus === "Requested"
          ? await requireProjectManager(record.project, record.department)
          : await resolveProjectManager(record.project, record.department);
      if (manager) {
        record.assignedTo = manager.name;
        record.assignedToId = manager._id;
      }
    }
    if (Array.isArray(products)) {
      const summary = await resolveCatalogLines(products, record.department, record.project);
      record.products = summary.products;
      record.quantity = summary.quantity;
      record.amount = summary.amount;
    }
    if (statusChange) {
      record.status = status;
      if (["Ordered", "PO Issued"].includes(status) && record.paymentStatus === "Not started") {
        record.paymentStatus = "Open";
      }
      if (["Delivered", "Closed"].includes(status)) {
        record.paymentStatus = "Released";
      }
    }
    if (supplier !== undefined && !quotationUpdate) record.supplier = supplier;
    if (paymentStatus) record.paymentStatus = paymentStatus;
    await record.save();

    await logAudit({
      action: statusChange ? "status_change" : quotationUpdate ? "quotation" : "update",
      module: "material_requests",
      summary: statusChange
        ? `${record.mrNo}: ${previousStatus} → ${record.status}`
        : quotationUpdate
          ? `Quotation updated on ${record.mrNo}`
          : `Updated ${record.mrNo}`,
      actor: req.user,
      targetType: "material_request",
      targetId: record.mrNo,
      meta: { status: record.status, previousStatus },
    });
    res.status(200).json({ message: "Material request updated", materialRequest: toPublic(record) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const deleteRequest = async (req, res) => {
  try {
    const record = await MaterialRequest.findOne({ mrNo: req.params.id });
    if (!record) return res.status(404).json({ message: "Material request not found" });
    const role = normalizeRole(req.user.role);

    if (role === "requestor") {
      const ownsRecord =
        String(record.requestedById) === req.user.id || String(record.createdById) === req.user.id;
      if (!ownsRecord) {
        return res.status(403).json({ message: "You can only delete your own draft requests" });
      }
      if (!EDITABLE_STATUSES.includes(record.status)) {
        return res.status(403).json({ message: "Only draft or returned requests can be deleted" });
      }
    } else if (!hasPrivilege(req.user, "material_requests", "delete")) {
      return res.status(403).json({ message: "You cannot delete material requests" });
    }

    await record.deleteOne();
    await logAudit({
      action: "delete",
      module: "material_requests",
      summary: `Deleted ${record.mrNo}`,
      actor: req.user,
      targetType: "material_request",
      targetId: record.mrNo,
    });
    res.status(200).json({ message: "Material request deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { listAssignees, listRequests, getRequest, createRequest, updateRequest, deleteRequest };
