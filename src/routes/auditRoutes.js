const express = require("express");
const { verifyToken, requirePrivilege } = require("../middlewares/authMiddleware");
const { listAudits } = require("../controllers/auditController");

const router = express.Router();

router.use(verifyToken);
router.get("/", requirePrivilege("audits", "view"), listAudits);

module.exports = router;
