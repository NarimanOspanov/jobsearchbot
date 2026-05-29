import { Router } from 'express';
import { runtimeBot } from '../../bot/state.js';
import { screeningCronSecretAuth } from '../../middleware/cronSecretAuth.js';
import {
  buildScreeningJobsUi,
  getPositionApplyScreeningStatus,
  processDueScreeningResponses,
} from '../../services/positionApplyScreeningService.js';

function parseRunOptions(req) {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || req.body?.limit || '50'), 10) || 50));
  const rejectionIdsRaw =
    req.query.rejectionNotificationIds ??
    req.body?.rejectionNotificationIds ??
    req.body?.rejection_notification_Ids;
  const rejectionNotificationIds =
    rejectionIdsRaw != null && String(rejectionIdsRaw).trim() !== ''
      ? String(rejectionIdsRaw)
      : undefined;
  const appIdRaw = req.query.userApplicationId ?? req.body?.userApplicationId;
  const onlyUserApplicationId =
    appIdRaw != null && String(appIdRaw).trim() !== ''
      ? Number.parseInt(String(appIdRaw), 10)
      : null;
  return {
    limit,
    rejectionNotificationIds,
    onlyUserApplicationId:
      Number.isSafeInteger(onlyUserApplicationId) && onlyUserApplicationId > 0
        ? onlyUserApplicationId
        : null,
  };
}

export function createCronRouter() {
  const router = Router();

  router.get('/api/cron/position-apply-screening/status', screeningCronSecretAuth, async (req, res) => {
    try {
      const { rejectionNotificationIds, onlyUserApplicationId } = parseRunOptions(req);
      const status = await getPositionApplyScreeningStatus({
        rejectionNotificationIds,
        onlyUserApplicationId,
      });
      return res.json({
        ok: true,
        telegramReady: Boolean(runtimeBot.telegram),
        jobsUi: buildScreeningJobsUi(),
        ...status,
      });
    } catch (err) {
      console.error('GET /api/cron/position-apply-screening/status:', err);
      return res.status(500).json({ error: 'Failed to load screening status' });
    }
  });

  const runScreening = async (req, res) => {
    try {
      if (!runtimeBot.telegram) {
        return res.status(503).json({ error: 'Telegram bot is unavailable (process not ready)' });
      }
      const { limit, rejectionNotificationIds, onlyUserApplicationId } = parseRunOptions(req);
      const result = await processDueScreeningResponses({
        telegram: runtimeBot.telegram,
        limit,
        rejectionNotificationIds,
        onlyUserApplicationId,
        jobsUi: buildScreeningJobsUi(),
      });
      console.log('Manual position apply screening run:', result);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('position-apply-screening run:', err);
      return res.status(500).json({ error: 'Failed to run position apply screening', message: err?.message });
    }
  };

  router.post('/api/cron/position-apply-screening/run', screeningCronSecretAuth, runScreening);
  router.get('/api/cron/position-apply-screening/run', screeningCronSecretAuth, runScreening);

  return router;
}
