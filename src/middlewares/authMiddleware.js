const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Role = require("../models/roleModel");
const Department = require("../models/departmentModel");
const { resolvePrivileges } = require("../utils/privileges");

const verifyToken = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }
    if (user.active === false) {
      return res.status(401).json({ message: "Account is deactivated" });
    }

    const roles = await Role.find();
    const departments = await Department.find();
    const roleCatalog = Object.fromEntries(roles.map((role) => [role.key, role.privileges || {}]));
    const departmentCatalog = Object.fromEntries(
      departments.map((item) => [item.key, item.privileges || {}])
    );
    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department || "",
      privileges: resolvePrivileges(user, roleCatalog, departmentCatalog),
      allow: user.privileges?.allow || [],
      deny: user.privileges?.deny || [],
    };
    next();
  } catch (error) {
    return res.status(401).json({ message: "Token is not valid", error: error.message });
  }
};

const requirePrivilege = (moduleKey, action = "view") => (req, res, next) => {
  if (req.user.role === "super_admin") return next();
  if (req.user.privileges?.[moduleKey]?.includes(action)) return next();
  return res.status(403).json({ message: `Missing privilege ${moduleKey}.${action}` });
};

const requireRoles = (...roles) => (req, res, next) => {
  if (roles.includes(req.user.role)) return next();
  return res.status(403).json({ message: "Not allowed for this role" });
};

module.exports = { verifyToken, requirePrivilege, requireRoles };
