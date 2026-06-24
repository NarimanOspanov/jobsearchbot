import { Router } from 'express';
import { Sequelize } from 'sequelize';
import { miniAppAuth, adminMiniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import {
  listIndustries,
  listRemoteCompanies,
  mapCompanyRow,
  setCompanyIndustries,
} from '../../services/companiesService.js';
import { toStringOrUndefined, toNormalizedCareerUrlOrUndefined } from '../../utils/validators.js';
import { resolveBotLanguage } from '../../utils/userLanguage.js';

function parseIndustryIds(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'industryIds')) return undefined;
  if (body.industryIds == null) return [];
  if (!Array.isArray(body.industryIds)) return null;
  return body.industryIds;
}

const companyInclude = {
  model: models.Industries,
  as: 'Industries',
  through: { attributes: [] },
};

function resolveRequestLang(req) {
  const fromQuery = String(req.query.lang || '').trim().toLowerCase();
  if (fromQuery === 'ru' || fromQuery === 'en') return fromQuery;
  return resolveBotLanguage(req.miniAppUser?.language_code);
}

function parseIndustryIdsFromQuery(req) {
  const parts = [];
  if (req.query.industryIds != null && req.query.industryIds !== '') {
    parts.push(String(req.query.industryIds));
  }
  const repeated = req.query.industryId;
  if (Array.isArray(repeated)) parts.push(...repeated.map(String));
  else if (repeated != null && repeated !== '') parts.push(String(repeated));

  const ids = new Set();
  for (const chunk of parts) {
    for (const token of String(chunk).split(',')) {
      const id = Number.parseInt(String(token).trim(), 10);
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
}

export function createCompaniesRouter() {
  const router = Router();

  router.get('/api/app/companies/industries', miniAppAuth, async (req, res) => {
    try {
      res.json(await listIndustries({ lang: resolveRequestLang(req) }));
    } catch (err) {
      console.error('GET /api/app/companies/industries:', err);
      res.status(500).json({ error: 'Failed to load industries' });
    }
  });

  router.get('/api/app/companies', miniAppAuth, async (req, res) => {
    try {
      const industryIds = parseIndustryIdsFromQuery(req);
      const industrySlug = String(req.query.industrySlug || '').trim();
      const rows = await listRemoteCompanies({
        industryIds,
        industrySlug: industryIds.length ? null : industrySlug || null,
        lang: resolveRequestLang(req),
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/companies:', err);
      res.status(500).json({ error: 'Failed to load companies' });
    }
  });

  router.get('/api/app/admin/companies/industries', adminMiniAppAuth, async (_req, res) => {
    try {
      res.json(await listIndustries());
    } catch (err) {
      console.error('GET /api/app/admin/companies/industries:', err);
      res.status(500).json({ error: 'Failed to load industries' });
    }
  });

  router.get('/api/app/admin/companies', adminMiniAppAuth, async (_req, res) => {
    try {
      res.json(await listRemoteCompanies());
    } catch (err) {
      console.error('GET /api/app/admin/companies:', err);
      res.status(500).json({ error: 'Failed to load companies' });
    }
  });

  router.post('/api/app/admin/companies', adminMiniAppAuth, async (req, res) => {
    try {
      const name = toStringOrUndefined(req.body.name, 255);
      const url = toNormalizedCareerUrlOrUndefined(req.body.url);
      if (!name || !url) return res.status(400).json({ error: 'name and valid url are required' });
      const notes = toStringOrUndefined(req.body.notes, 1000);
      const industryIds = parseIndustryIds(req.body);
      if (industryIds === null) return res.status(400).json({ error: 'industryIds must be an array' });

      const row = await models.RemoteCompanies.create({
        Name: name,
        Url: url,
        Notes: notes ?? null,
        DateAdded: Sequelize.literal('GETUTCDATE()'),
      });
      if (industryIds !== undefined) {
        const mapped = await setCompanyIndustries(row.Id, industryIds);
        return res.status(201).json(mapped);
      }
      res.status(201).json(mapCompanyRow(row));
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
      const url = toNormalizedCareerUrlOrUndefined(req.body.url);
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
      const industryIds = parseIndustryIds(req.body);
      if (industryIds === null) return res.status(400).json({ error: 'industryIds must be an array' });

      if (Object.keys(updates).length) {
        await row.update(updates);
      }
      if (industryIds !== undefined) {
        const mapped = await setCompanyIndustries(id, industryIds);
        return res.json(mapped);
      }
      await row.reload({ include: [companyInclude] });
      res.json(mapCompanyRow(row));
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
