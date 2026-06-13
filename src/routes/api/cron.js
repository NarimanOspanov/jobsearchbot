import { Router } from 'express';
import { runtimeBot, screeningCronHealthState, agentPerformanceDigestCronHealthState } from '../../bot/state.js';
import { screeningCronSecretAuth } from '../../middleware/cronSecretAuth.js';
import {
  buildScreeningJobsUi,
  getPositionApplyScreeningStatus,
} from '../../services/positionApplyScreeningService.js';
import {
  enqueueScreeningTick,
  getPositionApplyScreeningQueueSnapshot,
  getPositionApplyScreeningQueueState,
  initPositionApplyScreeningQueue,
} from '../../services/positionApplyScreeningQueueService.js';
import { runAgentPerformanceDigestCron } from '../../services/agentPerformanceDigestCronScheduler.js';

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

  router.use('/cron/position-apply-screening', (req, res) => {
    res.redirect(308, `/api${req.originalUrl}`);
  });

  const queueState = initPositionApplyScreeningQueue();

  if (queueState?.boardAdapter) {
    router.use(
      '/api/cron/position-apply-screening/board',
      screeningCronSecretAuth,
      queueState.boardAdapter.getRouter()
    );
  }

  router.get('/api/cron/position-apply-screening/status', screeningCronSecretAuth, async (req, res) => {
    try {
      const { rejectionNotificationIds, onlyUserApplicationId } = parseRunOptions(req);
      const status = await getPositionApplyScreeningStatus({
        rejectionNotificationIds,
        onlyUserApplicationId,
      });
      const queueSnapshot = await getPositionApplyScreeningQueueSnapshot();
      return res.json({
        ok: true,
        telegramReady: Boolean(runtimeBot.telegram),
        cronHealth: screeningCronHealthState,
        queue: queueSnapshot,
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
      if (!getPositionApplyScreeningQueueState().enabled) {
        return res.status(503).json({
          error: 'Position apply screening queue is disabled (REDIS_URL is missing)',
        });
      }
      const { limit, rejectionNotificationIds, onlyUserApplicationId } = parseRunOptions(req);
      const enqueued = await enqueueScreeningTick({
        limit,
        rejectionNotificationIds,
        onlyUserApplicationId,
        requestedBy: req.query.requestedBy || req.body?.requestedBy || 'cron-manual',
      });
      return res.json({ ok: true, telegramReady: Boolean(runtimeBot.telegram), ...enqueued });
    } catch (err) {
      console.error('position-apply-screening run:', err);
      return res.status(500).json({ error: 'Failed to run position apply screening', message: err?.message });
    }
  };

  router.post('/api/cron/position-apply-screening/run', screeningCronSecretAuth, runScreening);
  router.get('/api/cron/position-apply-screening/run', screeningCronSecretAuth, runScreening);

  router.get('/api/cron/agent-performance-digest/status', screeningCronSecretAuth, async (_req, res) => {
    return res.json({
      ok: true,
      telegramReady: Boolean(runtimeBot.telegram),
      cronHealth: agentPerformanceDigestCronHealthState,
    });
  });

  const runAgentPerformanceDigest = async (req, res) => {
    try {
      const requestedBy = req.query.requestedBy || req.body?.requestedBy || 'cron-manual';
      const result = await runAgentPerformanceDigestCron(String(requestedBy));
      return res.json({ ok: true, telegramReady: Boolean(runtimeBot.telegram), ...result });
    } catch (err) {
      console.error('agent-performance-digest run:', err);
      return res.status(500).json({ error: 'Failed to send agent performance digest', message: err?.message });
    }
  };

  router.post('/api/cron/agent-performance-digest/run', screeningCronSecretAuth, runAgentPerformanceDigest);
  router.get('/api/cron/agent-performance-digest/run', screeningCronSecretAuth, runAgentPerformanceDigest);

  return router;
}
