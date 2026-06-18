import { Op } from 'sequelize';
import { models } from '../db.js';
import { config } from '../config.js';
import { ensureUserByTelegramId, buildAdminUserContactProjection, normalizeSkillIds } from './userService.js';

export const GLOBAL_EASY_APPLY_AGENT_CONFIG_KEY = 'GlobalEasyApplyAgentUserIds';
export const GLOBAL_EASY_APPLY_AGENT_LEGACY_CONFIG_KEY = 'GlobalEasyApplyAgentUserId';
export const GLOBAL_EASY_APPLY_AGENT_TELEGRAM_CONFIG_KEY = 'GlobalEasyApplyAgentTelegramChatIds';

export function parseGlobalEasyApplyAgentTelegramChatIds(raw) {
  const ids = [];
  const seen = new Set();
  for (const part of String(raw || '').split(',')) {
    const id = Number.parseInt(part.trim(), 10);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function isGlobalEasyApplyAgentUserId(userId, globalEasyApplyAgentUserIds) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const ids = Array.isArray(globalEasyApplyAgentUserIds)
    ? globalEasyApplyAgentUserIds
    : [globalEasyApplyAgentUserIds];
  return ids.some((globalId) => Number(globalId) === id);
}

async function readGlobalEasyApplyAgentUserIdsFromDb() {
  if (!models.Configs) return null;
  const row = await models.Configs.findOne({ where: { Key: GLOBAL_EASY_APPLY_AGENT_TELEGRAM_CONFIG_KEY } });
  if (row?.Value) return parseGlobalEasyApplyAgentTelegramChatIds(row.Value);
  const listLegacy = await models.Configs.findOne({ where: { Key: GLOBAL_EASY_APPLY_AGENT_CONFIG_KEY } });
  if (listLegacy?.Value) return parseGlobalEasyApplyAgentTelegramChatIds(listLegacy.Value);
  const legacy = await models.Configs.findOne({ where: { Key: GLOBAL_EASY_APPLY_AGENT_LEGACY_CONFIG_KEY } });
  if (legacy?.Value) return parseGlobalEasyApplyAgentTelegramChatIds(legacy.Value);
  return null;
}

async function persistGlobalEasyApplyAgentTelegramChatIds(telegramChatIds) {
  const normalized = parseGlobalEasyApplyAgentTelegramChatIds(telegramChatIds.join(','));
  if (!models.Configs) throw new Error('Configs table is unavailable');
  const now = new Date();
  const value = normalized.join(',');
  const existing = await models.Configs.findOne({
    where: { Key: GLOBAL_EASY_APPLY_AGENT_TELEGRAM_CONFIG_KEY },
  });
  if (existing) {
    await existing.update({ Value: value, UpdatedAt: now });
  } else {
    await models.Configs.create({
      Key: GLOBAL_EASY_APPLY_AGENT_TELEGRAM_CONFIG_KEY,
      Value: value,
      Description: 'Comma-separated Users.TelegramChatId values for LinkedIn Easy Apply specialists',
      UpdatedAt: now,
    });
  }
  return normalized;
}

export async function resolveGlobalEasyApplyAgentTelegramChatIds() {
  const fromDb = await readGlobalEasyApplyAgentUserIdsFromDb();
  if (fromDb?.length) return fromDb;
  return Array.isArray(config.globalEasyApplyAgentTelegramChatIds)
    ? config.globalEasyApplyAgentTelegramChatIds
    : [];
}

export async function resolveGlobalEasyApplyAgentUserIds() {
  const telegramChatIds = await resolveGlobalEasyApplyAgentTelegramChatIds();
  if (!telegramChatIds.length) return [];
  const users = await models.Users.findAll({
    attributes: ['Id', 'TelegramChatId'],
    where: { TelegramChatId: { [Op.in]: telegramChatIds } },
  });
  const byChatId = new Map(users.map((u) => [Number(u.TelegramChatId), Number(u.Id)]));
  return telegramChatIds.map((chatId) => byChatId.get(Number(chatId))).filter((id) => Number.isSafeInteger(id));
}

export async function resolveGlobalEasyApplyAgentUserId() {
  const ids = await resolveGlobalEasyApplyAgentUserIds();
  return ids[0] || 0;
}

export async function isGlobalEasyApplyAgent(userId) {
  const ids = await resolveGlobalEasyApplyAgentUserIds();
  return isGlobalEasyApplyAgentUserId(userId, ids);
}

export async function setGlobalEasyApplyAgentUserIds(userIds) {
  const normalized = parseGlobalEasyApplyAgentTelegramChatIds(
    Array.isArray(userIds) ? userIds.join(',') : String(userIds ?? '')
  );
  return persistGlobalEasyApplyAgentTelegramChatIds(normalized);
}

export async function addGlobalEasyApplyAgentUserId(userId) {
  const normalized = Number.parseInt(String(userId ?? ''), 10);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error('Invalid global Easy Apply agent telegram chat id');
  }
  const current = await resolveGlobalEasyApplyAgentTelegramChatIds();
  if (current.includes(normalized)) return current;
  return persistGlobalEasyApplyAgentTelegramChatIds([...current, normalized]);
}

export async function removeGlobalEasyApplyAgentUserId(userId) {
  const normalized = Number.parseInt(String(userId ?? ''), 10);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error('Invalid global Easy Apply agent telegram chat id');
  }
  const current = await resolveGlobalEasyApplyAgentTelegramChatIds();
  return persistGlobalEasyApplyAgentTelegramChatIds(current.filter((id) => id !== normalized));
}

