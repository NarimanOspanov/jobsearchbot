import { Router } from 'express';
import { miniAppAuth } from '../../middleware/auth.js';
import { getPlanByCode, buildMonetizationStatus } from '../../services/planService.js';
import { ensureUserByTelegramId } from '../../services/userService.js';
import { getRequiredChannelsState, serializeRequiredChannels } from '../../services/channelService.js';
import { runtimeBot } from '../../bot/state.js';

export function createMonetizationRouter() {
  const router = Router();

  router.get('/api/app/bot-info', (_req, res) => res.json({ botUsername: runtimeBot.username }));

  router.get('/api/app/monetization/status', miniAppAuth, async (req, res) => {
    try {
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      const channelsState = await getRequiredChannelsState(req.miniAppUser.id);
      const monetization = await buildMonetizationStatus(user.Id);
      return res.json({
        ok: true,
        requiredChannelsSatisfied: channelsState.ok,
        requiredChannels: serializeRequiredChannels(channelsState.channels),
        monetization,
      });
    } catch (err) {
      console.error('GET /api/app/monetization/status:', err);
      return res.status(500).json({ error: 'Failed to load monetization status' });
    }
  });

  router.get('/api/app/monetization/pay-link', miniAppAuth, async (req, res) => {
    try {
      const requestedCode = String(req.query.plan || '').trim().toLowerCase();
      const plan = requestedCode ? await getPlanByCode(requestedCode) : null;
      const safeCode = String(plan?.Code || requestedCode || 'silver').toLowerCase();
      const botUsername = String(runtimeBot.username || '').trim();
      if (!botUsername) {
        return res.status(503).json({ error: 'Bot username is unavailable' });
      }
      const deepLink = `https://t.me/${botUsername}?start=${encodeURIComponent(`buy_${safeCode}`)}`;
      return res.json({ ok: true, deepLink, planCode: safeCode });
    } catch (err) {
      console.error('GET /api/app/monetization/pay-link:', err);
      return res.status(500).json({ error: 'Failed to build payment link' });
    }
  });

  return router;
}
