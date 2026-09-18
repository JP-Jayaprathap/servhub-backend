const express = require("express");
const { verifyToken, requirePrivilege, requireRoles } = require("../middlewares/authMiddleware");
const { listDepartments, saveDepartment, deleteDepartment } = require("../controllers/departmentController");

const router = express.Router();

router.use(verifyToken);
router.get("/", listDepartments);
router.post("/", requireRoles("super_admin"), requirePrivilege("departments", "create"), saveDepartment);
router.put("/:id", requireRoles("super_admin"), requirePrivilege("departments", "edit"), saveDepartment);
router.delete("/:id", requireRoles("super_admin"), requirePrivilege("departments", "delete"), deleteDepartment);

module.exports = router;
