import { Router } from 'express';
import { Sequelize } from 'sequelize';
import { miniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { ensureUserByTelegramId } from '../../services/userService.js';
import {
  toIntOrNullOrUndefined,
  toScoreOrNullOrUndefined,
  toStringOrUndefined,
} from '../../utils/validators.js';

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

  router.get('/api/app/applications/by-user', async (req, res) => {
    try {
      const userId = Number.parseInt(String(req.query.userId), 10);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId is required and must be a positive integer' });
      }
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.Applications.findAll({
        where: { UserId: userId },
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

  router.post('/api/app/applications', async (req, res) => {
    try {
      const userId = Number.parseInt(String(req.body.userId), 10);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId is required and must be a positive integer' });
      }
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

  router.patch('/api/app/applications/:id', async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.Applications.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Application not found' });

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

  return router;
}
