const bcrypt = require("bcryptjs");
const Role = require("../models/roleModel");
const User = require("../models/userModel");
const Department = require("../models/departmentModel");
const Material = require("../models/materialModel");
const ProjectManager = require("../models/projectManagerModel");
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
  {
    name: "Purchase Requestor",
    email: "purchase.requestor@erp.com",
    password: "123456",
    role: "requestor",
    department: "purchase",
  },
  {
    name: "Purchase Manager",
    email: "purchase.manager@erp.com",
    password: "123456",
    role: "manager",
    department: "purchase",
  },
  {
    name: "Development Requestor",
    email: "development.requestor@erp.com",
    password: "123456",
    role: "requestor",
    department: "development",
  },
  {
    name: "Development Manager",
    email: "development.manager@erp.com",
    password: "123456",
    role: "manager",
    department: "development",
  },
  {
    name: "Finance Requestor",
    email: "finance.requestor@erp.com",
    password: "123456",
    role: "requestor",
    department: "finance",
  },
  {
    name: "Finance Manager",
    email: "finance.manager@erp.com",
    password: "123456",
    role: "manager",
    department: "finance",
  },
  { name: "Back Office", email: "backoffice@erp.com", password: "123456", role: "back_office" },
];

const materials = [
  { productId: "HR-PEN", name: "Ballpoint pen", project: "Office renovation", department: "hr", unit: "box" },
  { productId: "HR-PAPER", name: "A4 paper", project: "Office renovation", department: "hr", unit: "ream" },
  { productId: "PUR-CABLE", name: "Power cable", project: "Site setup", department: "purchase", unit: "pcs" },
  { productId: "PUR-GLOVES", name: "Safety gloves", project: "Site setup", department: "purchase", unit: "pair" },
  { productId: "DEV-LAPTOP", name: "Laptop", project: "Workstation rollout", department: "development", unit: "pcs" },
  { productId: "FIN-FOLDER", name: "Document folder", project: "Year-end audit", department: "finance", unit: "pcs" },
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

async function seedMaterials() {
  for (const item of materials) {
    const exists = await Material.findOne({ productId: item.productId });
    if (!exists) {
      await Material.create({ ...item, active: true });
      continue;
    }
    if (!String(exists.project || "").trim()) {
      exists.project = item.project;
      await exists.save();
    }
  }
}

async function seedProjectManagers() {
  const rows = await Material.find().select("project department");
  const seen = new Set();
  for (const item of rows) {
    const project = String(item.project || "").trim();
    const department = String(item.department || "").trim().toLowerCase();
    const projectKey = project.toLowerCase();
    if (!projectKey || !department) continue;
    const key = `${projectKey}|${department}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const exists = await ProjectManager.findOne({ projectKey, department });
    if (exists) continue;
    const manager = await User.findOne({
      department,
      role: "manager",
      active: { $ne: false },
    }).sort({ name: 1 });
    if (!manager) continue;
    await ProjectManager.create({
      project,
      projectKey,
      department,
      managerId: manager._id,
      managerName: manager.name,
    });
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
  await seedMaterials();

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

  await seedProjectManagers();
}

module.exports = { seed, seedDepartments, seedMaterials, seedProjectManagers, rolePrivileges };