/** @deprecated Use addGlobalEasyApplyAgentUserId */
export async function setGlobalEasyApplyAgentUserId(userId) {
  return addGlobalEasyApplyAgentUserId(userId);
}

export function resolveAgentWorkflowModeFromFlags({ isBotAdmin, isGlobalEasyApply, hasAssignments }) {
  if (isBotAdmin) return 'admin';
  if (isGlobalEasyApply) return 'easy_apply';
  if (hasAssignments) return 'external';
  return 'none';
}

export function clientHasResumeForAgentAccess(client) {
  return Boolean(client && String(client.ResumeURL || '').trim());
}

export async function resolveAgentWorkflowMode(userId, { isBotAdmin = false } = {}) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return 'none';
  if (isBotAdmin) return 'admin';
  if (await isGlobalEasyApplyAgent(id)) return 'easy_apply';
  if ((await countAgentAssignments(id)) > 0) return 'external';
  return 'none';
}

export async function listResumeReadyClients({ limit = 200, offset = 0 } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit), 10) || 200));
  const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
  const users = await models.Users.findAll({
    where: {
      ResumeURL: {
        [Op.and]: [{ [Op.not]: null }, { [Op.ne]: '' }],
      },
    },
    order: [['DateJoined', 'DESC'], ['Id', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  });
  return users.filter((u) => clientHasResumeForAgentAccess(u));
}

export async function listApplyPriorityEnqueueClientUserIds({ agentUserId = null } = {}) {
  const normalizedAgentUserId =
    Number.isSafeInteger(Number(agentUserId)) && Number(agentUserId) > 0 ? Number(agentUserId) : null;
  const mode = normalizedAgentUserId
    ? await resolveAgentWorkflowMode(normalizedAgentUserId, { isBotAdmin: false })
    : 'external';

  let clients = [];
  if (mode === 'easy_apply') {
    clients = await listResumeReadyClients({ limit: 10000, offset: 0 });
  } else {
    const assignmentWhere = normalizedAgentUserId ? { AgentUserId: normalizedAgentUserId } : undefined;
    const assignments = await models.AgentClients.findAll({
      where: assignmentWhere,
      include: [{ model: models.Users, as: 'Client', required: true }],
      order: [['Id', 'ASC']],
    });
    clients = assignments
      .map((row) => row.Client)
      .filter((client) => clientHasResumeForAgentAccess(client));
  }

  return clients
    .filter((client) => String(client.Comment || '').trim())
    .filter((client) => normalizeSkillIds(client.skills).length > 0)
    .map((client) => Number(client.Id));
}

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

export function isBotPublisherTelegramId(telegramUserId) {
  const id = Number(telegramUserId);
  const publisherIds = config.botPublisherTelegramIds;
  return (
    Number.isSafeInteger(id) &&
    id > 0 &&
    publisherIds.size > 0 &&
    publisherIds.has(id)
  );
}

export function canUseApplyLinkBuilder(telegramUserId) {
  return isBotAdminTelegramId(telegramUserId) || isBotPublisherTelegramId(telegramUserId);
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

export async function countMentorAssignments(mentorUserId) {
  const id = Number(mentorUserId);
  if (!Number.isSafeInteger(id) || id <= 0 || !models.ClientMentors) return 0;
  return models.ClientMentors.count({ where: { MentorUserId: id } });
}

export async function isClientMentorUser(userId) {
  return (await countMentorAssignments(userId)) > 0;
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
      if (await isGlobalEasyApplyAgent(agentId)) {
        if (!clientHasResumeForAgentAccess(client)) {
          return { ok: false, status: 403, error: 'Client has no resume on file' };
        }
        return { ok: true, client };
      }
      const row = await models.AgentClients.findOne({
        where: { AgentUserId: agentId, ClientUserId: clientId },
      });
      if (!row) return { ok: false, status: 403, error: 'Client is not assigned to this agent' };
      return { ok: true, client };
    }
    return { ok: true, client };
  }

  if (await isGlobalEasyApplyAgent(actorUserId)) {
    if (!clientHasResumeForAgentAccess(client)) {
      return { ok: false, status: 403, error: 'Client has no resume on file' };
    }
    return { ok: true, client };
  }

  const row = await models.AgentClients.findOne({
    where: { AgentUserId: Number(actorUserId), ClientUserId: clientId },
  });
  if (!row) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true, client };
}

export async function assertCanAccessClientAsMentor({
  actorUserId,
  clientUserId,
  isBotAdmin,
}) {
  const clientId = Number(clientUserId);
  if (!Number.isSafeInteger(clientId) || clientId <= 0) {
    return { ok: false, status: 400, error: 'Invalid client user id' };
  }
  const client = await models.Users.findByPk(clientId);
  if (!client) return { ok: false, status: 404, error: 'User not found' };
  if (Number(actorUserId) === clientId) return { ok: true, client };
  if (isBotAdmin) return { ok: true, client };
  if (!models.ClientMentors) return { ok: false, status: 403, error: 'Forbidden' };
  const row = await models.ClientMentors.findOne({
    where: { MentorUserId: Number(actorUserId), ClientUserId: clientId },
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
    comment: u.Comment ?? null,
    note: u.Note ?? null,
    skills: Array.isArray(u.skills) ? u.skills : [],
    workAuthorizationCountries: u.WorkAuthorizationCountries || '',
    searchMode: u.SearchMode || 'not_urgent',
    ...projection,
  };
}
