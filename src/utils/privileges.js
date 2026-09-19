const {
  WORKFLOW_ROLES,
  normalizeRole,
  listFilterForRole,
} = require("../workflow/materialRequestFlow");

function mergePrivilegeMaps(...maps) {
  const next = {};
  maps.forEach((map) => {
    Object.entries(map || {}).forEach(([moduleKey, actions]) => {
      if (!next[moduleKey]) next[moduleKey] = [];
      (actions || []).forEach((action) => {
        if (action && !next[moduleKey].includes(action)) next[moduleKey].push(action);
      });
    });
  });
  return next;
}

function resolvePrivileges(user, rolePrivileges = {}, departmentPrivileges = {}) {
  if (user.role === "super_admin") {
    return JSON.parse(JSON.stringify(rolePrivileges.super_admin || {}));
  }

  const roleKey = normalizeRole(user.role);
  const privileges = mergePrivilegeMaps(
    rolePrivileges[user.role] || rolePrivileges[roleKey] || {},
    user.role === "admin" ? departmentPrivileges[user.department] || {} : {}
  );

  (user.privileges?.allow || []).forEach((item) => {
    const [moduleKey, action] = String(item).split(".");
    if (!moduleKey || !action) return;
    if (!privileges[moduleKey]) privileges[moduleKey] = [];
    if (!privileges[moduleKey].includes(action)) privileges[moduleKey].push(action);
  });

  (user.privileges?.deny || []).forEach((item) => {
    const [moduleKey, action] = String(item).split(".");
    if (!moduleKey || !action || !privileges[moduleKey]) return;
    privileges[moduleKey] = privileges[moduleKey].filter((value) => value !== action);
  });

  return privileges;
}

function hasPrivilege(user, moduleKey, action = "view") {
  if (user.role === "super_admin") return true;
  return Boolean(user.privileges?.[moduleKey]?.includes(action));
}

const ASSIGNABLE_BY_ADMIN = ["requestor", "user"];
const ASSIGNABLE_BY_SUPER = [
  "admin",
  "requestor",
  "user",
  ...WORKFLOW_ROLES.filter((r) => r !== "requestor"),
];

function canAssignRole(actor, targetRole) {
  if (!targetRole) return false;
  if (targetRole === "super_admin") return false;
  if (actor.role === "super_admin") return ASSIGNABLE_BY_SUPER.includes(targetRole);
  if (actor.role === "admin") return ASSIGNABLE_BY_ADMIN.includes(targetRole);
  return false;
}

function scopedUserQuery(actor) {
  if (actor.role === "super_admin") return {};
  if (actor.role === "admin") {
    return {
      department: actor.department || "__none__",
      role: { $nin: ["super_admin"] },
    };
  }
  return {
    department: actor.department || "__none__",
    role: { $in: ["requestor", "user", "admin"] },
  };
}

function scopedMrFilter(actor) {
  return listFilterForRole(actor);
}

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department || "",
    privileges: user.privileges || { allow: [], deny: [] },
    userCreateLimit: user.role === "super_admin" ? null : Number(user.userCreateLimit ?? 5),
    createdBy: user.createdBy ? user.createdBy.toString() : "",
    active: user.active !== false,
    createdAt: user.createdAt,
  };
}

function generatePassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

module.exports = {
  mergePrivilegeMaps,
  resolvePrivileges,
  hasPrivilege,
  canAssignRole,
  scopedUserQuery,
  scopedMrFilter,
  toPublicUser,
  generatePassword,
  normalizeRole,
};
