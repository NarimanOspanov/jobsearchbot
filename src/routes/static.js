import { Router } from 'express';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicApp = join(__dirname, '..', '..', 'public', 'app');

function isSeekerJobsDeeplinkRequest(req) {
  const rawStart = String(req.query.startapp || req.query.startApp || '').trim();
  return rawStart.startsWith('seekerjobs__');
}

export function createStaticRouter() {
  const router = Router();

  router.get('/app', (req, res, next) => {
    if (!isSeekerJobsDeeplinkRequest(req)) return next();
    return res.sendFile(join(publicApp, 'seeker-jobs-deeplink.html'));
  });
  router.get('/app/', (req, res, next) => {
    if (!isSeekerJobsDeeplinkRequest(req)) return next();
    return res.sendFile(join(publicApp, 'seeker-jobs-deeplink.html'));
  });
  router.use('/app', express.static(publicApp));
  router.get('/app/applications', (_req, res) => res.sendFile(join(publicApp, 'applications.html')));
  router.get('/app/profile', (_req, res) => res.sendFile(join(publicApp, 'profile.html')));
  router.get('/app/companies', (_req, res) => res.sendFile(join(publicApp, 'companies.html')));
  router.get('/app/seeker-jobs', (_req, res) => res.sendFile(join(publicApp, 'seeker-jobs.html')));
  router.get('/app/seeker-jobs-deeplink', (_req, res) => res.sendFile(join(publicApp, 'seeker-jobs-deeplink.html')));
  router.get('/app/pricing', (_req, res) => res.sendFile(join(publicApp, 'pricing.html')));
  router.get('/app/admin/companies', (_req, res) => res.sendFile(join(publicApp, 'admin-companies.html')));
  router.get('/app/admin/positions', (_req, res) => res.sendFile(join(publicApp, 'admin-positions.html')));
  router.get('/app/admin/notifications', (_req, res) => res.sendFile(join(publicApp, 'admin-notifications.html')));
  router.get('/app/admin', (_req, res) => res.sendFile(join(publicApp, 'admin.html')));
  router.get('/app/stat', (_req, res) => res.sendFile(join(publicApp, 'stats.html')));
  router.get('/app/stat2', (_req, res) => res.sendFile(join(publicApp, 'stat2.html')));
  router.get('/app/cvscore', (_req, res) => res.sendFile(join(publicApp, 'cvscore.html')));

  return router;
}
