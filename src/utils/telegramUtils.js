import { createHmac } from 'node:crypto';
import { config } from '../config.js';

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

export function parseStartPositionId(startPayload) {
  const payload = String(startPayload || '').trim();
  const match = payload.match(/^apply_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (!match) return null;
  return String(match[1]).toLowerCase();
}
