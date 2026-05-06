import { Router } from 'express';
import { Sequelize } from 'sequelize';
import { miniAppAuth, adminMiniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { toStringOrUndefined, toValidUrlOrUndefined } from '../../utils/validators.js';

export function createCompaniesRouter() {
  const router = Router();

  router.get('/api/app/companies', miniAppAuth, async (_req, res) => {
    try {
      const rows = await models.RemoteCompanies.findAll({
        order: [['DateAdded', 'DESC'], ['Id', 'DESC']],
        limit: 500,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/companies:', err);
      res.status(500).json({ error: 'Failed to load companies' });
    }
  });

  router.get('/api/app/admin/companies', adminMiniAppAuth, async (_req, res) => {
    try {
      const rows = await models.RemoteCompanies.findAll({
        order: [['DateAdded', 'DESC'], ['Id', 'DESC']],
        limit: 1000,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/admin/companies:', err);
      res.status(500).json({ error: 'Failed to load companies' });
    }
  });

  router.post('/api/app/admin/companies', adminMiniAppAuth, async (req, res) => {
    try {
      const name = toStringOrUndefined(req.body.name, 255);
      const url = toValidUrlOrUndefined(req.body.url);
      if (!name || !url) return res.status(400).json({ error: 'name and valid url are required' });
      const notes = toStringOrUndefined(req.body.notes, 1000);
      const row = await models.RemoteCompanies.create({
        Name: name,
        Url: url,
        Notes: notes ?? null,
        DateAdded: Sequelize.literal('GETUTCDATE()'),
      });
      res.status(201).json(row);
    } catch (err) {
      console.error('POST /api/app/admin/companies:', err);
      res.status(500).json({ error: 'Failed to create company' });
    }
  });

  router.patch('/api/app/admin/companies/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.RemoteCompanies.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Company not found' });

      const updates = {};
      const name = toStringOrUndefined(req.body.name, 255);
      const url = toValidUrlOrUndefined(req.body.url);
      if (name) updates.Name = name;
      if (url) updates.Url = url;
      if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) {
        if (req.body.notes == null || String(req.body.notes).trim() === '') {
          updates.Notes = null;
        } else {
          const notes = toStringOrUndefined(req.body.notes, 1000);
          if (!notes) {
            return res.status(400).json({ error: 'notes must be a non-empty string up to 1000 characters' });
          }
          updates.Notes = notes;
        }
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'At least one valid field is required' });
      }
      await row.update(updates);
      res.json(row);
    } catch (err) {
      console.error('PATCH /api/app/admin/companies/:id:', err);
      res.status(500).json({ error: 'Failed to update company' });
    }
  });

  router.delete('/api/app/admin/companies/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const deleted = await models.RemoteCompanies.destroy({ where: { Id: id } });
      if (!deleted) return res.status(404).json({ error: 'Company not found' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/app/admin/companies/:id:', err);
      res.status(500).json({ error: 'Failed to delete company' });
    }
  });

  return router;
}
