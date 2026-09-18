const Audit = require("../models/auditModel");

async function logAudit({
  action,
  module = "",
  summary,
  actor,
  targetType = "",
  targetId = "",
  meta = {},
}) {
  try {
    await Audit.create({
      action,
      module,
      summary,
      actorId: actor?.id || actor?._id?.toString?.() || "",
      actorName: actor?.name || "",
      actorEmail: actor?.email || "",
      actorRole: actor?.role || "",
      targetType,
      targetId: targetId ? String(targetId) : "",
      meta,
    });
  } catch (error) {
    console.error("Audit log failed:", error.message);
  }
}

module.exports = { logAudit };
