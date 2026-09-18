const express = require("express");
const { verifyToken, requirePrivilege } = require("../middlewares/authMiddleware");
const {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  requestDelete,
  updateProfile,
  changePassword,
  createQuota,
} = require("../controllers/userController");

const router = express.Router();

router.use(verifyToken);
router.put("/me", updateProfile);
router.put("/me/password", changePassword);
router.get("/create-quota", createQuota);
router.get("/", requirePrivilege("users", "view"), listUsers);
router.post("/", requirePrivilege("users", "create"), createUser);
router.put("/:id", requirePrivilege("users", "edit"), updateUser);
router.delete("/:id", deleteUser);
router.post("/:id/delete-request", requestDelete);

module.exports = router;
