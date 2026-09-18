const bcrypt = require("bcryptjs");
const Role = require("../models/roleModel");
const User = require("../models/userModel");
const Department = require("../models/departmentModel");

const recordAccess = ["view", "create", "edit"];

const departmentDefaults = {
  dashboard: ["view"],
  users: ["view", "create", "edit"],
  material_requests: recordAccess,
  reports: ["view"],
};

const rolePrivileges = {
  super_admin: {
    dashboard: ["view"],
    material_requests: ["view", "create", "edit", "delete"],
    approvals: ["view", "approve", "reject"],
    procurement: ["view", "create", "edit"],
    purchase_orders: ["view", "create", "edit"],
    deliveries: ["view", "edit"],
    payments: ["view", "approve"],
    suppliers: ["view", "create", "edit", "delete"],
    users: ["view", "create", "edit", "delete"],
    roles: ["view", "create", "edit", "delete"],
    privileges: ["view", "create", "edit", "delete"],
    departments: ["view", "create", "edit", "delete"],
    delete_requests: ["view", "approve", "reject"],
    reports: ["view", "export"],
    audits: ["view"],
    settings: ["view", "edit"],
  },
  admin: {
    dashboard: ["view"],
    users: ["view", "create", "edit"],
    reports: ["view"],
  },
  user: {
    material_requests: ["view", "create", "edit"],
    attendance: ["view"],
    settings: ["view", "edit"],
  },
};

const roles = [
  { name: "Super Admin", key: "super_admin" },
  { name: "Admin", key: "admin" },
  { name: "User", key: "user" },
];

const departments = [
  { name: "HR", key: "hr", privileges: { ...departmentDefaults } },
  {
    name: "Purchase",
    key: "purchase",
    privileges: {
      ...departmentDefaults,
      procurement: recordAccess,
      purchase_orders: recordAccess,
      suppliers: recordAccess,
    },
  },
  { name: "Development", key: "development", privileges: { ...departmentDefaults } },
];

const users = [
  { name: "System Administrator", email: "superadmin@erp.com", password: "123456", role: "super_admin" },
  { name: "ERP Admin", email: "admin@erp.com", password: "123456", role: "admin", department: "hr" },
  { name: "Workspace User", email: "user@erp.com", password: "123456", role: "user", department: "hr" },
];

async function seedDepartments() {
  await Department.deleteOne({ key: "testing" });
  for (const item of departments) {
    const exists = await Department.findOne({ key: item.key });
    if (exists) continue;
    await Department.create({
      name: item.name,
      key: item.key,
      privileges: item.privileges,
    });
  }
}

async function seed() {
  for (const role of roles) {
    await Role.findOneAndUpdate(
      { key: role.key },
      { name: role.name, key: role.key, privileges: rolePrivileges[role.key] || { dashboard: ["view"] } },
      { upsert: true, returnDocument: "after" }
    );
  }

  await seedDepartments();

  for (const item of users) {
    const exists = await User.findOne({ email: item.email });
    if (exists) {
      if (!exists.department && item.department) {
        exists.department = item.department;
        await exists.save();
      }
      continue;
    }
    const password = await bcrypt.hash(item.password, 10);
    await User.create({
      name: item.name,
      email: item.email,
      password,
      role: item.role,
      department: item.department || "",
      privileges: { allow: [], deny: [] },
      userCreateLimit: item.role === "admin" ? 5 : 5,
    });
  }
}

module.exports = { seed, seedDepartments, rolePrivileges };
