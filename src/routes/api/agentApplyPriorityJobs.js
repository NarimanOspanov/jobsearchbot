import { Router } from 'express';
import { models } from '../../db.js';
import { applyPriorityCronSecretAuth } from '../../middleware/applyPriorityCronSecretAuth.js';
import {
  enqueueApplyPriorityJobsForClients,
  getAgentApplyPriorityQueueSnapshot,
  getAgentApplyPriorityQueueState,
  initAgentApplyPriorityQueue,
} from '../../services/agentApplyPriorityQueueService.js';
import { enqueueApplyPriorityForDefaultClientSearches } from '../../services/agentApplyPriorityCronService.js';

function parseAgentUserId(req) {
  const parsed = Number.parseInt(String(req.query.agentUserId || req.body?.agentUserId || ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createAgentApplyPriorityJobsRouter() {
  initAgentApplyPriorityQueue();
  const router = Router();

  router.get('/api/cron/agent-apply-priority/status', applyPriorityCronSecretAuth, async (_req, res) => {
    try {
      const snapshot = await getAgentApplyPriorityQueueSnapshot();
      return res.json({ ok: true, ...snapshot });
    } catch (err) {
      console.error('GET /api/cron/agent-apply-priority/status:', err);
      return res.status(500).json({ error: 'Failed to load apply-priority queue status' });
    }
  });

  const enqueueAll = async (req, res) => {
    try {
      const agentUserId = parseAgentUserId(req);
      if (!agentUserId) return res.status(400).json({ error: 'agentUserId is required' });
      const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
      if (!jobs.length) return res.status(400).json({ error: 'jobs array is required' });

      const assignments = await models.AgentClients.findAll({
        where: { AgentUserId: agentUserId },
        include: [{ model: models.Users, as: 'Client', required: true }],
      });
      const clientUserIds = assignments
        .map((row) => row.Client)
        .filter((u) => u && String(u.ResumeURL || '').trim())
        .map((u) => Number(u.Id));

      const queued = await enqueueApplyPriorityJobsForClients({
        clientUserIds,
        jobs,
        requestedBy: req.query.requestedBy || req.body?.requestedBy || null,
      });
      return res.json({
        ok: true,
        agentUserId,
        totalAssignedWithResume: clientUserIds.length,
        ...queued,
      });
    } catch (err) {
      console.error('POST /api/cron/agent-apply-priority/enqueue-all:', err);
      return res.status(500).json({
        error: 'Failed to enqueue apply-priority jobs',
        message: err?.message || String(err),
      });
    }
  };

  router.post('/api/cron/agent-apply-priority/enqueue-all', applyPriorityCronSecretAuth, enqueueAll);
  router.get('/api/cron/agent-apply-priority/enqueue-all', applyPriorityCronSecretAuth, enqueueAll);

  const enqueueDefault = async (req, res) => {
    try {
      const agentUserId = parseAgentUserId(req);
      const pageSize = Number.parseInt(String(req.query.pageSize || req.body?.pageSize || '100'), 10);
      const maxPages = Number.parseInt(String(req.query.maxPages || req.body?.maxPages || '5'), 10);
      const payload = await enqueueApplyPriorityForDefaultClientSearches({
        agentUserId,
        pageSize,
        maxPages,
        requestedBy: req.query.requestedBy || req.body?.requestedBy || 'cron-default',
      });
      return res.json(payload);
    } catch (err) {
      console.error('POST /api/cron/agent-apply-priority/enqueue-default:', err);
      return res.status(500).json({
        error: 'Failed to enqueue default apply-priority jobs',
        message: err?.message || String(err),
      });
    }
  };

  router.post('/api/cron/agent-apply-priority/enqueue-default', applyPriorityCronSecretAuth, enqueueDefault);
  router.get('/api/cron/agent-apply-priority/enqueue-default', applyPriorityCronSecretAuth, enqueueDefault);

  const queueState = getAgentApplyPriorityQueueState();
  if (queueState?.boardAdapter) {
    router.use('/api/cron/agent-apply-priority/board', applyPriorityCronSecretAuth, queueState.boardAdapter.getRouter());
  }

  return router;
}
