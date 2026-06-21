import { config } from '../config.js';

/** Requires header `X-Cron-Secret` or query `secret` matching HH_APPLY_CRON_SECRET (or SCREENING_CRON_SECRET). Used by /api/hh-apply/* */
export function hhApplyCronSecretAuth(req, res, next) {
  const expected = config.hhApplyCronSecret;
  if (!expected) {
    return res.status(503).json({
      error: 'HH_APPLY_CRON_SECRET is not configured on the server',
    });
  }
  const provided = String(req.headers['x-cron-secret'] || req.query.secret || '').trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
