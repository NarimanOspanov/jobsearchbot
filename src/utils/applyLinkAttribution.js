const POSITION_UUID_RE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ATTRIBUTION_TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;

export function encodeApplyAttribution(publisherUserId, publishedInChatId) {
  const publisherId = Number(publisherUserId);
  const chatId = Number(publishedInChatId);
  if (!Number.isSafeInteger(publisherId) || publisherId <= 0) {
    throw new Error('Invalid publisherUserId');
  }
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new Error('Invalid publishedInChatId');
  }
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(publisherId, 0);
  buf.writeBigInt64BE(BigInt(chatId), 4);
  return buf.toString('base64url');
}

export function decodeApplyAttribution(token) {
  const raw = String(token || '').trim();
  if (!ATTRIBUTION_TOKEN_RE.test(raw)) return null;
  try {
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length !== 12) return null;
    const publisherUserId = buf.readUInt32BE(0);
    const publishedInChatId = Number(buf.readBigInt64BE(4));
    if (!Number.isSafeInteger(publisherUserId) || publisherUserId <= 0) return null;
    if (!Number.isSafeInteger(publishedInChatId) || publishedInChatId === 0) return null;
    return { publisherUserId, publishedInChatId };
  } catch {
    return null;
  }
}

/**
 * @param {string} positionId
 * @param {number} publisherUserId
 * @param {number} publishedInChatId
 * @returns {string} Telegram start payload (max 64 chars)
 */
export function buildTrackedApplyStartPayload(positionId, publisherUserId, publishedInChatId) {
  const id = String(positionId || '').trim().toLowerCase();
  if (!new RegExp(`^${POSITION_UUID_RE}$`, 'i').test(id)) {
    throw new Error('Invalid positionId');
  }
  const token = encodeApplyAttribution(publisherUserId, publishedInChatId);
  const payload = `apply_${id}.${token}`;
  if (payload.length > 64) {
    throw new Error('Tracked apply payload exceeds Telegram 64 character limit');
  }
  return payload;
}

export function buildTelegramApplyLink(botUsername, startPayload) {
  const username = String(botUsername || '').trim().replace(/^@/, '');
  const payload = String(startPayload || '').trim();
  if (!username || !payload) return '';
  return `https://t.me/${username}?start=${encodeURIComponent(payload)}`;
}
