const express = require("express");
const { verifyToken, requirePrivilege } = require("../middlewares/authMiddleware");
const {
  listMaterials,
  listDepartmentManagers,
  saveProjectManager,
  saveMaterial,
  deleteMaterial,
} = require("../controllers/materialController");

const router = express.Router();

router.use(verifyToken);
router.get("/managers", requirePrivilege("materials", "view"), listDepartmentManagers);
router.put("/manager", requirePrivilege("materials", "edit"), saveProjectManager);
router.get("/", listMaterials);
router.post("/", requirePrivilege("materials", "create"), saveMaterial);
router.put("/:id", requirePrivilege("materials", "edit"), saveMaterial);
router.delete("/:id", requirePrivilege("materials", "delete"), deleteMaterial);

module.exports = router;
