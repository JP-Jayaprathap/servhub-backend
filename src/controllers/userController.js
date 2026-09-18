const bcrypt = require("bcryptjs");
const User = require("../models/userModel");
const DeleteRequest = require("../models/deleteRequestModel");
const {
  canAssignRole,
  generatePassword,
  hasPrivilege,
  scopedUserQuery,
  toPublicUser,
} = require("../utils/privileges");
const { logAudit } = require("../utils/audit");

const listUsers = async (req, res) => {
  try {
    const users = await User.find(scopedUserQuery(req.user)).sort({ name: 1 });
    res.status(200).json({ users: users.map(toPublicUser) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const DEFAULT_USER_CREATE_LIMIT = 5;

async function countCreatedBy(actorId) {
  return User.countDocuments({ createdBy: actorId });
}

const createUser = async (req, res) => {
  try {
    if (!hasPrivilege(req.user, "users", "create")) {
      return res.status(403).json({ message: "You cannot create users" });
    }

    const { name, email, password, role, department, privileges, userCreateLimit } = req.body;
    const targetRole = role || "user";
    if (!canAssignRole(req.user, targetRole)) {
      return res.status(403).json({
        message: "You can only create Admin or User accounts.",
      });
    }

    const assignedDepartment =
      req.user.role === "super_admin" ? String(department || "").toLowerCase().trim() : req.user.department;
    if (!assignedDepartment) {
      return res.status(400).json({ message: "Department is required" });
    }

    if (req.user.role !== "super_admin") {
      const actor = await User.findById(req.user.id);
      const limit = Number(actor?.userCreateLimit ?? DEFAULT_USER_CREATE_LIMIT);
      const createdCount = await countCreatedBy(req.user.id);
      if (createdCount >= limit) {
        return res.status(403).json({
          message: `User create limit reached (${createdCount}/${limit}). Ask Super Admin to raise your authority.`,
          createdCount,
          userCreateLimit: limit,
        });
      }
    }

    const exists = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    if (exists) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const plainPassword = password && String(password).length >= 6 ? password : generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    const nextLimit =
      req.user.role === "super_admin" && targetRole === "admin" && userCreateLimit !== undefined
        ? Math.max(0, Number(userCreateLimit) || DEFAULT_USER_CREATE_LIMIT)
        : DEFAULT_USER_CREATE_LIMIT;

    const user = await User.create({
      name,
      email: String(email).toLowerCase().trim(),
      password: hashedPassword,
      role: targetRole,
      department: assignedDepartment,
      privileges: {
        allow: req.user.role === "super_admin" ? privileges?.allow || [] : [],
        deny: req.user.role === "super_admin" ? privileges?.deny || [] : [],
      },
      userCreateLimit: targetRole === "admin" ? nextLimit : DEFAULT_USER_CREATE_LIMIT,
      createdBy: req.user.id,
    });

    res.status(201).json({
      message: "User created",
      user: toPublicUser(user),
      password: plainPassword,
    });
    await logAudit({
      action: "create",
      module: "users",
      summary: `Created user ${user.name} (${user.email})`,
      actor: req.user,
      targetType: "user",
      targetId: user._id.toString(),
      meta: { role: user.role, department: user.department },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    if (!hasPrivilege(req.user, "users", "edit")) {
      return res.status(403).json({ message: "You cannot update users" });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role === "super_admin" && req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Cannot update super admin" });
    }
    if (req.user.role !== "super_admin" && user.department !== req.user.department) {
      return res.status(403).json({ message: "You can only update users in your department" });
    }

    const { name, email, password, role, department, privileges, userCreateLimit, active } = req.body;
    if (role && role !== user.role && !canAssignRole(req.user, role)) {
      return res.status(403).json({ message: "You cannot assign this role" });
    }

    if (name) user.name = name;
    if (email) user.email = String(email).toLowerCase().trim();
    if (role) user.role = role;
    if (req.user.role === "super_admin" && department !== undefined) {
      user.department = String(department || "").toLowerCase().trim();
    }
    if (req.user.role === "super_admin" && privileges) {
      user.privileges = {
        allow: privileges.allow || [],
        deny: privileges.deny || [],
      };
    }
    if (req.user.role === "super_admin" && userCreateLimit !== undefined) {
      user.userCreateLimit = Math.max(0, Number(userCreateLimit) || DEFAULT_USER_CREATE_LIMIT);
    }
    if (active !== undefined) {
      if (user.role === "super_admin") {
        return res.status(403).json({ message: "Cannot deactivate super admin" });
      }
      if (user._id.toString() === req.user.id) {
        return res.status(400).json({ message: "You cannot deactivate your own account" });
      }
      if (!hasPrivilege(req.user, "users", "edit") && !hasPrivilege(req.user, "users", "delete")) {
        return res.status(403).json({ message: "You cannot change user status" });
      }
      user.active = Boolean(active);
    }
    if (password) user.password = await bcrypt.hash(password, 10);
    await user.save();

    await logAudit({
      action: active === false ? "deactivate" : active === true ? "activate" : "update",
      module: "users",
      summary:
        active === false
          ? `Deactivated user ${user.name} (${user.email})`
          : active === true
            ? `Activated user ${user.name} (${user.email})`
            : `Updated user ${user.name} (${user.email})`,
      actor: req.user,
      targetType: "user",
      targetId: user._id.toString(),
      meta: {
        userCreateLimit: user.userCreateLimit,
        active: user.active !== false,
        privileges: user.privileges,
      },
    });

    res.status(200).json({ message: "User updated", user: toPublicUser(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }
    if (user.role === "super_admin") {
      return res.status(403).json({ message: "Super admin cannot be deleted" });
    }

    if (!hasPrivilege(req.user, "users", "delete")) {
      return res.status(403).json({
        message: "You cannot delete users. Send a delete request to super admin.",
      });
    }

    await DeleteRequest.deleteMany({ targetId: user._id, status: "pending" });
    const snapshot = { name: user.name, email: user.email, role: user.role };
    await user.deleteOne();
    await logAudit({
      action: "delete",
      module: "users",
      summary: `Deleted user ${snapshot.name} (${snapshot.email})`,
      actor: req.user,
      targetType: "user",
      targetId: req.params.id,
      meta: snapshot,
    });
    res.status(200).json({ message: "User deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const requestDelete = async (req, res) => {
  try {
    if (!hasPrivilege(req.user, "users", "create") && !hasPrivilege(req.user, "users", "edit")) {
      return res.status(403).json({ message: "You cannot request user deletion" });
    }
    if (hasPrivilege(req.user, "users", "delete")) {
      return res.status(400).json({ message: "You already have delete access. Delete the user directly." });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ message: "You cannot request deletion of your own account" });
    }
    if (user.role === "super_admin") {
      return res.status(403).json({ message: "Super admin cannot be deleted" });
    }
    if (req.user.role !== "super_admin" && user.department !== req.user.department) {
      return res.status(403).json({ message: "You can only request deletes in your department" });
    }

    const existing = await DeleteRequest.findOne({ targetId: user._id, status: "pending" });
    if (existing) {
      return res.status(409).json({ message: "A delete request is already pending for this user" });
    }

    const request = await DeleteRequest.create({
      targetType: "user",
      targetId: user._id,
      targetSnapshot: { name: user.name, email: user.email, role: user.role, department: user.department },
      reason: req.body.reason || "",
      requestedBy: req.user.id,
      status: "pending",
    });

    await logAudit({
      action: "request_delete",
      module: "users",
      summary: `Requested delete for ${user.name} (${user.email})`,
      actor: req.user,
      targetType: "user",
      targetId: user._id.toString(),
      meta: { reason: req.body.reason || "" },
    });

    res.status(201).json({
      message: "Delete request sent to super admin",
      request,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const { name, email } = req.body;
    if (name) user.name = name;
    if (email) {
      const nextEmail = String(email).toLowerCase().trim();
      const exists = await User.findOne({ email: nextEmail, _id: { $ne: user._id } });
      if (exists) return res.status(409).json({ message: "Email already in use" });
      user.email = nextEmail;
    }
    await user.save();
    res.status(200).json({ message: "Profile updated", user: toPublicUser(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: "Current password is incorrect" });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await logAudit({
      action: "password_change",
      module: "auth",
      summary: `${user.name} changed password`,
      actor: req.user,
      targetType: "user",
      targetId: user._id.toString(),
    });
    res.status(200).json({ message: "Password updated" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createQuota = async (req, res) => {
  try {
    if (req.user.role === "super_admin") {
      return res.status(200).json({ unlimited: true, createdCount: 0, userCreateLimit: null });
    }
    if (!hasPrivilege(req.user, "users", "create")) {
      return res.status(403).json({ message: "You cannot create users" });
    }
    const actor = await User.findById(req.user.id);
    const limit = Number(actor?.userCreateLimit ?? DEFAULT_USER_CREATE_LIMIT);
    const createdCount = await countCreatedBy(req.user.id);
    res.status(200).json({
      unlimited: false,
      createdCount,
      userCreateLimit: limit,
      remaining: Math.max(0, limit - createdCount),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  requestDelete,
  updateProfile,
  changePassword,
  createQuota,
};
