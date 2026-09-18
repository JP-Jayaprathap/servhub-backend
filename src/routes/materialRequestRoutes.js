const express = require("express");
const { verifyToken, requirePrivilege } = require("../middlewares/authMiddleware");
const {
  listRequests,
  getRequest,
  createRequest,
  updateRequest,
  deleteRequest,
} = require("../controllers/materialRequestController");

const router = express.Router();

router.use(verifyToken);
router.get("/", requirePrivilege("material_requests", "view"), listRequests);
router.get("/:id", requirePrivilege("material_requests", "view"), getRequest);
router.post("/", requirePrivilege("material_requests", "create"), createRequest);
router.put("/:id", requirePrivilege("material_requests", "edit"), updateRequest);
router.delete("/:id", deleteRequest);

module.exports = router;
