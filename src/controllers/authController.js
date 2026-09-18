const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Role = require("../models/roleModel");
const Department = require("../models/departmentModel");
const { resolvePrivileges, toPublicUser, scopedUserQuery } = require("../utils/privileges");
const { logAudit } = require("../utils/audit");

function toPublicDepartment(item) {
  return {
    id: item._id.toString(),
    name: item.name,
    key: item.key,
    privileges: item.privileges || {},
  };
}

async function buildCatalog() {
  const roles = await Role.find().sort({ name: 1 });
  const departments = await Department.find().sort({ name: 1 });
  const rolePrivileges = Object.fromEntries(roles.map((role) => [role.key, role.privileges || {}]));
  const departmentPrivileges = Object.fromEntries(
    departments.map((item) => [item.key, item.privileges || {}])
  );
  return { roles, departments, rolePrivileges, departmentPrivileges };
}

async function sessionPayload(user) {
  const { roles, departments, rolePrivileges, departmentPrivileges } = await buildCatalog();
  const publicUser = toPublicUser(user);
  const role = roles.find((item) => item.key === user.role);
  const visibleUsers = await User.find(scopedUserQuery(publicUser)).sort({ name: 1 });
  return {
    user: publicUser,
    role: role ? { id: role._id.toString(), name: role.name, key: role.key } : { key: user.role, name: user.role },
    privileges: resolvePrivileges(user, rolePrivileges, departmentPrivileges),
    directory: {
      users: visibleUsers.map(toPublicUser),
      roles: roles.map((item) => ({ id: item._id.toString(), name: item.name, key: item.key })),
      departments: departments.map(toPublicDepartment),
      rolePrivileges,
      departmentPrivileges,
    },
  };
}

function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || "").toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      await logAudit({
        action: "login_failed",
        module: "auth",
        summary: `Failed sign-in attempt for ${normalizedEmail || "unknown"}`,
        actor: { name: "Unknown", email: normalizedEmail, role: "" },
        meta: { reason: "user_not_found" },
      });
      return res.status(404).json({ message: "Invalid email or password" });
    }

    const isPasswordCorrect = await bcrypt.compare(password || "", user.password);
    if (!isPasswordCorrect) {
      await logAudit({
        action: "login_failed",
        module: "auth",
        summary: `Failed sign-in for ${user.name} (${user.email})`,
        actor: user,
        targetType: "user",
        targetId: user._id.toString(),
        meta: { reason: "bad_password" },
      });
      return res.status(400).json({ message: "Invalid email or password" });
    }

    if (user.active === false) {
      await logAudit({
        action: "login_failed",
        module: "auth",
        summary: `Deactivated account sign-in blocked for ${user.name}`,
        actor: user,
        targetType: "user",
        targetId: user._id.toString(),
        meta: { reason: "inactive" },
      });
      return res.status(403).json({ message: "Account is deactivated. Contact Super Admin." });
    }

    const session = await sessionPayload(user);
    await logAudit({
      action: "login",
      module: "auth",
      summary: `${user.name} signed in`,
      actor: user,
      targetType: "user",
      targetId: user._id.toString(),
    });
    res.status(200).json({
      message: "Login successful",
      token: signToken(user),
      ...session,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const logout = async (req, res) => {
  try {
    await logAudit({
      action: "logout",
      module: "auth",
      summary: `${req.user.name} signed out`,
      actor: req.user,
      targetType: "user",
      targetId: req.user.id,
    });
    res.status(200).json({ message: "Logged out" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const me = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ message: "User no longer exists" });
    const session = await sessionPayload(user);
    res.status(200).json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const directory = async (req, res) => {
  try {
    const { roles, departments, rolePrivileges, departmentPrivileges } = await buildCatalog();
    const users = await User.find(scopedUserQuery(req.user)).sort({ name: 1 });
    res.status(200).json({
      users: users.map(toPublicUser),
      roles: roles.map((item) => ({ id: item._id.toString(), name: item.name, key: item.key })),
      departments: departments.map(toPublicDepartment),
      rolePrivileges,
      departmentPrivileges,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { login, logout, me, directory, sessionPayload, buildCatalog };
