const express = require("express");
const { verifyToken } = require("../middlewares/authMiddleware");
const { listRequests, reviewRequest } = require("../controllers/deleteRequestController");

const router = express.Router();

router.use(verifyToken);
router.get("/", listRequests);
router.post("/:id/review", reviewRequest);

module.exports = router;
