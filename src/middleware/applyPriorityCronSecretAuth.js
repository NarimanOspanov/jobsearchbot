import { config } from '../config.js';

/** Requires header `X-Cron-Secret` or query `secret` matching APPLY_PRIORITY_CRON_SECRET. */
export function applyPriorityCronSecretAuth(req, res, next) {
  const expected = config.applyPriorityCronSecret;
  if (!expected) {
    return res.status(503).json({
      error: 'APPLY_PRIORITY_CRON_SECRET is not configured on the server',
    });
  }
  const provided = String(req.headers['x-cron-secret'] || req.query.secret || '').trim();
  const cookieHeader = String(req.headers.cookie || '');
  const hasAuthCookie = cookieHeader.split(';').some((part) => part.trim() === 'apply_priority_cron_auth=1');
  if ((!provided || provided !== expected) && !hasAuthCookie) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (provided && provided === expected && !hasAuthCookie) {
    res.setHeader('Set-Cookie', 'apply_priority_cron_auth=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800');
  }
  return next();
}
