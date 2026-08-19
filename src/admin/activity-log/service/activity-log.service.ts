import { AuditLog } from "../model/auditLog.model";

export const logActivity = async (
  actorId: string,
  actorRole: string,
  action: string,
  targetType: string,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await AuditLog.create({ actorId, actorRole, action, targetType, targetId, metadata });
};

export const listActivityLogs = async (filter: { actorId?: string; action?: string }) => {
  const query: Record<string, unknown> = {};
  if (filter.actorId) query.actorId = filter.actorId;
  if (filter.action) query.action = filter.action;

  return AuditLog.find(query).populate("actorId", "name email role").sort({ createdAt: -1 }).limit(200);
};
