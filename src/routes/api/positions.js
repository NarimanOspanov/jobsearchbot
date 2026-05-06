import { Router } from 'express';
import { Sequelize } from 'sequelize';
import { adminMiniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { fetchScreenlySkillsCatalog } from '../../services/aiService.js';
import { runtimeBot } from '../../bot/state.js';
import {
  toBoolOrUndefined,
  toStringOrUndefined,
  toValidUrlOrUndefined,
  toUuidOrUndefined,
} from '../../utils/validators.js';

export function createPositionsRouter() {
  const router = Router();

  router.get('/api/admin/skills', async (_req, res) => {
    try {
      const skills = await fetchScreenlySkillsCatalog();
      return res.json({ success: true, count: skills.length, skills });
    } catch (err) {
      console.error('GET /api/admin/skills:', err);
      return res.status(500).json({ error: 'Failed to load skills' });
    }
  });

  router.get('/api/admin/positions', async (req, res) => {
    try {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const skillIds = String(req.query.skillIds || req.query.skillId || '').trim();
      const showOnlyHighlyRelevantRaw = String(req.query.showOnlyHighlyRelevant || '').trim().toLowerCase();
      const showOnlyHighlyRelevant =
        showOnlyHighlyRelevantRaw === 'true' ||
        showOnlyHighlyRelevantRaw === '1' ||
        showOnlyHighlyRelevantRaw === 'yes';
      const mapApplyTypeToken = (rawToken) => {
        const value = String(rawToken || '').trim().toLowerCase();
        if (!value) return '';
        if (value === 'linkedin') return 'linkedin';
        if (value === 'indeed') return 'indeed';
        if (value === 'telegram' || value === 'telegram channels') return 'telegram';
        if (value === 'external' || value === 'company sites') return 'external';
        return '';
      };
      const parseApplyTypes = (...inputs) => {
        const unique = new Set();
        for (const input of inputs) {
          const rawValues = Array.isArray(input) ? input : [input];
          const chunks = rawValues
            .flatMap((value) => String(value || '').split(','))
            .map((item) => mapApplyTypeToken(item))
            .filter(Boolean);
          for (const chunk of chunks) unique.add(chunk);
        }
        return [...unique];
      };
      const normalizeSourceToken = (rawToken) => {
        const value = String(rawToken || '').trim().toLowerCase();
        if (!value) return '';
        if (value === 'linkedin') return 'Linkedin';
        if (value === 'indeed') return 'Indeed';
        if (value === 'hirehi') return 'hirehi';
        return '';
      };
      const parseSource = (input) => {
        const rawValues = Array.isArray(input) ? input : [input];
        for (const rawValue of rawValues) {
          const tokens = String(rawValue || '')
            .split(',')
            .map((item) => normalizeSourceToken(item))
            .filter(Boolean);
          if (tokens.length) return tokens[0];
        }
        return '';
      };
      const applyTypes = parseApplyTypes(req.query.applyType, req.query.applyTypes, req.query.sourceIds);
      const source = parseSource(req.query.source);
      const pageRaw = Number.parseInt(String(req.query.page || '1'), 10);
      const pageSizeRaw = Number.parseInt(String(req.query.pageSize || '100'), 10);
      const page = Number.isSafeInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
      const pageSize = Number.isSafeInteger(pageSizeRaw) && pageSizeRaw > 0
        ? Math.min(200, pageSizeRaw)
        : 100;
      if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
      const upstreamParams = new URLSearchParams();
      upstreamParams.set('from', from);
      upstreamParams.set('to', to);
      if (skillIds) upstreamParams.set('skillIds', skillIds);
      if (showOnlyHighlyRelevant) upstreamParams.set('showOnlyHighlyRelevant', 'true');
      if (source) upstreamParams.set('source', source);
      for (const applyType of applyTypes) {
        upstreamParams.append('applyType', applyType);
      }
      upstreamParams.set('page', String(page));
      upstreamParams.set('pageSize', String(pageSize));
      const url = `https://anyhires.com/api/global-remote-positions?${upstreamParams.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        const txt = await response.text();
        return res.status(response.status).json({ error: txt || 'Failed to load positions from upstream' });
      }
      const payload = await response.json();
      if (
        Object.prototype.hasOwnProperty.call(payload || {}, 'page') ||
        Object.prototype.hasOwnProperty.call(payload || {}, 'hasMore')
      ) {
        const upstreamPositions = Array.isArray(payload?.positions) ? payload.positions : [];
        return res.json({
          ...payload,
          page: Number(payload.page || page),
          pageSize: Number(payload.pageSize || pageSize),
          hasMore: Boolean(payload.hasMore),
          count: Number(payload.count || upstreamPositions.length),
          positions: upstreamPositions,
        });
      }
      const all = Array.isArray(payload?.positions) ? payload.positions : [];
      const offset = (page - 1) * pageSize;
      const pageItems = all.slice(offset, offset + pageSize);
      const hasMore = offset + pageItems.length < all.length;
      return res.json({
        ...payload,
        page,
        pageSize,
        hasMore,
        count: pageItems.length,
        positions: pageItems,
      });
    } catch (err) {
      console.error('GET /api/admin/positions:', err);
      return res.status(500).json({ error: 'Failed to load positions' });
    }
  });

  router.get('/api/app/admin/positions', adminMiniAppAuth, async (_req, res) => {
    try {
      const rows = await models.Positions.findAll({
        order: [['DateCreated', 'DESC']],
        limit: 1000,
      });
      const botUsername = String(runtimeBot.username || '').trim();
      const withLinks = rows.map((row) => {
        const applyLink = botUsername ? `https://t.me/${botUsername}?start=apply_${row.Id}` : '';
        return { ...row.toJSON(), applyLink };
      });
      res.json(withLinks);
    } catch (err) {
      console.error('GET /api/app/admin/positions:', err);
      res.status(500).json({ error: 'Failed to load positions' });
    }
  });

  router.post('/api/app/admin/positions', adminMiniAppAuth, async (req, res) => {
    try {
      const title = toStringOrUndefined(req.body.title, 255);
      const description = req.body.description == null ? '' : String(req.body.description).trim();
      const companyName = toStringOrUndefined(req.body.companyName, 255);
      const companyWebsite = req.body.companyWebsite == null ? null : toValidUrlOrUndefined(req.body.companyWebsite);
      const externalApplyUrl = req.body.externalApplyUrl == null ? null : toValidUrlOrUndefined(req.body.externalApplyUrl);
      const isArchived = toBoolOrUndefined(req.body.isArchived);
      if (!title || !description || !companyName) {
        return res.status(400).json({ error: 'title, description, companyName are required' });
      }
      if (req.body.companyWebsite != null && !companyWebsite) {
        return res.status(400).json({ error: 'companyWebsite must be a valid URL' });
      }
      if (req.body.externalApplyUrl != null && !externalApplyUrl) {
        return res.status(400).json({ error: 'externalApplyUrl must be a valid URL' });
      }
      const row = await models.Positions.create({
        Title: title,
        Description: description,
        CompanyName: companyName,
        CompanyWebsite: companyWebsite,
        ExternalApplyURL: externalApplyUrl,
        DateCreated: Sequelize.literal('GETUTCDATE()'),
        IsArchived: isArchived ?? false,
      });
      res.status(201).json(row);
    } catch (err) {
      console.error('POST /api/app/admin/positions:', err);
      res.status(500).json({ error: 'Failed to create position' });
    }
  });

  router.patch('/api/app/admin/positions/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = toUuidOrUndefined(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.Positions.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Position not found' });

      const updates = {};
      if (Object.prototype.hasOwnProperty.call(req.body, 'title')) {
        const title = toStringOrUndefined(req.body.title, 255);
        if (!title) return res.status(400).json({ error: 'title must be a non-empty string' });
        updates.Title = title;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
        const description = req.body.description == null ? '' : String(req.body.description).trim();
        if (!description) return res.status(400).json({ error: 'description must be a non-empty string' });
        updates.Description = description;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'companyName')) {
        const companyName = toStringOrUndefined(req.body.companyName, 255);
        if (!companyName) return res.status(400).json({ error: 'companyName must be a non-empty string' });
        updates.CompanyName = companyName;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'companyWebsite')) {
        if (req.body.companyWebsite == null || String(req.body.companyWebsite).trim() === '') {
          updates.CompanyWebsite = null;
        } else {
          const companyWebsite = toValidUrlOrUndefined(req.body.companyWebsite);
          if (!companyWebsite) return res.status(400).json({ error: 'companyWebsite must be a valid URL' });
          updates.CompanyWebsite = companyWebsite;
        }
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'externalApplyUrl')) {
        if (req.body.externalApplyUrl == null || String(req.body.externalApplyUrl).trim() === '') {
          updates.ExternalApplyURL = null;
        } else {
          const externalApplyUrl = toValidUrlOrUndefined(req.body.externalApplyUrl);
          if (!externalApplyUrl) return res.status(400).json({ error: 'externalApplyUrl must be a valid URL' });
          updates.ExternalApplyURL = externalApplyUrl;
        }
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'isArchived')) {
        const isArchived = toBoolOrUndefined(req.body.isArchived);
        if (isArchived === undefined) return res.status(400).json({ error: 'isArchived must be boolean' });
        updates.IsArchived = isArchived;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      await row.update(updates);
      return res.json(row);
    } catch (err) {
      console.error('PATCH /api/app/admin/positions/:id:', err);
      return res.status(500).json({ error: 'Failed to update position' });
    }
  });

  router.delete('/api/app/admin/positions/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = toUuidOrUndefined(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid id' });
      const deleted = await models.Positions.destroy({ where: { Id: id } });
      if (!deleted) return res.status(404).json({ error: 'Position not found' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/app/admin/positions/:id:', err);
      return res.status(500).json({ error: 'Failed to delete position' });
    }
  });

  return router;
}
