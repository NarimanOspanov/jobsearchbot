import { Router } from 'express';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filtersToUrlSearchParams, parseStartParam } from '../utils/parseStartParam.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicApp = join(__dirname, '..', '..', 'public', 'app');

function getStartappPayload(req) {
  return String(req.query.startapp || req.query.startApp || req.query.start || '').trim();
}

function handleMiniAppEntry(req, res, next) {
  const rawStart = getStartappPayload(req);
  if (!rawStart) return next();

  if (rawStart.startsWith('agentclients__')) {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `/app/index.html${qs}`);
  }

  const parsed = parseStartParam(rawStart);
  if (parsed?.kind === 'search') {
    const qs = filtersToUrlSearchParams(parsed.filters).toString();
    const target = qs ? `/app/seeker-jobs-deeplink?${qs}` : '/app/seeker-jobs-deeplink';
    return res.redirect(302, target);
  }

  if (rawStart.startsWith('seekerjobs__') || rawStart.startsWith('sj2__')) {
    return res.sendFile(join(publicApp, 'seeker-jobs-deeplink.html'));
  }

  return next();
}

export function createStaticRouter() {
  const router = Router();

  router.get('/app', handleMiniAppEntry);
  router.get('/app/', handleMiniAppEntry);
  router.use('/app', express.static(publicApp));
  router.get('/app/applications', (_req, res) => res.sendFile(join(publicApp, 'applications.html')));
  router.get('/app/profile', (_req, res) => res.sendFile(join(publicApp, 'profile.html')));
  router.get('/app/companies', (_req, res) => res.sendFile(join(publicApp, 'companies.html')));
  router.get('/app/seeker-jobs', (_req, res) => res.sendFile(join(publicApp, 'seeker-jobs.html')));
  router.get('/app/seeker-jobs-deeplink', (_req, res) => res.sendFile(join(publicApp, 'seeker-jobs-deeplink.html')));
  router.get('/app/pricing', (_req, res) => res.sendFile(join(publicApp, 'pricing.html')));
  router.get('/app/admin/companies', (_req, res) => res.sendFile(join(publicApp, 'admin-companies.html')));
  router.get('/app/admin/positions', (_req, res) => res.sendFile(join(publicApp, 'admin-positions.html')));
  router.get('/app/apply-link-builder', (_req, res) => res.sendFile(join(publicApp, 'apply-link-builder.html')));
  router.get('/app/admin/notifications', (_req, res) => res.sendFile(join(publicApp, 'admin-notifications.html')));
  router.get('/app/admin/agent-assignments', (_req, res) =>
    res.sendFile(join(publicApp, 'admin-agent-assignments.html'))
  );
  router.get('/app/agent/clients', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(join(publicApp, 'agent-clients.html'));
  });
  router.get('/app/admin', (_req, res) => res.redirect(302, '/app/agent/clients'));
  router.get('/app/stat', (_req, res) => res.sendFile(join(publicApp, 'stats.html')));
  router.get('/app/stat2', (_req, res) => res.sendFile(join(publicApp, 'stat2.html')));
  router.get('/app/publisher-stats', (_req, res) => res.sendFile(join(publicApp, 'publisher-stats.html')));
  router.get('/app/conversion-stats', (_req, res) => res.sendFile(join(publicApp, 'conversion-stats.html')));
  router.get('/app/agent-performance', (_req, res) => res.sendFile(join(publicApp, 'agent-performance.html')));
  router.get('/app/cvscore', (_req, res) => res.sendFile(join(publicApp, 'cvscore.html')));

  return router;
}
