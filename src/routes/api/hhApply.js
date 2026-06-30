import { Router } from 'express';
import express from 'express';
import multer from 'multer';
import { hhApplyCronSecretAuth } from '../../middleware/hhApplyCronSecretAuth.js';
import {
  checkHhApplicationApplied,
  importHhApplication,
  listHhApplyClients,
  updateHhApplicationStatuses,
} from '../../services/hhApplyCronService.js';

const hhApplyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function fileFromMulterUpload(file) {
  if (!file) return null;
  return {
    buffer: file.buffer,
    mimeType: file.mimetype,
    fileName: file.originalname,
  };
}

function hhApplyApplicationBodyParser(req, res, next) {
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('multipart/form-data')) {
    return hhApplyUpload.fields([
      { name: 'artifact', maxCount: 1 },
      { name: 'tailoredCv', maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Uploaded file exceeds the 15 MB limit.' });
        }
        return res.status(400).json({ error: err?.message || 'Invalid multipart upload' });
      }
      return next();
    });
  }
  return express.json({ limit: '1mb' })(req, res, next);
}

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
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      const { ok: _ok, ...payload } = result;
      return res.json(payload);
    } catch (err) {
      console.error('GET /api/hh-apply/applications/check:', err);
      return res.status(500).json({ error: 'Failed to check HH application' });
    }
  });

  router.post(
    '/api/hh-apply/applications',
    hhApplyCronSecretAuth,
    hhApplyApplicationBodyParser,
    async (req, res) => {
      try {
        const artifact = fileFromMulterUpload(req.files?.artifact?.[0]);
        const tailoredCv = fileFromMulterUpload(req.files?.tailoredCv?.[0]);
        const result = await importHhApplication(req.body || {}, { artifact, tailoredCv });
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

  // Bulk-update HH negotiation statuses harvested from /applicant/negotiations.
  router.post('/api/hh-apply/applications/hh-status', hhApplyCronSecretAuth, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await updateHhApplicationStatuses(req.body || {});
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      return res.json(result);
    } catch (err) {
      console.error('POST /api/hh-apply/applications/hh-status:', err);
      return res.status(500).json({ error: 'Failed to update HH statuses' });
    }
  });

  return router;
}
