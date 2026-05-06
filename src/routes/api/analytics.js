import { Router } from 'express';
import { miniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { ensureUserByTelegramId } from '../../services/userService.js';
import { getRequiredChannelsState, serializeRequiredChannels, ensureRequiredChannelUserRecords } from '../../services/channelService.js';
import { ensureChannelSubscribeBonus, getUserEntitlement, buildMonetizationStatus } from '../../services/planService.js';

export function createAnalyticsRouter() {
  const router = Router();

  router.post('/api/app/analytics/search-click', miniAppAuth, async (req, res) => {
    try {
      const searchUrl = String(req.body?.searchUrl ?? '').trim();
      if (!searchUrl) return res.status(400).json({ error: 'searchUrl is required' });
      if (searchUrl.length > 8192) return res.status(400).json({ error: 'searchUrl is too long' });
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      if (!user) return res.status(404).json({ error: 'User not found' });
      await models.SearchClicks.create({ UserId: user.Id, SearchUrl: searchUrl });
      return res.json({ ok: true });
    } catch (err) {
      console.error('POST /api/app/analytics/search-click:', err);
      return res.status(500).json({ error: 'Failed to record search click' });
    }
  });

  router.post('/api/app/analytics/job-details-open', miniAppAuth, async (req, res) => {
    try {
      const jobId = Number.parseInt(String(req.body?.jobId ?? ''), 10);
      if (!Number.isSafeInteger(jobId) || jobId <= 0) {
        return res.status(400).json({ error: 'jobId is required and must be a positive integer' });
      }
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      if (!user) return res.status(404).json({ error: 'User not found' });

      const channelsState = await getRequiredChannelsState(req.miniAppUser.id);
      if (channelsState.reason === 'unavailable') {
        return res.status(503).json({ error: 'Subscription check is temporarily unavailable' });
      }
      if (!channelsState.ok) {
        return res.status(403).json({
          error: 'subscribe_required',
          channels: serializeRequiredChannels(channelsState.channels),
          requiredForAllPlans: true,
        });
      }
      await ensureChannelSubscribeBonus(user.Id);

      const entitlement = await getUserEntitlement(user.Id);
      if (entitlement.remainingOpens <= 0) {
        return res.status(402).json({
          error: 'payment_required',
          requiredForAllPlans: true,
          monetization: await buildMonetizationStatus(user.Id),
        });
      }

      await models.JobDetailsOpens.create({ UserId: user.Id, JobId: jobId });
      const updatedEntitlement = await getUserEntitlement(user.Id);
      return res.json({
        ok: true,
        subscribeSatisfied: true,
        requiredForAllPlans: true,
        usedThisMonth: updatedEntitlement.usedThisMonth,
        remainingOpens: updatedEntitlement.remainingOpens,
      });
    } catch (err) {
      console.error('POST /api/app/analytics/job-details-open:', err);
      return res.status(500).json({ error: 'Failed to record job details open' });
    }
  });

  router.post('/api/app/required-channels/verify', miniAppAuth, async (req, res) => {
    try {
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      if (!user) return res.status(404).json({ error: 'User not found' });

      const channelsState = await getRequiredChannelsState(req.miniAppUser.id);
      if (channelsState.reason === 'unavailable') {
        return res.status(503).json({ error: 'Subscription check is temporarily unavailable' });
      }

      let grantedBonusOpens = 0;
      if (channelsState.ok) {
        await ensureRequiredChannelUserRecords(req.miniAppUser.id);
        grantedBonusOpens = await ensureChannelSubscribeBonus(user.Id);
      }
      const monetization = await buildMonetizationStatus(user.Id);
      return res.json({
        ok: channelsState.ok,
        channels: serializeRequiredChannels(channelsState.channels),
        requiredForAllPlans: true,
        grantedBonusOpens,
        monetization,
      });
    } catch (err) {
      console.error('POST /api/app/required-channels/verify:', err);
      return res.status(500).json({ error: 'Failed to verify required channels' });
    }
  });

  return router;
}
