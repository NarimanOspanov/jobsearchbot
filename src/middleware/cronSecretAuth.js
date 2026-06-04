import { config } from '../config.js';

const SCREENING_BOARD_COOKIE = 'screening_cron_auth=1';
const APPLY_PRIORITY_BOARD_COOKIE = 'apply_priority_cron_auth=1';

function hasCronBoardAuthCookie(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .some((part) => {
      const trimmed = part.trim();
      return trimmed === SCREENING_BOARD_COOKIE || trimmed === APPLY_PRIORITY_BOARD_COOKIE;
    });
}

/** Requires header `X-Cron-Secret` or query `secret` matching SCREENING_CRON_SECRET (or APPLY_PRIORITY_CRON_SECRET). */
export function screeningCronSecretAuth(req, res, next) {
  const expected = config.screeningCronSecret || config.applyPriorityCronSecret;
  if (!expected) {
    return res.status(503).json({
      error: 'SCREENING_CRON_SECRET is not configured on the server',
    });
  }
  const provided = String(req.headers['x-cron-secret'] || req.query.secret || '').trim();
  const cookieHeader = String(req.headers.cookie || '');
  const hasAuthCookie = hasCronBoardAuthCookie(cookieHeader);
  if ((!provided || provided !== expected) && !hasAuthCookie) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (provided && provided === expected && !cookieHeader.includes('screening_cron_auth=1')) {
    res.setHeader(
      'Set-Cookie',
      'screening_cron_auth=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800'
    );
  }
  return next();
}
