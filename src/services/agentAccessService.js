import { models } from '../db.js';
import { config } from '../config.js';
import { ensureUserByTelegramId, buildAdminUserContactProjection } from './userService.js';

export function isBotAdminTelegramId(telegramUserId) {
  const id = Number(telegramUserId);
  const adminIds = config.botAdminTelegramIds;
  return (
    Number.isSafeInteger(id) &&
    id > 0 &&
    adminIds.size > 0 &&
    adminIds.has(id)
  );
}

export async function resolveUserFromMiniApp(miniAppUser) {
  if (!miniAppUser?.id) return null;
  const { user } = await ensureUserByTelegramId(
    miniAppUser.id,
    miniAppUser.username ?? null,
    miniAppUser.first_name ?? miniAppUser.firstName ?? null,
    miniAppUser.last_name ?? miniAppUser.lastName ?? null
  );
  return user;
}

export async function countAgentAssignments(agentUserId) {
  const id = Number(agentUserId);
  if (!Number.isSafeInteger(id) || id <= 0) return 0;
  return models.AgentClients.count({ where: { AgentUserId: id } });
}

export async function isCareerAgentUser(userId) {
  return (await countAgentAssignments(userId)) > 0;
}

export async function findAssignmentForClient(clientUserId) {
  const id = Number(clientUserId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return models.AgentClients.findOne({ where: { ClientUserId: id } });
}

/**
 * @param {object} opts
 * @param {number} opts.actorUserId - Users.Id of the mini-app actor
 * @param {number} opts.clientUserId - Users.Id of the job seeker
 * @param {boolean} opts.isBotAdmin
 * @param {number} [opts.impersonateAgentUserId] - when admin views as agent
 */
export async function assertCanAccessClient({
  actorUserId,
  clientUserId,
  isBotAdmin,
  impersonateAgentUserId = null,
}) {
  const clientId = Number(clientUserId);
  if (!Number.isSafeInteger(clientId) || clientId <= 0) {
    return { ok: false, status: 400, error: 'Invalid client user id' };
  }

  const client = await models.Users.findByPk(clientId);
  if (!client) return { ok: false, status: 404, error: 'User not found' };

  if (Number(actorUserId) === clientId) {
    return { ok: true, client };
  }

  if (isBotAdmin) {
    const agentId = impersonateAgentUserId != null ? Number(impersonateAgentUserId) : null;
    if (agentId != null && Number.isSafeInteger(agentId) && agentId > 0) {
      const row = await models.AgentClients.findOne({
        where: { AgentUserId: agentId, ClientUserId: clientId },
      });
      if (!row) return { ok: false, status: 403, error: 'Client is not assigned to this agent' };
      return { ok: true, client };
    }
    return { ok: true, client };
  }

  const row = await models.AgentClients.findOne({
    where: { AgentUserId: Number(actorUserId), ClientUserId: clientId },
  });
  if (!row) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true, client };
}

export function mapUserToAgentClientPayload(u) {
  const projection = buildAdminUserContactProjection(u);
  return {
    id: u.Id,
    telegramChatId: String(u.TelegramChatId),
    telegramUserName: u.TelegramUserName,
    firstName: u.FirstName || null,
    lastName: u.LastName || null,
    dateJoined: u.DateJoined,
    isBlocked: !!u.IsBlocked,
    resumeUrl: u.ResumeURL || null,
    skills: Array.isArray(u.skills) ? u.skills : [],
    ...projection,
  };
}
