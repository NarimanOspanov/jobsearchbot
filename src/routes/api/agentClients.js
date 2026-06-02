import { Router } from 'express';
import express from 'express';
import { Sequelize } from 'sequelize';
import { adminMiniAppAuth, agentMiniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { buildAdminUserContactProjection, isSupportedResumeMimeType, saveUserResumeFromBuffer } from '../../services/userService.js';
import {
  assertCanAccessClient,
  mapUserToAgentClientPayload,
} from '../../services/agentAccessService.js';
import { rankJobsForAgentApply } from '../../services/agentApplyPriorityService.js';

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

function mapAssignmentRow(row) {
  const agent = row.Agent;
  const client = row.Client;
  const agentProj = agent ? buildAdminUserContactProjection(agent) : {};
  const clientProj = client ? buildAdminUserContactProjection(client) : {};
  return {
    id: row.Id,
    agentUserId: row.AgentUserId,
    clientUserId: row.ClientUserId,
    createdAt: row.CreatedAt,
    agent: agent
      ? {
          id: agent.Id,
          telegramChatId: String(agent.TelegramChatId),
          telegramUserName: agent.TelegramUserName,
          displayName: displayNameFromUser(agent, agentProj),
        }
      : null,
    client: client
      ? {
          id: client.Id,
          telegramChatId: String(client.TelegramChatId),
          telegramUserName: client.TelegramUserName,
          displayName: displayNameFromUser(client, clientProj),
          resumeUrl: client.ResumeURL || null,
        }
      : null,
  };
}

const CLIENT_COMMENT_MAX_LENGTH = 4000;

function parseImpersonateAgentUserId(req) {
  const n = Number.parseInt(String(req.query.agentUserId || req.body?.agentUserId || ''), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function enforceAgentClientAccess(req, res, clientUserId) {
  if (Number(req.actorUser.Id) === Number(clientUserId)) return true;
  const access = await assertCanAccessClient({
    actorUserId: req.actorUser.Id,
    clientUserId,
    isBotAdmin: req.isBotAdmin,
    impersonateAgentUserId: parseImpersonateAgentUserId(req),
  });
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return false;
  }
  return true;
}

function resolveEffectiveAgentUserId(req) {
  const requested = Number.parseInt(String(req.query.agentUserId || ''), 10);
  if (req.isBotAdmin) {
    if (Number.isSafeInteger(requested) && requested > 0) return requested;
    return req.actorUser.Id;
  }
  if (Number.isSafeInteger(requested) && requested > 0 && requested !== req.actorUser.Id) {
    return null;
  }
  return req.actorUser.Id;
}

function buildApplyPriorityContextKey(client, jobs) {
  const searchMode = String(client?.SearchMode || 'not_urgent').trim();
  const comment = String(client?.Comment || '').trim();
  const resumeUrl = String(client?.ResumeURL || '').trim();
  const jobIds = (Array.isArray(jobs) ? jobs : [])
    .map((job) => Number.parseInt(String(job?.id ?? ''), 10))
    .filter((id) => Number.isSafeInteger(id))
    .sort((a, b) => a - b)
    .join(',');
  return `${searchMode}|${comment}|${resumeUrl}|${jobIds}`;
}

async function persistApplyPriorityForPageJobs({ clientUserId, client, jobs, rankings, context }) {
  const normalizedJobs = (Array.isArray(jobs) ? jobs : [])
    .map((job) => ({
      id: Number.parseInt(String(job?.id ?? ''), 10),
      title: String(job?.title || '').trim(),
      company: String(job?.company || '').trim(),
      source: String(job?.source || '').trim() || null,
      applyUrl: String(job?.applyUrl || '').trim() || null,
      location: String(job?.location || '').trim() || null,
      shortSummary: String(job?.shortSummary || '').trim() || null,
    }))
    .filter((job) => Number.isSafeInteger(job.id));
  if (!normalizedJobs.length) return { createdCount: 0, updatedCount: 0, total: 0 };

  const rankingByJobId = new Map(
    (Array.isArray(rankings) ? rankings : []).map((row) => [Number.parseInt(String(row?.jobId ?? ''), 10), row])
  );
  const jobIds = normalizedJobs.map((job) => job.id);
  const existingRows = await models.Applications.findAll({
    where: {
      UserId: clientUserId,
      ScreenlyJobId: { [Sequelize.Op.in]: jobIds },
    },
  });
  const existingByJobId = new Map(existingRows.map((row) => [Number(row.ScreenlyJobId), row]));
  const contextKey = buildApplyPriorityContextKey(client, normalizedJobs);
  const analyzedAt = new Date().toISOString();

  let createdCount = 0;
  let updatedCount = 0;
  for (const job of normalizedJobs) {
    const ranking = rankingByJobId.get(job.id);
    if (!ranking) continue;
    const applyPriorityJson = JSON.stringify({
      score: Number(ranking.score) || 0,
      applyRank: Number(ranking.applyRank) || 0,
      priority: String(ranking.priority || 'good'),
      justification: String(ranking.justification || ''),
      skipReason: ranking.skipReason ? String(ranking.skipReason) : null,
      analyzedAt,
      contextKey,
      context: context || null,
    });

    const row = existingByJobId.get(job.id);
    if (row) {
      await row.update({ ApplyPriorityJson: applyPriorityJson });
      updatedCount += 1;
      continue;
    }

    await models.Applications.create({
      UserId: clientUserId,
      VacancyTitle: (job.title || `Screenly #${job.id}`).slice(0, 255),
      CompanyName: job.company ? job.company.slice(0, 255) : null,
      Source: job.source ? job.source.slice(0, 50) : null,
      ScreenlyJobId: job.id,
      Status: 'new',
      AppliedAt: new Date(),
      MetaJson: JSON.stringify({
        positionId: job.id,
        applyUrl: job.applyUrl,
        location: job.location,
        shortSummary: job.shortSummary,
        createdBy: 'agent-apply-priority',
      }),
      ApplyPriorityJson: applyPriorityJson,
    });
    createdCount += 1;
  }

  return { createdCount, updatedCount, total: createdCount + updatedCount };
}

export function createAgentClientsRouter() {
  const router = Router();

  router.get('/api/app/agent/clients', agentMiniAppAuth, async (req, res) => {
    try {
      const effectiveAgentId = resolveEffectiveAgentUserId(req);
      if (!effectiveAgentId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (req.isBotAdmin) {
        const requested = Number.parseInt(String(req.query.agentUserId || ''), 10);
        if (Number.isSafeInteger(requested) && requested > 0) {
          const agentExists = await models.Users.findByPk(requested, { attributes: ['Id'] });
          if (!agentExists) return res.status(404).json({ error: 'Agent not found' });
        }
      } else if (!(await models.AgentClients.findOne({
        where: { AgentUserId: effectiveAgentId },
        attributes: ['Id'],
      }))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

      const assignments = await models.AgentClients.findAll({
        where: { AgentUserId: effectiveAgentId },
        include: [{ model: models.Users, as: 'Client', required: true }],
        order: [['CreatedAt', 'DESC'], ['Id', 'DESC']],
        limit,
        offset,
      });

      const clients = assignments
        .map((a) => a.Client)
        .filter((u) => u && String(u.ResumeURL || '').trim())
        .map((u) => mapUserToAgentClientPayload(u));

      return res.json({
        agentUserId: effectiveAgentId,
        clients,
      });
    } catch (err) {
      console.error('GET /api/app/agent/clients:', err);
      return res.status(500).json({ error: 'Failed to load agent clients' });
    }
  });

  router.get('/api/app/admin/agents', adminMiniAppAuth, async (_req, res) => {
    try {
      const rows = await models.AgentClients.findAll({ attributes: ['AgentUserId'], raw: true });
      const agentIds = [...new Set(rows.map((r) => Number(r.AgentUserId)).filter((id) => id > 0))];
      if (!agentIds.length) return res.json([]);

      const users = await models.Users.findAll({
        where: { Id: { [Sequelize.Op.in]: agentIds } },
        order: [['Id', 'DESC']],
      });

      return res.json(
        users.map((u) => {
          const projection = buildAdminUserContactProjection(u);
          return {
            id: u.Id,
            telegramChatId: String(u.TelegramChatId),
            telegramUserName: u.TelegramUserName,
            displayName: displayNameFromUser(u, projection),
          };
        })
      );
    } catch (err) {
      console.error('GET /api/app/admin/agents:', err);
      return res.status(500).json({ error: 'Failed to load agents' });
    }
  });

  router.get('/api/app/admin/agent-clients', adminMiniAppAuth, async (_req, res) => {
    try {
      const rows = await models.AgentClients.findAll({
        include: [
          { model: models.Users, as: 'Agent', required: true },
          { model: models.Users, as: 'Client', required: true },
        ],
        order: [['CreatedAt', 'DESC'], ['Id', 'DESC']],
      });
      return res.json(rows.map(mapAssignmentRow));
    } catch (err) {
      console.error('GET /api/app/admin/agent-clients:', err);
      return res.status(500).json({ error: 'Failed to load agent-client assignments' });
    }
  });

  router.post('/api/app/admin/agent-clients', adminMiniAppAuth, async (req, res) => {
    try {
      const agentUserId = Number.parseInt(String(req.body?.agentUserId ?? ''), 10);
      const clientUserId = Number.parseInt(String(req.body?.clientUserId ?? ''), 10);
      if (!Number.isSafeInteger(agentUserId) || agentUserId <= 0) {
        return res.status(400).json({ error: 'agentUserId is required' });
      }
      if (!Number.isSafeInteger(clientUserId) || clientUserId <= 0) {
        return res.status(400).json({ error: 'clientUserId is required' });
      }

      const [agent, client] = await Promise.all([
        models.Users.findByPk(agentUserId),
        models.Users.findByPk(clientUserId),
      ]);
      if (!agent) return res.status(404).json({ error: 'Agent user not found' });
      if (!client) return res.status(404).json({ error: 'Client user not found' });

      const existing = await models.AgentClients.findOne({ where: { ClientUserId: clientUserId } });
      if (existing) {
        return res.status(409).json({ error: 'Client is already assigned to an agent' });
      }

      const row = await models.AgentClients.create({ AgentUserId: agentUserId, ClientUserId: clientUserId });
      const loaded = await models.AgentClients.findByPk(row.Id, {
        include: [
          { model: models.Users, as: 'Agent', required: true },
          { model: models.Users, as: 'Client', required: true },
        ],
      });
      return res.status(201).json(mapAssignmentRow(loaded));
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Client is already assigned to an agent' });
      }
      console.error('POST /api/app/admin/agent-clients:', err);
      return res.status(500).json({ error: 'Failed to create assignment' });
    }
  });

  router.patch('/api/app/admin/agent-clients/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.AgentClients.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Assignment not found' });

      const nextAgentId =
        req.body?.agentUserId != null
          ? Number.parseInt(String(req.body.agentUserId), 10)
          : row.AgentUserId;
      const nextClientId =
        req.body?.clientUserId != null
          ? Number.parseInt(String(req.body.clientUserId), 10)
          : row.ClientUserId;

      if (!Number.isSafeInteger(nextAgentId) || nextAgentId <= 0) {
        return res.status(400).json({ error: 'Invalid agentUserId' });
      }
      if (!Number.isSafeInteger(nextClientId) || nextClientId <= 0) {
        return res.status(400).json({ error: 'Invalid clientUserId' });
      }

      const [agent, client] = await Promise.all([
        models.Users.findByPk(nextAgentId),
        models.Users.findByPk(nextClientId),
      ]);
      if (!agent) return res.status(404).json({ error: 'Agent user not found' });
      if (!client) return res.status(404).json({ error: 'Client user not found' });

      if (nextClientId !== row.ClientUserId) {
        const conflict = await models.AgentClients.findOne({
          where: {
            ClientUserId: nextClientId,
            Id: { [Sequelize.Op.ne]: id },
          },
        });
        if (conflict) return res.status(409).json({ error: 'Client is already assigned to an agent' });
      }

      await row.update({ AgentUserId: nextAgentId, ClientUserId: nextClientId });
      const loaded = await models.AgentClients.findByPk(id, {
        include: [
          { model: models.Users, as: 'Agent', required: true },
          { model: models.Users, as: 'Client', required: true },
        ],
      });
      return res.json(mapAssignmentRow(loaded));
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Client is already assigned to an agent' });
      }
      console.error('PATCH /api/app/admin/agent-clients/:id:', err);
      return res.status(500).json({ error: 'Failed to update assignment' });
    }
  });

  router.patch(
    '/api/app/agent/clients/:clientUserId/comment',
    agentMiniAppAuth,
    async (req, res) => {
      try {
        const clientUserId = Number.parseInt(String(req.params.clientUserId), 10);
        if (!Number.isSafeInteger(clientUserId) || clientUserId <= 0) {
          return res.status(400).json({ error: 'Invalid client user id' });
        }
        if (!(await enforceAgentClientAccess(req, res, clientUserId))) return;

        if (!('comment' in req.body)) {
          return res.status(400).json({ error: 'comment is required' });
        }

        let comment = null;
        if (req.body.comment != null) {
          const raw = String(req.body.comment).trim();
          if (raw.length > CLIENT_COMMENT_MAX_LENGTH) {
            return res.status(400).json({
              error: `comment must be at most ${CLIENT_COMMENT_MAX_LENGTH} characters`,
            });
          }
          comment = raw || null;
        }

        await models.Users.update({ Comment: comment }, { where: { Id: clientUserId } });
        return res.json({ ok: true, comment });
      } catch (err) {
        console.error('PATCH /api/app/agent/clients/:clientUserId/comment:', err);
        return res.status(500).json({ error: 'Failed to save client comment' });
      }
    }
  );

  router.post(
    '/api/app/agent/clients/:clientUserId/resume-upload',
    agentMiniAppAuth,
    express.raw({ type: 'application/octet-stream', limit: '15mb' }),
    async (req, res) => {
      try {
        const clientUserId = Number.parseInt(String(req.params.clientUserId), 10);
        if (!Number.isSafeInteger(clientUserId) || clientUserId <= 0) {
          return res.status(400).json({ error: 'Invalid client user id' });
        }
        if (!(await enforceAgentClientAccess(req, res, clientUserId))) return;

        const client = await models.Users.findByPk(clientUserId);
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : null;
        if (!bodyBuffer || bodyBuffer.length === 0) {
          return res.status(400).json({ error: 'Resume file bytes are required' });
        }

        const headerFileNameRaw = String(req.headers['x-file-name'] || '').trim();
        const headerMimeTypeRaw = String(req.headers['x-file-type'] || '').trim().toLowerCase();
        const fileName = headerFileNameRaw || `resume-${Date.now()}.pdf`;
        const mimeType = headerMimeTypeRaw || 'application/octet-stream';
        if (!isSupportedResumeMimeType(mimeType)) {
          return res.status(400).json({ error: 'Unsupported resume type. Use PDF or image (JPG/PNG/WEBP).' });
        }

        const resumeUrl = await saveUserResumeFromBuffer({
          user: client,
          buffer: bodyBuffer,
          fileName,
          mimeType,
          fileIdPrefix: `agent-${req.actorUser.Id}`,
        });
        return res.json({ ok: true, resumeUrl });
      } catch (err) {
        console.error('POST /api/app/agent/clients/:clientUserId/resume-upload:', err);
        return res.status(500).json({ error: 'Failed to upload client resume' });
      }
    }
  );

  router.post('/api/app/agent/clients/:clientUserId/apply-priority', agentMiniAppAuth, async (req, res) => {
    const requestStartedAt = Date.now();
    try {
      const clientUserId = Number.parseInt(String(req.params.clientUserId), 10);
      if (!Number.isSafeInteger(clientUserId) || clientUserId <= 0) {
        return res.status(400).json({ error: 'Invalid client user id' });
      }
      if (!(await enforceAgentClientAccess(req, res, clientUserId))) return;

      const client = await models.Users.findByPk(clientUserId);
      if (!client) return res.status(404).json({ error: 'Client not found' });

      const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
      if (!jobs.length) return res.status(400).json({ error: 'jobs array is required' });

      const result = await rankJobsForAgentApply({ clientUser: client, jobs });
      const persisted = await persistApplyPriorityForPageJobs({
        clientUserId,
        client,
        jobs,
        rankings: result.rankings,
        context: result.context,
      });
      console.info('apply-priority completed', {
        clientUserId,
        actorUserId: req.actorUser?.Id ?? null,
        jobs: result?.context?.jobCount ?? jobs.length,
        chunks: result?.context?.chunkCount ?? null,
        totalDurationMs: Date.now() - requestStartedAt,
        avgChunkDurationMs: result?.context?.avgChunkDurationMs ?? null,
        maxChunkDurationMs: result?.context?.maxChunkDurationMs ?? null,
        persistedCount: persisted.total,
        createdCount: persisted.createdCount,
        updatedCount: persisted.updatedCount,
      });
      return res.json({ ok: true, ...result, persisted });
    } catch (err) {
      const message = String(err?.message || err);
      if (message.includes('Upload client resume') || message.includes('Resume text is empty')) {
        return res.status(400).json({ error: message });
      }
      console.error('POST /api/app/agent/clients/:clientUserId/apply-priority:', err);
      return res.status(500).json({ error: 'Failed to analyze apply priority' });
    }
  });

  router.delete('/api/app/admin/agent-clients/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const row = await models.AgentClients.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Assignment not found' });
      await row.destroy();
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/app/admin/agent-clients/:id:', err);
      return res.status(500).json({ error: 'Failed to delete assignment' });
    }
  });

  return router;
}
