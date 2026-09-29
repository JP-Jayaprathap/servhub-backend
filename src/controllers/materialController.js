const Material = require("../models/materialModel");
const Department = require("../models/departmentModel");
const User = require("../models/userModel");
const ProjectManager = require("../models/projectManagerModel");
const { logAudit } = require("../utils/audit");

function toPublic(item) {
  return {
    id: item._id.toString(),
    productId: item.productId,
    name: item.name,
    project: item.project || "",
    department: item.department,
    unit: item.unit || "",
    active: item.active !== false,
  };
}

function normalizeProductId(value) {
  return String(value || "").trim().toUpperCase();
}

async function requireDepartment(key) {
  const departmentKey = String(key || "").trim().toLowerCase();
  if (!departmentKey) {
    const error = new Error("Department is required");
    error.statusCode = 400;
    throw error;
  }
  const department = await Department.findOne({ key: departmentKey });
  if (!department) {
    const error = new Error("Select a valid department");
    error.statusCode = 400;
    throw error;
  }
  return department.key;
}

function projectKeyOf(value) {
  return String(value || "").trim().toLowerCase();
}

const listDepartmentManagers = async (req, res) => {
  try {
    const department = await requireDepartment(req.query.department);
    const managers = await User.find({
      department,
      role: "manager",
      active: { $ne: false },
    })
      .sort({ name: 1 })
      .select("name");
    const projectKey = projectKeyOf(req.query.project);
    const appointment = projectKey
      ? await ProjectManager.findOne({ projectKey, department })
      : null;
    res.status(200).json({
      managers: managers.map((item) => ({ id: item._id.toString(), name: item.name })),
      appointment: appointment
        ? { managerId: appointment.managerId.toString(), managerName: appointment.managerName }
        : null,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const saveProjectManager = async (req, res) => {
  try {
    const project = String(req.body.project || "").trim();
    const projectKey = projectKeyOf(project);
    if (!projectKey) return res.status(400).json({ message: "Project is required" });
    const department = await requireDepartment(req.body.department);
    if (!req.body.managerId || !User.base.Types.ObjectId.isValid(req.body.managerId)) {
      return res.status(400).json({ message: "Select the department manager for this project" });
    }
    const manager = await User.findOne({
      _id: req.body.managerId,
      department,
      role: "manager",
      active: { $ne: false },
    });
    if (!manager) {
      return res.status(400).json({ message: "Select a manager appointed for this department" });
    }

    const appointment = await ProjectManager.findOneAndUpdate(
      { projectKey, department },
      { project, projectKey, department, managerId: manager._id, managerName: manager.name },
      { upsert: true, returnDocument: "after" }
    );
    await logAudit({
      action: "update",
      module: "materials",
      summary: `Appointed ${manager.name} for ${project} / ${department}`,
      actor: req.user,
      targetType: "project_manager",
      targetId: appointment._id.toString(),
      meta: { project, department },
    });
    res.status(200).json({
      message: "Department manager appointed",
      appointment: { managerId: manager._id.toString(), managerName: manager.name, project, department },
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const listMaterials = async (req, res) => {
  try {
    const filter = { active: { $ne: false } };
    if (req.query.department) {
      filter.department = String(req.query.department).trim().toLowerCase();
    }
    if (req.query.project) {
      const escaped = String(req.query.project).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.project = new RegExp(`^${escaped}$`, "i");
    }
    const rows = await Material.find(filter).sort({ productId: 1 });
    res.status(200).json({ materials: rows.map(toPublic) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const saveMaterial = async (req, res) => {
  try {
    const { name, unit } = req.body;
    const productId = normalizeProductId(req.body.productId);
    const project = String(req.body.project || "").trim();
    if (!productId) return res.status(400).json({ message: "Product id is required" });
    if (!name || !String(name).trim()) return res.status(400).json({ message: "Name is required" });
    if (!project) return res.status(400).json({ message: "Project is required" });
    const department = await requireDepartment(req.body.department);

    const duplicate = await Material.findOne({
      productId,
      ...(req.params.id ? { _id: { $ne: req.params.id } } : {}),
    });
    if (duplicate) return res.status(400).json({ message: "Product id already exists" });

    let material = req.params.id ? await Material.findById(req.params.id) : null;
    if (req.params.id && !material) return res.status(404).json({ message: "Material not found" });

    if (!material) {
      material = await Material.create({
        productId,
        name: String(name).trim(),
        project,
        department,
        unit: String(unit || "").trim(),
        active: true,
      });
      await logAudit({
        action: "create",
        module: "materials",
        summary: `Added material ${material.productId} (${material.name})`,
        actor: req.user,
        targetType: "material",
        targetId: material._id.toString(),
        meta: { department: material.department, project: material.project },
      });
      return res.status(201).json({ message: "Material created", material: toPublic(material) });
    }

    material.productId = productId;
    material.name = String(name).trim();
    material.project = project;
    material.department = department;
    material.unit = String(unit || "").trim();
    material.active = true;
    await material.save();

    await logAudit({
      action: "update",
      module: "materials",
      summary: `Updated material ${material.productId}`,
      actor: req.user,
      targetType: "material",
      targetId: material._id.toString(),
      meta: { department: material.department, project: material.project },
    });
    res.status(200).json({ message: "Material updated", material: toPublic(material) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const deleteMaterial = async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ message: "Material not found" });
    await material.deleteOne();
    await logAudit({
      action: "delete",
      module: "materials",
      summary: `Deleted material ${material.productId}`,
      actor: req.user,
      targetType: "material",
      targetId: material._id.toString(),
    });
    res.status(200).json({ message: "Material deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  listMaterials,
  listDepartmentManagers,
  saveProjectManager,
  saveMaterial,
  deleteMaterial,
  requireDepartment,
  normalizeProductId,
};
