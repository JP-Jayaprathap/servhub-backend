const MaterialRequest = require("../models/materialRequestModel");
const { hasPrivilege } = require("../utils/privileges");
const { logAudit } = require("../utils/audit");

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
    status: record.status,
    paymentStatus: record.paymentStatus,
    date: record.date,
    createdAt: record.createdAt,
  };
}

const listRequests = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === "user") {
      filter.requestedById = req.user.id;
    } else if (req.user.role === "admin" && req.user.department) {
      filter.department = req.user.department;
    }
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
    if (req.user.role === "user" && String(record.requestedById) !== req.user.id) {
      return res.status(403).json({ message: "You can only view your own requests" });
    }
    if (
      req.user.role === "admin" &&
      req.user.department &&
      record.department &&
      record.department !== req.user.department
    ) {
      return res.status(403).json({ message: "You can only view requests in your department" });
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
      department: req.user.department || "",
      status: status || "Draft",
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

const editableStatuses = ["Draft", "Returned"];

const updateRequest = async (req, res) => {
  try {
    if (!hasPrivilege(req.user, "material_requests", "edit")) {
      return res.status(403).json({ message: "You cannot update material requests" });
    }
    const record = await MaterialRequest.findOne({ mrNo: req.params.id });
    if (!record) return res.status(404).json({ message: "Material request not found" });
    if (req.user.role === "user" && String(record.requestedById) !== req.user.id) {
      return res.status(403).json({ message: "You can only update your own requests" });
    }

    const { project, justification, products, status, supplier, paymentStatus } = req.body;
    const previousStatus = record.status;
    const contentChange =
      Boolean(project) ||
      justification !== undefined ||
      Array.isArray(products) ||
      supplier !== undefined;

    if (contentChange && !editableStatuses.includes(record.status)) {
      return res.status(403).json({
        message: "Sent requests cannot be edited. Only Draft or Returned requests can be changed.",
      });
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
    if (status) record.status = status;
    if (supplier !== undefined) record.supplier = supplier;
    if (paymentStatus) record.paymentStatus = paymentStatus;
    await record.save();
    await logAudit({
      action: status && status !== previousStatus ? "status_change" : "update",
      module: "material_requests",
      summary: `Updated ${record.mrNo} → ${record.status}`,
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
    if (!hasPrivilege(req.user, "material_requests", "delete") && req.user.role !== "user") {
      return res.status(403).json({ message: "You cannot delete material requests" });
    }
    const record = await MaterialRequest.findOne({ mrNo: req.params.id });
    if (!record) return res.status(404).json({ message: "Material request not found" });
    if (req.user.role === "user") {
      if (String(record.requestedById) !== req.user.id) {
        return res.status(403).json({ message: "You can only delete your own draft requests" });
      }
      if (!editableStatuses.includes(record.status)) {
        return res.status(403).json({ message: "Only draft or returned requests can be deleted" });
      }
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
