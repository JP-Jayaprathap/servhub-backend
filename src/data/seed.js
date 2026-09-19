const bcrypt = require("bcryptjs");
const Role = require("../models/roleModel");
const User = require("../models/userModel");
const Department = require("../models/departmentModel");
const { roleCatalog, rolePrivileges } = require("../workflow/materialRequestFlow");

const recordAccess = ["view", "create", "edit"];

const departmentDefaults = {
  dashboard: ["view"],
  users: ["view", "create", "edit"],
  material_requests: recordAccess,
  reports: ["view"],
};

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
  { name: "Finance", key: "finance", privileges: { ...departmentDefaults, payments: ["view", "approve"] } },
];

const users = [
  { name: "System Administrator", email: "superadmin@erp.com", password: "123456", role: "super_admin" },
  { name: "ERP Admin", email: "admin@erp.com", password: "123456", role: "admin", department: "hr" },
  { name: "Requestor", email: "requestor@erp.com", password: "123456", role: "requestor", department: "hr" },
  {
    name: "Department Manager",
    email: "manager@erp.com",
    password: "123456",
    role: "manager",
    department: "hr",
  },
  {
    name: "Procurement Officer",
    email: "procurement@erp.com",
    password: "123456",
    role: "procurement",
    department: "purchase",
  },
  {
    name: "Department Head",
    email: "head@erp.com",
    password: "123456",
    role: "department_head",
    department: "hr",
  },
  { name: "Finance Officer", email: "finance@erp.com", password: "123456", role: "finance", department: "finance" },
  { name: "Supplier User", email: "supplier@erp.com", password: "123456", role: "supplier", department: "purchase" },
  {
    name: "Department Incharge",
    email: "incharge@erp.com",
    password: "123456",
    role: "in_charge",
    department: "hr",
  },
  // legacy alias kept for existing logins
  { name: "Workspace User", email: "user@erp.com", password: "123456", role: "requestor", department: "hr" },
];

async function seedDepartments() {
  await Department.deleteOne({ key: "testing" });
  for (const item of departments) {
    await Department.findOneAndUpdate(
      { key: item.key },
      { name: item.name, key: item.key, privileges: item.privileges },
      { upsert: true, returnDocument: "after" }
    );
  }
}

async function seed() {
  for (const role of roleCatalog) {
    await Role.findOneAndUpdate(
      { key: role.key },
      {
        name: role.name,
        key: role.key,
        privileges: rolePrivileges[role.key] || { dashboard: ["view"] },
      },
      { upsert: true, returnDocument: "after" }
    );
  }

  // Keep legacy "user" role pointing at requestor privileges for old accounts
  await Role.findOneAndUpdate(
    { key: "user" },
    {
      name: "Requestor (legacy)",
      key: "user",
      privileges: rolePrivileges.requestor,
    },
    { upsert: true, returnDocument: "after" }
  );

  await seedDepartments();

  for (const item of users) {
    const exists = await User.findOne({ email: item.email });
    if (exists) {
      let dirty = false;
      if (!exists.department && item.department) {
        exists.department = item.department;
        dirty = true;
      }
      if (item.email === "user@erp.com" && exists.role === "user") {
        exists.role = "requestor";
        dirty = true;
      }
      if (dirty) await exists.save();
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
      active: true,
    });
  }
}

module.exports = { seed, seedDepartments, rolePrivileges };
