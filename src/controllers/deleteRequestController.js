const DeleteRequest = require("../models/deleteRequestModel");
const User = require("../models/userModel");
const { hasPrivilege } = require("../utils/privileges");

const listRequests = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role !== "super_admin" && !hasPrivilege(req.user, "delete_requests", "view")) {
      filter.requestedBy = req.user.id;
    }
    const requests = await DeleteRequest.find(filter)
      .populate("requestedBy", "name email role")
      .populate("reviewedBy", "name email role")
      .sort({ createdAt: -1 });
    res.status(200).json({ requests });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const reviewRequest = async (req, res) => {
  try {
    const action = req.body.action;
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "Action must be approve or reject" });
    }
    if (!hasPrivilege(req.user, "delete_requests", action) && req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Only super admin can review delete requests" });
    }

    const request = await DeleteRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ message: "This request was already reviewed" });
    }

    request.status = action === "approve" ? "approved" : "rejected";
    request.reviewedBy = req.user.id;
    request.reviewNote = req.body.note || "";
    request.reviewedAt = new Date();

    if (action === "approve") {
      const user = await User.findById(request.targetId);
      if (user) {
        if (user.role === "super_admin") {
          return res.status(403).json({ message: "Super admin cannot be deleted" });
        }
        await user.deleteOne();
      }
    }

    await request.save();
    res.status(200).json({
      message: action === "approve" ? "User deleted" : "Request rejected",
      request,
      user: action === "approve" ? null : undefined,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { listRequests, reviewRequest };
