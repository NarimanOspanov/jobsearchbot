import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { decodeApplyAttribution } from './applyLinkAttribution.js';

export function isValidTelegramWebAppUrl(urlValue) {
  if (!urlValue) return false;
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== 'https:') return false;
    const host = (parsed.hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    return true;
  } catch {
    return false;
  }
}

export function verifyInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = createHmac('sha256', 'WebAppData').update(config.telegramBotToken).digest();
    const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (expected !== hash) return null;

    const userStr = params.get('user');
    return userStr ? JSON.parse(userStr) : {};
  } catch {
    return null;
  }
}

export function extractMiniAppInitData(req) {
  const fromHeader = req.headers['x-init-data'];
  if (fromHeader) return String(fromHeader);
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth && /^tma\s+/i.test(String(auth))) {
    return String(auth).replace(/^tma\s+/i, '').trim();
  }
  return '';
}

export function pickResumeSourceFromMessage(message) {
  if (!message) return null;
  if (message.document?.file_id) {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name || null,
      mimeType: message.document.mime_type || 'application/octet-stream',
    };
  }
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    if (!largest?.file_id) return null;
    return {
      fileId: largest.file_id,
      fileName: `resume-${largest.file_unique_id || largest.file_id}.jpg`,
      mimeType: 'image/jpeg',
    };
  }
  return null;
}

export async function downloadTelegramFileAsBuffer(telegram, fileId) {
  const fileUrl = await telegram.getFileLink(fileId);
  const response = await fetch(fileUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

/**
 * @param {string} startPayload
 * @returns {string | null} source token for HumanAssistantRequests.Source
 */
export function parseHireHumanStartPayload(startPayload) {
  const payload = String(startPayload || '').trim();
  if (!payload) return null;
  if (payload === 'hire_human') return 'hire_human';
  if (payload.startsWith('hire_human_')) return payload.slice(0, 64);
  return null;
}

export function parseStartPayload(ctx) {
  const rawText = String(ctx.message?.text || '').trim();
  const commandMatch = rawText.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  if (!commandMatch) return '';
  return String(commandMatch[1] || '').trim();
}

export function parseStartReferralChatId(startPayload) {
  const payload = String(startPayload || '').trim();
  if (!/^\d+$/.test(payload)) return null;
  const chatId = Number.parseInt(payload, 10);
  return Number.isSafeInteger(chatId) && chatId > 0 ? chatId : null;
}

function normalizeCampaignSlug(raw) {
  const campaignSlug = String(raw || '').trim().toLowerCase();
  if (!campaignSlug || !/[a-z]/i.test(campaignSlug)) return null;
  return campaignSlug;
}

/**
 * Parse ad/campaign start payload: ref_<slug> (e.g. ref_instagram, ref_tg_aidynoJ).
 * Also supports combined payloads such as hire_human_ref_instagram.
 * Does not match pure numeric payloads (user referral) or ref_<digits-only>.
 * @param {string} startPayload
 * @returns {{ campaignSlug: string } | null}
 */
export function parseStartCampaignRef(startPayload) {
  const payload = String(startPayload || '').trim();
  const directMatch = payload.match(/^ref_([A-Za-z0-9_-]{1,50})$/i);
  if (directMatch) {
    const campaignSlug = normalizeCampaignSlug(directMatch[1]);
    return campaignSlug ? { campaignSlug } : null;
  }
  const suffixMatch = payload.match(/(?:^|_)ref_([A-Za-z0-9_-]{1,50})$/i);
  if (suffixMatch) {
    const campaignSlug = normalizeCampaignSlug(suffixMatch[1]);
    return campaignSlug ? { campaignSlug } : null;
  }
  return null;
}

const APPLY_POSITION_UUID_RE =
  '([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})';

/**
 * @param {string} startPayload
 * @returns {{ positionId: string, publisherUserId?: number, publishedInChatId?: number } | null}
 */
export function parseStartApplyPayload(startPayload) {
  const payload = String(startPayload || '').trim();
  // URL-safe tracked link uses "_" before token; "." was used earlier (manual /start only).
  const trackedSeparators = ['_', '.'];
  for (const sep of trackedSeparators) {
    const escaped = sep === '.' ? '\\.' : sep;
    const trackedMatch = payload.match(
      new RegExp(`^apply_${APPLY_POSITION_UUID_RE}${escaped}([A-Za-z0-9_-]{16})$`, 'i')
    );
    if (!trackedMatch) continue;
    const positionId = String(trackedMatch[1]).toLowerCase();
    const attribution = decodeApplyAttribution(trackedMatch[2]);
    if (!attribution) {
      return { positionId };
    }
    return {
      positionId,
      publisherUserId: attribution.publisherUserId,
      publishedInChatId: attribution.publishedInChatId,
    };
  }
  const legacyMatch = payload.match(new RegExp(`^apply_${APPLY_POSITION_UUID_RE}$`, 'i'));
  if (!legacyMatch) return null;
  return { positionId: String(legacyMatch[1]).toLowerCase() };
}

export function parseStartPositionId(startPayload) {
  return parseStartApplyPayload(startPayload)?.positionId ?? null;
}

/**
 * Extract start payload from a t.me apply URL or raw start= value.
 * @param {string} input
 * @returns {string}
 */
export function extractApplyStartPayloadFromUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^apply_/i.test(raw)) return raw;
  try {
    const normalized = raw.startsWith('http') ? raw : `https://${raw}`;
    const url = new URL(normalized);
    const start = url.searchParams.get('start');
    return start ? String(start).trim() : '';
  } catch {
    return '';
  }
}
