const { AuditLog } = require("./auth.models");

async function audit(eventType, { actorUserId, targetUserId, metadata } = {}) {
  try {
    await AuditLog.create({ eventType, actorUserId, targetUserId, metadata });
  } catch (error) {
    console.error("Audit log failed", { eventType, message: error.message });
  }
}

module.exports = { audit };
