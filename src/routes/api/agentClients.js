import { Router } from 'express';
import express from 'express';
import { Sequelize } from 'sequelize';
import { adminMiniAppAuth, agentMiniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import {
  buildAdminUserContactProjection,
  isSupportedResumeMimeType,
  normalizeSkillIds,
  saveUserResumeFromBuffer,
} from '../../services/userService.js';
import {
  assertCanAccessClient,
  mapUserToAgentClientPayload,
} from '../../services/agentAccessService.js';
import { rankJobsForAgentApply } from '../../services/agentApplyPriorityService.js';
import { persistApplyPriorityForPageJobs } from '../../services/agentApplyPriorityPersistenceService.js';
import { enqueueApplyPriorityDefaultForClient } from '../../services/agentApplyPriorityCronService.js';
import { enqueueApplyPriorityJobsForClients, getAgentApplyPriorityQueueState } from '../../services/agentApplyPriorityQueueService.js';
import {
  listHumanAssistantRequests,
  markHumanAssistantRequestAssigned,
} from '../../services/humanAssistantRequestService.js';
import {
  toSearchModeOrUndefined,
  toSkillIdsOrNullOrUndefined,
  toWorkAuthCountriesOrNullOrUndefined,
} from '../../utils/validators.js';
import {
  buildAgentPerformanceStats,
  parseAgentPerformancePeriod,
  resolvePerformanceAgentUserId,
} from '../../services/agentPerformanceStatsService.js';

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

function mapHumanAssistantRequestRow(row) {
  const user = row.User;
  return {
    id: row.Id,
    userId: row.UserId,
    createdAt: row.CreatedAt,
    status: row.Status,
    source: row.Source,
    assignedAt: row.AssignedAt,
    client: user ? mapUserToAgentClientPayload(user) : null,
  };
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
const CLIENT_NOTE_MAX_LENGTH = 4000;

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

  router.get('/api/app/agent/performance', agentMiniAppAuth, async (req, res) => {
    try {
      const agentUserId = resolvePerformanceAgentUserId(req);
      if (agentUserId === undefined) return res.status(403).json({ error: 'Forbidden' });
      const period = parseAgentPerformancePeriod(req.query.period, 7);
      const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
      const stats = await buildAgentPerformanceStats({ since, agentUserId });
      return res.json({
        success: true,
        period,
        since: since.toISOString(),
        agentUserId,
        ...stats,
      });
    } catch (err) {
      console.error('GET /api/app/agent/performance:', err);
      return res.status(500).json({ error: 'Failed to load agent performance stats' });
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

  router.get('/api/app/admin/human-assistant-requests', adminMiniAppAuth, async (req, res) => {
    try {
      const status = String(req.query.status || 'pending').trim().toLowerCase() || 'pending';
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await listHumanAssistantRequests({ status, limit, offset });
      return res.json({
        status,
        requests: rows.map(mapHumanAssistantRequestRow),
      });
    } catch (err) {
      console.error('GET /api/app/admin/human-assistant-requests:', err);
      return res.status(500).json({ error: 'Failed to load human assistant requests' });
    }
  });

  router.post(
    '/api/app/admin/clients/:clientUserId/apply-priority/enqueue-default',
    adminMiniAppAuth,
    async (req, res) => {
      try {
        const clientUserId = Number.parseInt(String(req.params.clientUserId), 10);
        if (!Number.isSafeInteger(clientUserId) || clientUserId <= 0) {
          return res.status(400).json({ error: 'Invalid client user id' });
        }
        const client = await models.Users.findByPk(clientUserId);
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const rewrite = Boolean(req.body?.rewrite);
        const daysRaw = Number.parseInt(String(req.body?.days ?? '7'), 10);
        const days = Number.isSafeInteger(daysRaw) && daysRaw > 0 ? daysRaw : 7;
        const payload = await enqueueApplyPriorityDefaultForClient({
          clientUserId,
          requestedBy: `admin:${req.actorUser?.Id ?? 'unknown'}`,
          rewrite,
          days,
        });
        return res.json(payload);
      } catch (err) {
        console.error('POST /api/app/admin/clients/:clientUserId/apply-priority/enqueue-default:', err);
        return res.status(500).json({
          error: 'Failed to enqueue apply-priority jobs',
          message: err?.message || String(err),
        });
      }
    }
  );

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
      await markHumanAssistantRequestAssigned(clientUserId);
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
      await markHumanAssistantRequestAssigned(nextClientId);
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

  router.patch(
    '/api/app/agent/clients/:clientUserId/settings',
    agentMiniAppAuth,
    async (req, res) => {
      try {
        const clientUserId = Number.parseInt(String(req.params.clientUserId), 10);
        if (!Number.isSafeInteger(clientUserId) || clientUserId <= 0) {
          return res.status(400).json({ error: 'Invalid client user id' });
        }
        if (!(await enforceAgentClientAccess(req, res, clientUserId))) return;

        const client = await models.Users.findByPk(clientUserId);
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const updates = {};
        if ('comment' in req.body) {
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
          updates.Comment = comment;
        }
        if ('note' in req.body) {
          let note = null;
          if (req.body.note != null) {
            const raw = String(req.body.note).trim();
            if (raw.length > CLIENT_NOTE_MAX_LENGTH) {
              return res.status(400).json({
                error: `note must be at most ${CLIENT_NOTE_MAX_LENGTH} characters`,
              });
            }
            note = raw || null;
          }
          updates.Note = note;
        }
        if ('searchMode' in req.body) {
          const searchMode = toSearchModeOrUndefined(req.body.searchMode);
          if (searchMode === undefined) {
            return res.status(400).json({ error: 'Invalid searchMode' });
          }
          updates.SearchMode = searchMode;
        }
        if ('workAuthorizationCountries' in req.body) {
          const workAuthorizationCountries = toWorkAuthCountriesOrNullOrUndefined(
            req.body.workAuthorizationCountries
          );
          if (workAuthorizationCountries === undefined) {
            return res.status(400).json({ error: 'Invalid workAuthorizationCountries' });
          }
          updates.WorkAuthorizationCountries = workAuthorizationCountries;
        }
        if ('skills' in req.body) {
          const skillIds = toSkillIdsOrNullOrUndefined(req.body.skills, normalizeSkillIds);
          if (skillIds === undefined) {
            return res.status(400).json({ error: 'Invalid skills' });
          }
          updates.skills = skillIds;
        }
        if (!Object.keys(updates).length) {
          return res.status(400).json({ error: 'No valid fields to update' });
        }

        await client.update(updates);
        await client.reload();

        return res.json({
          ok: true,
          comment: client.Comment ?? null,
          note: client.Note ?? null,
          searchMode: client.SearchMode || 'not_urgent',
          workAuthorizationCountries: client.WorkAuthorizationCountries || '',
          skills: Array.isArray(client.skills) ? client.skills : [],
        });
      } catch (err) {
        console.error('PATCH /api/app/agent/clients/:clientUserId/settings:', err);
        return res.status(500).json({ error: 'Failed to save client settings' });
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
          awaitEnrichment: true,
          forceEnrichmentRefresh: true,
        });
        await client.reload();
        return res.json({
          ok: true,
          resumeUrl,
          client: mapUserToAgentClientPayload(client),
        });
      } catch (err) {
        console.error('POST /api/app/agent/clients/:clientUserId/resume-upload:', err);
        return res.status(500).json({ error: 'Failed to upload client resume' });
      }
    }
  );

  router.post('/api/app/agent/clients/apply-priority/enqueue-all', agentMiniAppAuth, async (req, res) => {
    try {
      const queueState = getAgentApplyPriorityQueueState();
      if (!queueState.enabled) {
        return res.status(503).json({ error: 'Apply priority queue is disabled. Configure REDIS_URL first.' });
      }
      const effectiveAgentId = resolveEffectiveAgentUserId(req);
      if (!effectiveAgentId) return res.status(403).json({ error: 'Forbidden' });
      const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
      if (!jobs.length) return res.status(400).json({ error: 'jobs array is required' });

      const assignments = await models.AgentClients.findAll({
        where: { AgentUserId: effectiveAgentId },
        include: [{ model: models.Users, as: 'Client', required: true }],
      });
      const clientUserIds = assignments
        .map((row) => row.Client)
        .filter((u) => u && String(u.ResumeURL || '').trim())
        .filter((u) => String(u.Comment || '').trim())
        .filter((u) => normalizeSkillIds(u.skills).length > 0)
        .map((u) => Number(u.Id));

      const queued = await enqueueApplyPriorityJobsForClients({
        clientUserIds,
        jobs,
        requestedBy: req.actorUser?.Id ?? null,
      });
      return res.json({
        ok: true,
        agentUserId: effectiveAgentId,
        totalAssignedWithResume: clientUserIds.length,
        ...queued,
      });
    } catch (err) {
      console.error('POST /api/app/agent/clients/apply-priority/enqueue-all:', err);
      return res.status(500).json({
        error: 'Failed to enqueue apply-priority jobs',
        message: err?.message || String(err),
      });
    }
  });

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
      if (
        message.includes('Upload client resume') ||
        message.includes('Resume text is empty') ||
        message.includes('Fill in apply preferences') ||
        message.includes('Fill in client comment') ||
        message.includes('Set client roles/skills')
      ) {
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
