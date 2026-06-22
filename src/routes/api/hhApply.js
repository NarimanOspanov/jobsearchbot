import { Router } from 'express';
import express from 'express';
import { hhApplyCronSecretAuth } from '../../middleware/hhApplyCronSecretAuth.js';
import {
  checkHhApplicationApplied,
  importHhApplication,
  listHhApplyClients,
} from '../../services/hhApplyCronService.js';

export function createHhApplyRouter() {
  const router = Router();

  router.get('/api/hh-apply/clients', hhApplyCronSecretAuth, async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit || '200'), 10) || 200));
      const payload = await listHhApplyClients({ limit });
      return res.json(payload);
    } catch (err) {
      console.error('GET /api/hh-apply/clients:', err);
      return res.status(500).json({ error: 'Failed to load HH apply clients' });
    }
  });

  router.get('/api/hh-apply/applications/check', hhApplyCronSecretAuth, async (req, res) => {
    try {
      const result = await checkHhApplicationApplied({
        userId: req.query.userId,
        hhVacancyId: req.query.hhVacancyId,
        hhId: req.query.hhId,
      });
      if (!result.ok && result.status) {
        return res.status(result.status).json({ error: result.error });
      }
      const { ok: _ok, status: _status, error: _error, ...payload } = result;
      return res.json(payload);
    } catch (err) {
      console.error('GET /api/hh-apply/applications/check:', err);
      return res.status(500).json({ error: 'Failed to check HH application' });
    }
  });

  router.post(
    '/api/hh-apply/applications',
    express.json({ limit: '1mb' }),
    hhApplyCronSecretAuth,
    async (req, res) => {
      try {
        const result = await importHhApplication(req.body || {});
        if (!result.ok && result.status) {
          return res.status(result.status).json({ error: result.error });
        }
        return res.status(result.created ? 201 : 200).json(result);
      } catch (err) {
        console.error('POST /api/hh-apply/applications:', err);
        return res.status(500).json({ error: 'Failed to import HH application' });
      }
    }
  );

  return router;
}
