/**
 * Resolve and persist which career agent marked an application as applied.
 */

export function isAppliedApplicationStatus(status) {
  return String(status || '').trim().toLowerCase() === 'applied';
}

/**
 * @param {import('express').Request} req
 * @param {number} clientUserId
 * @returns {number | null}
 */
export function resolveApplyingAgentUserId(req, clientUserId) {
  const actorId = Number(req.actorUser?.Id);
  const clientId = Number(clientUserId);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) return null;
  if (actorId === clientId) return null;

  const impersonateRaw = Number.parseInt(
    String(req.query?.agentUserId || req.body?.agentUserId || ''),
    10
  );
  if (req.isBotAdmin && Number.isSafeInteger(impersonateRaw) && impersonateRaw > 0) {
    return impersonateRaw;
  }

  return actorId;
}

/**
 * Set AgentUserId when status becomes applied (or backfill when applied but unset).
 * @param {Record<string, unknown>} updates
 * @param {import('express').Request} req
 * @param {{ UserId?: number, Status?: string | null, AgentUserId?: number | null }} existingRow
 */
export function applyAgentUserIdForAppliedStatus(updates, req, existingRow) {
  const nextStatus = updates.Status !== undefined ? updates.Status : existingRow?.Status;
  if (!isAppliedApplicationStatus(nextStatus)) return;

  const wasApplied = isAppliedApplicationStatus(existingRow?.Status);
  const hasAgent = Number(existingRow?.AgentUserId) > 0;
  if (wasApplied && hasAgent) return;

  const agentUserId = resolveApplyingAgentUserId(req, existingRow?.UserId);
  if (agentUserId) {
    updates.AgentUserId = agentUserId;
  }
}
