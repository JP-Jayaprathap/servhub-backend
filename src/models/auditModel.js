const mongoose = require("mongoose");

const auditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    module: { type: String, trim: true, default: "" },
    summary: { type: String, required: true, trim: true },
    actorId: { type: String, trim: true, default: "" },
    actorName: { type: String, trim: true, default: "" },
    actorEmail: { type: String, trim: true, default: "" },
    actorRole: { type: String, trim: true, default: "" },
    targetType: { type: String, trim: true, default: "" },
    targetId: { type: String, trim: true, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Audit", auditSchema);
