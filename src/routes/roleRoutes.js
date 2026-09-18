const express = require("express");
const { verifyToken, requirePrivilege } = require("../middlewares/authMiddleware");
const { listRoles, saveRole, deleteRole } = require("../controllers/roleController");

const router = express.Router();

router.use(verifyToken);
router.get("/", requirePrivilege("roles", "view"), listRoles);
router.post("/", saveRole);
router.put("/:id", saveRole);
router.delete("/:id", deleteRole);

module.exports = router;
