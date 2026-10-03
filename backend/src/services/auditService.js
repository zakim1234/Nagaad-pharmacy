import AuditLog from '../models/AuditLog.js';

export async function logAudit({ user, action, entityType, entityId, details }) {
  try {
    await AuditLog.create({
      user: user?._id || null,
      userName: user?.name || 'system',
      action,
      entityType,
      entityId: entityId || null,
      details: details || {},
    });
  } catch (err) {
    // Auditing must never break the primary business flow.
    console.error('[audit] failed to write audit log:', err.message);
  }
}
