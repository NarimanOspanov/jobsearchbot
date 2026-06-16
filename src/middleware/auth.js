import { config } from '../config.js';
import { verifyInitData, extractMiniAppInitData } from '../utils/telegramUtils.js';
import {
  canUseApplyLinkBuilder,
  countAgentAssignments,
  countMentorAssignments,
  isBotAdminTelegramId,
  resolveUserFromMiniApp,
} from '../services/agentAccessService.js';

export async function miniAppAuth(req, res, next) {
  const initData = extractMiniAppInitData(req);

  if (!initData && process.env.LOG_MINIAPP_AUTH === '1') {
    console.warn('[miniAppAuth] missing init data', {
      path: req.path,
      ua: req.get('user-agent'),
      hasXInitData: Boolean(req.headers['x-init-data']),
      hasAuthorizationTma: Boolean(
        (req.headers.authorization && /^tma\s+/i.test(req.headers.authorization)) ||
          (req.headers.Authorization && /^tma\s+/i.test(req.headers.Authorization))
      ),
    });
  }

  if (!initData && process.env.NODE_ENV !== 'production') {
    const fallbackId = Number(req.headers['x-dev-telegram-id']);
    if (Number.isSafeInteger(fallbackId) && fallbackId > 0) {
      req.miniAppUser = { id: fallbackId, username: req.headers['x-dev-username'] || null };
      return next();
    }
  }

  if (!initData) return res.status(401).json({ error: 'Unauthorized' });
  const user = verifyInitData(initData);
  if (!user || !user.id) return res.status(403).json({ error: 'Forbidden' });
  req.miniAppUser = user;
  return next();
}

export async function adminMiniAppAuth(req, res, next) {
  await miniAppAuth(req, res, async () => {
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) return res.status(403).json({ error: 'Admin mode is disabled' });
    const userId = Number(req.miniAppUser?.id);
    if (!Number.isSafeInteger(userId) || !adminIds.has(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  });
}

/** Same as adminMiniAppAuth (explicit alias for assignment CRUD). */
export const adminOnlyMiniAppAuth = adminMiniAppAuth;

/** Loads actor user and flags; does not require career-agent role (use for per-resource access checks). */
export async function miniAppActorAuth(req, res, next) {
  await miniAppAuth(req, res, async () => {
    const telegramUserId = Number(req.miniAppUser?.id);
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const actorUser = await resolveUserFromMiniApp(req.miniAppUser);
    if (!actorUser) return res.status(403).json({ error: 'User not found' });
    req.actorUser = actorUser;
    req.isBotAdmin = isBotAdminTelegramId(telegramUserId);
    req.isCareerAgent = (await countAgentAssignments(actorUser.Id)) > 0;
    req.isClientMentor = (await countMentorAssignments(actorUser.Id)) > 0;
    return next();
  });
}

/** Bot admins and env-configured job publishers (apply link builder). */
export async function publisherMiniAppAuth(req, res, next) {
  await miniAppAuth(req, res, async () => {
    const telegramUserId = Number(req.miniAppUser?.id);
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!canUseApplyLinkBuilder(telegramUserId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const actorUser = await resolveUserFromMiniApp(req.miniAppUser);
    if (!actorUser) return res.status(403).json({ error: 'User not found' });
    req.actorUser = actorUser;
    req.isBotAdmin = isBotAdminTelegramId(telegramUserId);
    return next();
  });
}

export async function agentMiniAppAuth(req, res, next) {
  await miniAppAuth(req, res, async () => {
    const telegramUserId = Number(req.miniAppUser?.id);
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorUser = await resolveUserFromMiniApp(req.miniAppUser);
    if (!actorUser) return res.status(403).json({ error: 'User not found' });

    const isBotAdmin = isBotAdminTelegramId(telegramUserId);
    const assignmentCount = await countAgentAssignments(actorUser.Id);
    const isCareerAgent = assignmentCount > 0;

    if (!isBotAdmin && !isCareerAgent) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.actorUser = actorUser;
    req.isBotAdmin = isBotAdmin;
    req.isCareerAgent = isCareerAgent;
    return next();
  });
}
