import { Router } from 'express';
import { Sequelize } from 'sequelize';
import { adminMiniAppAuth, agentMiniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { buildAdminUserContactProjection } from '../../services/userService.js';
import {
  assertCanAccessClient,
  mapUserToAgentClientPayload,
} from '../../services/agentAccessService.js';

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
      if (agentUserId === clientUserId) {
        return res.status(400).json({ error: 'Agent and client must be different users' });
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
      if (nextAgentId === nextClientId) {
        return res.status(400).json({ error: 'Agent and client must be different users' });
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
