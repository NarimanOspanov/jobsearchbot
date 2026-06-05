import { models } from '../db.js';
import { HUMAN_ASSISTANT_REQUEST_STATUS } from '../models/HumanAssistantRequest.js';

/**
 * Create or refresh a pending human-assistant request for a user.
 * @param {{ userId: number, source?: string }} opts
 */
export async function upsertPendingHumanAssistantRequest({ userId, source = 'hire_human' }) {
  if (!models.HumanAssistantRequests) return null;
  const normalizedUserId = Number.parseInt(String(userId), 10);
  if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId <= 0) return null;

  const existing = await models.HumanAssistantRequests.findOne({
    where: {
      UserId: normalizedUserId,
      Status: HUMAN_ASSISTANT_REQUEST_STATUS.PENDING,
    },
    order: [['Id', 'DESC']],
  });

  const now = new Date();
  if (existing) {
    await existing.update({
      CreatedAt: now,
      Source: String(source || existing.Source || 'hire_human').slice(0, 64) || null,
    });
    return existing;
  }

  return models.HumanAssistantRequests.create({
    UserId: normalizedUserId,
    CreatedAt: now,
    Status: HUMAN_ASSISTANT_REQUEST_STATUS.PENDING,
    Source: String(source || 'hire_human').slice(0, 64) || null,
    AssignedAt: null,
  });
}

/**
 * Mark pending request(s) as assigned when agent-client link is created.
 * @param {number} clientUserId
 */
export async function markHumanAssistantRequestAssigned(clientUserId) {
  if (!models.HumanAssistantRequests) return 0;
  const id = Number.parseInt(String(clientUserId), 10);
  if (!Number.isSafeInteger(id) || id <= 0) return 0;

  const [updated] = await models.HumanAssistantRequests.update(
    {
      Status: HUMAN_ASSISTANT_REQUEST_STATUS.ASSIGNED,
      AssignedAt: new Date(),
    },
    {
      where: {
        UserId: id,
        Status: HUMAN_ASSISTANT_REQUEST_STATUS.PENDING,
      },
    }
  );
  return updated;
}

/**
 * @param {{ status?: string, limit?: number, offset?: number }} [opts]
 */
export async function listHumanAssistantRequests({ status = 'pending', limit = 200, offset = 0 } = {}) {
  if (!models.HumanAssistantRequests) return [];
  const normalizedStatus = String(status || 'pending').trim().toLowerCase();
  const where = normalizedStatus ? { Status: normalizedStatus } : {};
  return models.HumanAssistantRequests.findAll({
    where,
    include: [{ model: models.Users, as: 'User', required: true }],
    order: [['CreatedAt', 'DESC'], ['Id', 'DESC']],
    limit: Math.min(200, Math.max(1, Number(limit) || 200)),
    offset: Math.max(0, Number(offset) || 0),
  });
}

export async function getPendingHumanAssistantUserIds() {
  if (!models.HumanAssistantRequests) return new Set();
  const rows = await models.HumanAssistantRequests.findAll({
    attributes: ['UserId'],
    where: { Status: HUMAN_ASSISTANT_REQUEST_STATUS.PENDING },
    raw: true,
  });
  return new Set(
    rows
      .map((row) => Number(row.UserId))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );
}
