import express, { Router } from 'express';
import { Sequelize } from 'sequelize';
import { miniAppAuth, miniAppActorAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { ensureUserByTelegramId } from '../../services/userService.js';
import { assertCanAccessClient } from '../../services/agentAccessService.js';
import { resumeStorage } from '../../services/resumeStorage.js';
import {
  toIntOrNullOrUndefined,
  toScoreOrNullOrUndefined,
  toStringOrUndefined,
} from '../../utils/validators.js';

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

function parseAppliedDateBound(value, endOfDay = false) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

function parseApplicationStatusesCsv(raw) {
  return [...new Set(
    String(raw || '')
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  )];
}

export function createApplicationsRouter() {
  const router = Router();

  router.get('/api/app/applications', async (req, res) => {
    try {
      let userId = Number.parseInt(String(req.query.userId || ''), 10);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        await miniAppAuth(req, res, async () => {
          const { user } = await ensureUserByTelegramId(
            req.miniAppUser.id,
            req.miniAppUser.username ?? null,
            req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
            req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
          );
          userId = user.Id;
        });
        if (!Number.isSafeInteger(userId) || userId <= 0) return;
      }
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.Applications.findAll({
        where: {
          UserId: userId,
          [Sequelize.Op.and]: Sequelize.where(
            Sequelize.fn('lower', Sequelize.col('Status')),
            'applied'
          ),
        },
        order: [['Id', 'DESC']],
        limit,
        offset,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/applications:', err);
      res.status(500).json({ error: 'Failed to load applications' });
    }
  });

  router.get('/api/app/applications/by-user', miniAppActorAuth, async (req, res) => {
    try {
      const userId = Number.parseInt(String(req.query.userId), 10);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId is required and must be a positive integer' });
      }
      if (!(await enforceAgentClientAccess(req, res, userId))) return;

      const screenlyJobIds = String(req.query.screenlyJobIds || '')
        .split(',')
        .map((part) => Number.parseInt(String(part).trim(), 10))
        .filter((id) => Number.isSafeInteger(id) && id > 0);
      const uniqueScreenlyJobIds = [...new Set(screenlyJobIds)];

      const appliedFrom = parseAppliedDateBound(req.query.appliedFrom, false);
      const appliedTo = parseAppliedDateBound(req.query.appliedTo, true);
      const statuses = parseApplicationStatusesCsv(req.query.statuses);

      const where = { UserId: userId };
      if (uniqueScreenlyJobIds.length) {
        where.ScreenlyJobId = { [Sequelize.Op.in]: uniqueScreenlyJobIds };
      }

      const andConditions = [];
      if (appliedFrom || appliedTo) {
        const appliedAtRange = {};
        if (appliedFrom) appliedAtRange[Sequelize.Op.gte] = appliedFrom;
        if (appliedTo) appliedAtRange[Sequelize.Op.lte] = appliedTo;
        andConditions.push({ AppliedAt: appliedAtRange });
      }
      if (statuses.length) {
        andConditions.push(
          Sequelize.where(Sequelize.fn('lower', Sequelize.col('Status')), {
            [Sequelize.Op.in]: statuses,
          })
        );
      }
      if (andConditions.length) {
        where[Sequelize.Op.and] = andConditions;
      }

      const usesApplicationPeriodQuery = Boolean(appliedFrom || appliedTo || statuses.length);
      const defaultLimit = uniqueScreenlyJobIds.length
        ? Math.min(500, Math.max(uniqueScreenlyJobIds.length, 1))
        : usesApplicationPeriodQuery
          ? 500
          : 100;
      const limit = Math.min(
        500,
        Math.max(1, parseInt(String(req.query.limit || String(defaultLimit)), 10) || defaultLimit)
      );
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

      const rows = await models.Applications.findAll({
        where,
        order: [['AppliedAt', 'DESC'], ['Id', 'DESC']],
        limit,
        offset,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/applications/by-user:', err);
      res.status(500).json({ error: 'Failed to load applications by user' });
    }
  });

  router.post('/api/app/applications', miniAppActorAuth, async (req, res) => {
    try {
      const userId = Number.parseInt(String(req.body.userId), 10);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId is required and must be a positive integer' });
      }
      if (!(await enforceAgentClientAccess(req, res, userId))) return;
      const user = await models.Users.findByPk(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const screenlyJobId = toIntOrNullOrUndefined(req.body.screenlyJobId);
      if (screenlyJobId === undefined || screenlyJobId === null) {
        return res.status(400).json({ error: 'screenlyJobId is required and must be a non-negative integer' });
      }
      const existing = await models.Applications.findOne({
        where: { UserId: user.Id, ScreenlyJobId: screenlyJobId },
      });
      if (existing) return res.status(200).json(existing);

      const vacancyTitle = String(req.body.vacancyTitle || '').trim();

      const row = await models.Applications.create({
        UserId: user.Id,
        VacancyTitle: (vacancyTitle || `Screenly #${screenlyJobId}`).slice(0, 255),
        ScreenlyJobId: screenlyJobId,
        Status: 'applied',
        AppliedAt: new Date(),
      });
      return res.status(201).json(row);
    } catch (err) {
      console.error('POST /api/app/applications:', err);
      res.status(500).json({ error: 'Failed to create application' });
    }
  });

  router.patch('/api/app/applications/:id', miniAppActorAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.Applications.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Application not found' });
      if (!(await enforceAgentClientAccess(req, res, row.UserId))) return;

      const updates = {};

      if (typeof req.body.vacancyTitle === 'string') {
        const v = req.body.vacancyTitle.trim();
        if (!v) return res.status(400).json({ error: 'vacancyTitle cannot be empty' });
        updates.VacancyTitle = v.slice(0, 255);
      }
      if (req.body.companyName !== undefined) {
        updates.CompanyName = req.body.companyName ? String(req.body.companyName).slice(0, 255) : null;
      }
      if (req.body.source !== undefined) {
        updates.Source = req.body.source ? String(req.body.source).slice(0, 50) : null;
      }
      if (req.body.status !== undefined) {
        updates.Status = req.body.status ? String(req.body.status).slice(0, 50) : null;
      }
      if (req.body.appliedAt !== undefined) {
        if (req.body.appliedAt == null || req.body.appliedAt === '') {
          updates.AppliedAt = new Date();
        } else {
          const d = new Date(req.body.appliedAt);
          if (!Number.isFinite(d.getTime())) return res.status(400).json({ error: 'Invalid appliedAt' });
          updates.AppliedAt = d;
        }
      }
      if (req.body.notes !== undefined) {
        updates.Notes = req.body.notes ? String(req.body.notes) : null;
      }
      if (req.body.metaJson !== undefined) {
        updates.MetaJson = req.body.metaJson ? JSON.stringify(req.body.metaJson) : null;
      }
      if (req.body.score !== undefined) {
        const score = toScoreOrNullOrUndefined(req.body.score);
        if (score === undefined) return res.status(400).json({ error: 'Invalid score' });
        updates.Score = score;
      }
      if (req.body.screenlyJobId !== undefined) {
        const screenlyJobId = toIntOrNullOrUndefined(req.body.screenlyJobId);
        if (screenlyJobId === undefined) return res.status(400).json({ error: 'Invalid screenlyJobId' });
        updates.ScreenlyJobId = screenlyJobId;
      }
      if (req.body.tailoredCvUrl !== undefined) {
        updates.TailoredCVURL = toStringOrUndefined(req.body.tailoredCvUrl, 2048) ?? null;
      }
      if (req.body.coverLetter !== undefined) {
        updates.CoverLetter = req.body.coverLetter == null ? null : String(req.body.coverLetter);
      }
      if (req.body.screenshotArtifactUrl !== undefined) {
        updates.ScreenshotArtifactURL =
          toStringOrUndefined(req.body.screenshotArtifactUrl, 2048) ?? null;
      }
      if (req.body.applyPriorityJson !== undefined) {
        if (req.body.applyPriorityJson == null || req.body.applyPriorityJson === '') {
          updates.ApplyPriorityJson = null;
        } else if (typeof req.body.applyPriorityJson === 'string') {
          // Accept pre-serialized payloads sent by legacy clients.
          updates.ApplyPriorityJson = req.body.applyPriorityJson;
        } else {
          updates.ApplyPriorityJson = JSON.stringify(req.body.applyPriorityJson);
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      await row.update(updates);
      res.json(row);
    } catch (err) {
      console.error('PATCH /api/app/applications/:id:', err);
      res.status(500).json({ error: 'Failed to update application' });
    }
  });

  router.post(
    '/api/app/applications/:id/screenshot-upload',
    miniAppActorAuth,
    express.raw({ type: 'application/octet-stream', limit: '10mb' }),
    async (req, res) => {
      try {
        const id = Number.parseInt(String(req.params.id), 10);
        if (!Number.isSafeInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Invalid id' });
        }

        const row = await models.Applications.findByPk(id);
        if (!row) return res.status(404).json({ error: 'Application not found' });
        if (!(await enforceAgentClientAccess(req, res, row.UserId))) return;

        const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : null;
        if (!bodyBuffer || bodyBuffer.length === 0) {
          return res.status(400).json({ error: 'Screenshot file bytes are required' });
        }

        const headerFileNameRaw = String(req.headers['x-file-name'] || '').trim();
        const headerMimeTypeRaw = String(req.headers['x-file-type'] || '').trim().toLowerCase();
        const fileName = headerFileNameRaw || `screenshot-${id}-${Date.now()}.png`;
        const mimeType = headerMimeTypeRaw || 'application/octet-stream';
        const isSupported =
          mimeType.includes('png') ||
          mimeType.includes('jpeg') ||
          mimeType.includes('jpg') ||
          mimeType.includes('webp');
        if (!isSupported) {
          return res.status(400).json({
            error: 'Unsupported screenshot type. Use PNG, JPEG, or WEBP.',
          });
        }

        const screenlyJobId = Number(row.ScreenlyJobId);
        const screenshotArtifactUrl = await resumeStorage.uploadApplicationScreenshotBuffer({
          userId: row.UserId,
          screenlyJobId: Number.isSafeInteger(screenlyJobId) ? screenlyJobId : 0,
          applicationId: id,
          fileName,
          mimeType,
          buffer: bodyBuffer,
        });

        await row.update({ ScreenshotArtifactURL: screenshotArtifactUrl });
        return res.json({ screenshotArtifactUrl });
      } catch (err) {
        console.error('POST /api/app/applications/:id/screenshot-upload:', err);
        return res.status(500).json({ error: 'Failed to upload application screenshot' });
      }
    }
  );

  return router;
}
