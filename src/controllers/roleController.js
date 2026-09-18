const Role = require("../models/roleModel");
const User = require("../models/userModel");
const { hasPrivilege } = require("../utils/privileges");

const listRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ name: 1 });
    res.status(200).json({
      roles: roles.map((item) => ({
        id: item._id.toString(),
        name: item.name,
        key: item.key,
        privileges: item.privileges || {},
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveRole = async (req, res) => {
  try {
    const { name, key, privileges, previousKey } = req.body;
    if (!name || !key) {
      return res.status(400).json({ message: "Name and key are required" });
    }
    if (key === "super_admin" && req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Cannot change super admin" });
    }

    let role = req.params.id ? await Role.findById(req.params.id) : await Role.findOne({ key });
    if (req.params.id && !role) return res.status(404).json({ message: "Role not found" });

    if (!role) {
      if (!hasPrivilege(req.user, "roles", "create")) {
        return res.status(403).json({ message: "You cannot create roles" });
      }
      role = await Role.create({
        name,
        key,
        privileges: privileges || { dashboard: ["view"] },
      });
      return res.status(201).json({ message: "Role created", role });
    }

    if (!hasPrivilege(req.user, "roles", "edit") && !hasPrivilege(req.user, "privileges", "edit")) {
      return res.status(403).json({ message: "You cannot update roles" });
    }

    const oldKey = previousKey || role.key;
    role.name = name;
    role.key = key;
    if (privileges) role.privileges = privileges;
    await role.save();

    if (oldKey !== key) {
      await User.updateMany({ role: oldKey }, { role: key });
    }

    res.status(200).json({ message: "Role updated", role });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteRole = async (req, res) => {
  try {
    if (!hasPrivilege(req.user, "roles", "delete")) {
      return res.status(403).json({ message: "You cannot delete roles" });
    }
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });
    if (["super_admin", "admin", "user"].includes(role.key)) {
      return res.status(400).json({ message: "This system role cannot be deleted" });
    }
    const assigned = await User.countDocuments({ role: role.key });
    if (assigned > 0) {
      return res.status(400).json({ message: "Remove users from this role first" });
    }
    await role.deleteOne();
    res.status(200).json({ message: "Role deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { listRoles, saveRole, deleteRole };
