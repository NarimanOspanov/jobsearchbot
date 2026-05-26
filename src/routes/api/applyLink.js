import { Router } from 'express';
import { Op } from 'sequelize';
import { publisherMiniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { config } from '../../config.js';
import { buildAdminUserContactProjection } from '../../services/userService.js';
import { isBotAdminTelegramId } from '../../services/agentAccessService.js';
import {
  buildTelegramApplyLink,
  buildTrackedApplyStartPayload,
} from '../../utils/applyLinkAttribution.js';
import {
  extractApplyStartPayloadFromUrl,
  parseStartApplyPayload,
} from '../../utils/telegramUtils.js';
import { runtimeBot } from '../../bot/state.js';

function displayNameFromUser(u, projection) {
  const fromResume = [
    String(projection?.displayFirstName || '').trim(),
    String(projection?.displayLastName || '').trim(),
  ]
    .filter(Boolean)
    .join(' ');
  if (fromResume) return fromResume;
  const fromProfile = [String(u.FirstName || '').trim(), String(u.LastName || '').trim()]
    .filter(Boolean)
    .join(' ');
  if (fromProfile) return fromProfile;
  return u.TelegramUserName || `#${u.Id}`;
}

function parsePublishedInChatId(value) {
  if (value == null || value === '') return { ok: false, error: 'publishedInChatId is required' };
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isSafeInteger(n) || n === 0) {
    return { ok: false, error: 'publishedInChatId must be a non-zero integer' };
  }
  return { ok: true, value: n };
}

function resolvePositionIdFromBody(body) {
  const direct = String(body?.positionId || '').trim();
  if (direct) {
    if (/^apply_/i.test(direct)) {
      const parsed = parseStartApplyPayload(direct);
      if (parsed?.positionId) return parsed.positionId;
    } else if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(direct)
    ) {
      return direct.toLowerCase();
    }
  }
  const startPayload = String(body?.startPayload || '').trim();
  if (startPayload) {
    const parsed = parseStartApplyPayload(startPayload);
    if (parsed?.positionId) return parsed.positionId;
  }
  const applyLink = String(body?.applyLink || '').trim();
  if (applyLink) {
    const extracted = extractApplyStartPayloadFromUrl(applyLink);
    const parsed = parseStartApplyPayload(extracted);
    if (parsed?.positionId) return parsed.positionId;
  }
  return null;
}

async function listPublisherUsers() {
  const telegramIds = [...config.botPublisherTelegramIds];
  if (!telegramIds.length) return [];
  const users = await models.Users.findAll({
    where: { TelegramChatId: { [Op.in]: telegramIds } },
    order: [['Id', 'ASC']],
  });
  return users.map((u) => {
    const projection = buildAdminUserContactProjection(u);
    return {
      id: u.Id,
      telegramChatId: String(u.TelegramChatId),
      telegramUserName: u.TelegramUserName,
      displayName: displayNameFromUser(u, projection),
    };
  });
}

export function createApplyLinkRouter() {
  const router = Router();

  router.get('/api/app/apply-link/publishers', publisherMiniAppAuth, async (req, res) => {
    try {
      const telegramUserId = Number(req.miniAppUser?.id);
      const isBotAdmin = isBotAdminTelegramId(telegramUserId);
      const all = await listPublisherUsers();
      if (isBotAdmin) {
        return res.json({ publishers: all, canSelectPublisher: true });
      }
      const self = all.find((p) => Number(p.telegramChatId) === telegramUserId);
      return res.json({
        publishers: self ? [self] : [],
        canSelectPublisher: false,
      });
    } catch (err) {
      console.error('GET /api/app/apply-link/publishers:', err);
      return res.status(500).json({ error: 'Failed to load publishers' });
    }
  });

  router.post('/api/app/apply-link/build', publisherMiniAppAuth, async (req, res) => {
    try {
      const positionId = resolvePositionIdFromBody(req.body);
      if (!positionId) {
        return res.status(400).json({ error: 'Could not parse position id from apply link' });
      }

      const position = await models.Positions.findByPk(positionId);
      if (!position || position.IsArchived) {
        return res.status(404).json({ error: 'Position not found' });
      }

      const chatParsed = parsePublishedInChatId(req.body?.publishedInChatId);
      if (!chatParsed.ok) return res.status(400).json({ error: chatParsed.error });
      const publishedInChatId = chatParsed.value;

      const telegramUserId = Number(req.miniAppUser?.id);
      const isBotAdmin = isBotAdminTelegramId(telegramUserId);
      const allowedPublishers = await listPublisherUsers();
      const allowedIds = new Set(allowedPublishers.map((p) => p.id));

      let publisherUserId = Number.parseInt(String(req.body?.publisherUserId ?? ''), 10);
      if (!Number.isSafeInteger(publisherUserId) || publisherUserId <= 0) {
        publisherUserId = req.actorUser.Id;
      }

      if (!allowedIds.has(publisherUserId)) {
        return res.status(400).json({ error: 'Invalid publisherUserId' });
      }
      if (!isBotAdmin && publisherUserId !== req.actorUser.Id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const startPayload = buildTrackedApplyStartPayload(
        positionId,
        publisherUserId,
        publishedInChatId
      );
      const botUsername = String(runtimeBot.username || '').trim();
      const applyLink = buildTelegramApplyLink(botUsername, startPayload);
      if (!applyLink) {
        return res.status(503).json({ error: 'Bot username is not available' });
      }

      return res.json({
        applyLink,
        startPayload,
        positionId,
        publisherUserId,
        publishedInChatId,
      });
    } catch (err) {
      console.error('POST /api/app/apply-link/build:', err);
      const message = err?.message || 'Failed to build apply link';
      if (message.includes('64 character')) {
        return res.status(400).json({ error: message });
      }
      return res.status(500).json({ error: 'Failed to build apply link' });
    }
  });

  return router;
}
