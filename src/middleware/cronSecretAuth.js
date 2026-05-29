import { config } from '../config.js';

/** Requires header `X-Cron-Secret` or query `secret` matching SCREENING_CRON_SECRET. */
export function screeningCronSecretAuth(req, res, next) {
  const expected = config.screeningCronSecret;
  if (!expected) {
    return res.status(503).json({
      error: 'SCREENING_CRON_SECRET is not configured on the server',
    });
  }
  const provided = String(req.headers['x-cron-secret'] || req.query.secret || '').trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
