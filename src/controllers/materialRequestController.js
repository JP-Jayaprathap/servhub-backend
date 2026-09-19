const MaterialRequest = require("../models/materialRequestModel");
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
  const list = Array.isArray(products) ? products.filter((item) => item?.name) : [];
  const quantity = list
    .map((item) => `${item.quantity || 0}${item.unit ? ` ${item.unit}` : ""} ${item.name}`.trim())
    .join(", ");
  const amount = list.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return { quantity, amount, products: list };
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
  if (role === "requestor") return String(record.requestedById) === actor.id;
  if (["manager", "department_head", "in_charge", "admin"].includes(role) || actor.role === "admin") {
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
    const { project, justification, products, status } = req.body;
    if (!project) return res.status(400).json({ message: "Project / Department is required" });
    const summary = summarizeProducts(products);
    if (!summary.products.length) {
      return res.status(400).json({ message: "Add at least one product row" });
    }

    const nextStatus = status === "Requested" ? "Requested" : "Draft";
    const department = String(req.user.department || "").trim().toLowerCase();
    if (!department) {
      return res.status(400).json({
        message: "Your profile has no department. Ask Super Admin to assign a department before creating MRs.",
      });
    }

    const mrNo = await nextMrNo();
    const record = await MaterialRequest.create({
      mrNo,
      project,
      justification: justification || "",
      products: summary.products,
      quantity: summary.quantity,
      amount: summary.amount,
      requestedBy: req.user.name,
      requestedById: req.user.id,
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
    res.status(500).json({ message: error.message });
  }
};

const updateRequest = async (req, res) => {
  try {
    const record = await MaterialRequest.findOne({ mrNo: req.params.id });
    if (!record) return res.status(404).json({ message: "Material request not found" });
    if (!canAccessRecord(req.user, record)) {
      return res.status(403).json({ message: "You cannot update this material request" });
    }

    const { project, justification, products, status, supplier, paymentStatus, quotation } = req.body;
    const previousStatus = record.status;
    const contentChange =
      Boolean(project) ||
      justification !== undefined ||
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
    if (Array.isArray(products)) {
      const summary = summarizeProducts(products);
      if (!summary.products.length) {
        return res.status(400).json({ message: "Add at least one product row" });
      }
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
    res.status(500).json({ message: error.message });
  }
};

const deleteRequest = async (req, res) => {
  try {
    const record = await MaterialRequest.findOne({ mrNo: req.params.id });
    if (!record) return res.status(404).json({ message: "Material request not found" });
    const role = normalizeRole(req.user.role);

    if (role === "requestor") {
      if (String(record.requestedById) !== req.user.id) {
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

module.exports = { listRequests, getRequest, createRequest, updateRequest, deleteRequest };
