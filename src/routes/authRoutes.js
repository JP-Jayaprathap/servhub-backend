const express = require("express");
const { login, logout, me, directory } = require("../controllers/authController");
const { verifyToken } = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/logout", verifyToken, logout);
router.get("/me", verifyToken, me);
router.get("/directory", verifyToken, directory);

module.exports = router;
