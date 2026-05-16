export function toBoolOrUndefined(value) {
  if (typeof value === 'boolean') return value;
  return undefined;
}

export function toLanguageOrUndefined(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ru' || normalized === 'en') return normalized;
  return undefined;
}

export function toSearchModeOrUndefined(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'urgent' || normalized === 'not_urgent') return normalized;
  return undefined;
}

export function toIntOrNullOrUndefined(value) {
  if (value == null || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function toSkillIdsOrNullOrUndefined(value, normalizeSkillIds) {
  if (value == null || value === '') return null;
  if (!Array.isArray(value)) return undefined;
  return normalizeSkillIds(value);
}

export function toScoreOrNullOrUndefined(value) {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return undefined;
  if (n < 0 || n > 99.9) return undefined;
  return Math.round(n * 10) / 10;
}

export function toStringOrUndefined(value, maxLen = 255) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

export function toValidUrlOrUndefined(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function toUuidOrUndefined(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return undefined;
  return UUID_V4_RE.test(v) ? v : undefined;
}
