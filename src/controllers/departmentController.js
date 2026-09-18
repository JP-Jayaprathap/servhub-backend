const Department = require("../models/departmentModel");
const User = require("../models/userModel");
const { logAudit } = require("../utils/audit");

function toPublic(item) {
  return {
    id: item._id.toString(),
    name: item.name,
    key: item.key,
    privileges: item.privileges || {},
  };
}

function slugKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const listDepartments = async (req, res) => {
  try {
    const { seedDepartments } = require("../data/seed");
    await seedDepartments();
    const departments = await Department.find().sort({ name: 1 });
    res.status(200).json({ departments: departments.map(toPublic) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveDepartment = async (req, res) => {
  try {
    const { name, key, privileges } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });
    const nextKey = slugKey(key || name);
    if (!nextKey) return res.status(400).json({ message: "A valid department key is required" });

    let department = req.params.id ? await Department.findById(req.params.id) : await Department.findOne({ key: nextKey });
    if (req.params.id && !department) return res.status(404).json({ message: "Department not found" });

    if (!department) {
      department = await Department.create({
        name,
        key: nextKey,
        privileges: privileges || { dashboard: ["view"] },
      });
      await logAudit({
        action: "create",
        module: "departments",
        summary: `Created department ${department.name}`,
        actor: req.user,
        targetType: "department",
        targetId: department._id.toString(),
      });
      return res.status(201).json({ message: "Department created", department: toPublic(department) });
    }

    const oldKey = department.key;
    department.name = name;
    department.key = nextKey;
    if (privileges) department.privileges = privileges;
    await department.save();

    if (oldKey !== nextKey) {
      await User.updateMany({ department: oldKey }, { department: nextKey });
    }

    await logAudit({
      action: "update",
      module: "departments",
      summary: `Updated department ${department.name}`,
      actor: req.user,
      targetType: "department",
      targetId: department._id.toString(),
    });

    res.status(200).json({ message: "Department updated", department: toPublic(department) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteDepartment = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) return res.status(404).json({ message: "Department not found" });
    const assigned = await User.countDocuments({ department: department.key });
    if (assigned > 0) {
      return res.status(400).json({ message: "Remove users from this department first" });
    }
    await department.deleteOne();
    await logAudit({
      action: "delete",
      module: "departments",
      summary: `Deleted department ${department.name}`,
      actor: req.user,
      targetType: "department",
      targetId: department._id.toString(),
    });
    res.status(200).json({ message: "Department deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { listDepartments, saveDepartment, deleteDepartment };
