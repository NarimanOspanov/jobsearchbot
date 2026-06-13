/** @typedef {{
 *   skillIds: number[];
 *   sourceIds: number[];
 *   dateFrom: string | null;
 *   dateTo: string | null;
 *   showOnlyHighlyRelevant: boolean;
 * }} ParsedSearchFilters */

/** @typedef {{ kind: 'search'; filters: ParsedSearchFilters } | { kind: 'legacyWeb'; encryptedQ: string }} ParseResult */

export const SOURCE_BITS = [1, 2, 4, 8];

/** Telegram start_param / startapp: only A-Z a-z 0-9 _ - (max 512). */
export const TELEGRAM_START_PARAM_RE = /^[\w-]{0,512}$/;

/** @param {string} value */
export function isTelegramSafeStartParam(value) {
  return TELEGRAM_START_PARAM_RE.test(String(value || ''));
}

/** Bit index = sourceId − 1 (Telegram=1, LinkedIn=2, HH=4, Indeed=8). */
export const SOURCE_ID_TO_APPLY_TYPE = {
  1: 'telegram',
  2: 'linkedin',
  3: 'external',
  4: 'indeed',
};

/** @param {string | number} mask */
export function decodeSourceMask(mask) {
  const n = Number.parseInt(String(mask), 10) || 0;
  return SOURCE_BITS.map((bit, i) => (n & bit ? i + 1 : null)).filter(Boolean);
}

/** @param {string} yyMMdd */
export function expandCompactDate(yyMMdd) {
  if (!/^\d{6}$/.test(yyMMdd)) return null;
  return `20${yyMMdd.slice(0, 2)}-${yyMMdd.slice(2, 4)}-${yyMMdd.slice(4, 6)}`;
}

const COMPACT_V2_US_RE = /^(\d+)_(\d+)_(\d{6})_(\d{6})$/;
/** Legacy dot separator — invalid in Telegram startapp; kept for decode-only compat. */
const COMPACT_V2_DOT_RE = /^(\d+)\.(\d+)\.(\d{6})\.(\d{6})$/;

function decodeBase64UrlToUtf8(b64url) {
  let s = String(b64url || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (s.length % 4)) % 4;
  s += '='.repeat(padLen);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function encodeBase64UrlUtf8(str) {
  const bytes = new TextEncoder().encode(String(str || ''));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** @param {RegExpMatchArray} m */
function filtersFromCompactMatch(m) {
  const skillId = Number.parseInt(m[1], 10);
  const dateFrom = expandCompactDate(m[3]);
  const dateTo = expandCompactDate(m[4]);
  if (!dateFrom || !dateTo) return null;
  return {
    skillIds: skillId > 0 ? [skillId] : [],
    sourceIds: decodeSourceMask(m[2]),
    dateFrom,
    dateTo,
    showOnlyHighlyRelevant: skillId > 0,
  };
}

function matchCompactV2Payload(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  let m = COMPACT_V2_US_RE.exec(value);
  if (m) return m;
  m = COMPACT_V2_DOT_RE.exec(value);
  if (m) return m;
  if (!/^[\w-]+$/.test(value)) return null;
  try {
    const decoded = decodeBase64UrlToUtf8(value).trim();
    m = COMPACT_V2_US_RE.exec(decoded);
    if (m) return m;
    return COMPACT_V2_DOT_RE.exec(decoded);
  } catch {
    return null;
  }
}

/**
 * Canonical compact body: `{skillId}_{sourceMask}_{fromYYMMDD}_{toYYMMDD}`.
 * Underscores are required — Telegram rejects `.` in startapp on mobile.
 * @param {{ skillId?: number, sourceMask?: number, fromYYMMDD: string, toYYMMDD: string }} parts
 */
export function buildCompactV2Payload(parts) {
  const skillId = Number.parseInt(String(parts?.skillId ?? 0), 10) || 0;
  const sourceMask = Number.parseInt(String(parts?.sourceMask ?? 0), 10) || 0;
  const fromYYMMDD = String(parts?.fromYYMMDD || '').trim();
  const toYYMMDD = String(parts?.toYYMMDD || '').trim();
  return `${skillId}_${sourceMask}_${fromYYMMDD}_${toYYMMDD}`;
}

/** @deprecated Use buildCompactV2Payload (underscore separator). */
export function buildCompactV2DotPayload(parts) {
  return buildCompactV2Payload(parts).replace(/_/g, '.');
}

/**
 * Telegram-safe startapp: `sj2__{skillId}_{sourceMask}_{fromYYMMDD}_{toYYMMDD}`.
 * @param {{ skillId?: number, sourceMask?: number, fromYYMMDD: string, toYYMMDD: string, encoding?: 'underscore' | 'base64' }} parts
 */
export function buildSj2TelegramStartapp(parts) {
  const usBody = buildCompactV2Payload(parts);
  const body =
    parts?.encoding === 'base64'
      ? encodeBase64UrlUtf8(buildCompactV2DotPayload(parts))
      : usBody;
  const startapp = `sj2__${body}`;
  if (!isTelegramSafeStartParam(startapp)) {
    throw new Error('sj2 startapp exceeds Telegram limits or contains invalid characters');
  }
  return startapp;
}

/** @param {string} payload */
export function parseCompactV2(payload) {
  const m = matchCompactV2Payload(payload);
  if (!m) return null;
  return filtersFromCompactMatch(m);
}

/** @param {URLSearchParams} params */
function filtersFromLegacyParams(params) {
  const skillIds = String(params.get('skillIds') || params.get('skillId') || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => Number.isFinite(n));
  const sourceIds = String(params.get('sourceIds') || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => Number.isFinite(n));
  const dateFrom = params.get('from') || null;
  const dateTo = params.get('to') || null;
  const showRaw = params.get('showOnlyHighlyRelevant');
  const showOnlyHighlyRelevant = showRaw === 'true';
  if (!dateFrom && !dateTo && !skillIds.length && !sourceIds.length && showRaw == null) return null;
  return {
    skillIds,
    sourceIds,
    dateFrom,
    dateTo,
    showOnlyHighlyRelevant,
  };
}

/** @param {string} base64Payload */
export function parseLegacySeekerJobs(base64Payload) {
  const payload = String(base64Payload || '').trim().replace(/^_+/, '');
  if (!payload) return null;

  try {
    const plain = filtersFromLegacyParams(new URLSearchParams(payload));
    if (plain) return plain;
  } catch {
    // not plain query
  }

  try {
    let b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const params = new URLSearchParams(atob(b64));
    return filtersFromLegacyParams(params);
  } catch {
    return null;
  }
}

/** @param {string} raw */
export function parseStartParam(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.startsWith('search__')) {
    return { kind: 'legacyWeb', encryptedQ: value.slice('search__'.length) };
  }
  if (value.startsWith('sj2__')) {
    const filters = parseCompactV2(value.slice('sj2__'.length));
    return filters ? { kind: 'search', filters } : null;
  }
  if (value.startsWith('seekerjobs__')) {
    const filters = parseLegacySeekerJobs(value.slice('seekerjobs__'.length));
    return filters ? { kind: 'search', filters } : null;
  }
  return null;
}

/** @param {{ tg?: object, search?: string | URLSearchParams }} [options] */
export function resolveRawStartParam(options = {}) {
  const tg = options.tg || (typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined);
  const params =
    options.search instanceof URLSearchParams
      ? options.search
      : new URLSearchParams(options.search ?? (typeof window !== 'undefined' ? window.location.search : ''));
  const initStart = String(tg?.initDataUnsafe?.start_param || '').trim();
  const startApp = String(params.get('startapp') || params.get('startApp') || '').trim();
  const start = String(params.get('start') || '').trim();
  return initStart || startApp || start || '';
}

/** @param {number[]} sourceIds */
export function sourceIdsToApplyTypes(sourceIds) {
  return (sourceIds || [])
    .map((id) => SOURCE_ID_TO_APPLY_TYPE[id])
    .filter(Boolean);
}

/** @param {ParsedSearchFilters} filters */
export function filtersToUrlSearchParams(filters) {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('from', filters.dateFrom);
  if (filters.dateTo) params.set('to', filters.dateTo);
  if (filters.skillIds.length) params.set('skillIds', filters.skillIds.join(','));
  if (filters.sourceIds.length) {
    params.set('sourceIds', filters.sourceIds.join(','));
    const applyTypes = sourceIdsToApplyTypes(filters.sourceIds);
    if (applyTypes.length) params.set('applyTypes', applyTypes.join(','));
  }
  if (filters.showOnlyHighlyRelevant) params.set('showOnlyHighlyRelevant', 'true');
  return params;
}

/** @param {ParsedSearchFilters} filters */
export function parsedFiltersToQueryState(filters) {
  const applyTypes = sourceIdsToApplyTypes(filters.sourceIds).join(',');
  return {
    from: filters.dateFrom || '',
    to: filters.dateTo || '',
    skillIds: filters.skillIds.join(','),
    applyTypes,
    source: '',
    showOnlyHighlyRelevant: filters.showOnlyHighlyRelevant ? 'true' : '',
    country: '',
    jobId: '',
    page: '1',
    pageSize: '100',
  };
}

/** @param {{ tg?: object, fallbackUrl?: string, legacyWebBaseUrl?: string }} [options] */
export function bootstrapMiniAppIndexRedirect(options = {}) {
  const tg = options.tg || (typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined);
  if (tg?.ready) tg.ready();

  const fallbackUrl = options.fallbackUrl || '/app/applications';
  const legacyWebBaseUrl = options.legacyWebBaseUrl || 'https://anyhires.com/JobSearch/Search';
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const rawStart = resolveRawStartParam({ tg, search: params });
  const hashFrag = typeof window !== 'undefined' ? window.location.hash || '' : '';

  if (!rawStart) {
    if (typeof window !== 'undefined') window.location.replace(fallbackUrl);
    return;
  }

  const parsed = parseStartParam(rawStart);
  if (parsed?.kind === 'legacyWeb') {
    let rawQ = String(parsed.encryptedQ || '').trim();
    if (!rawQ) {
      if (typeof window !== 'undefined') window.location.replace(fallbackUrl + hashFrag);
      return;
    }
    try {
      rawQ = decodeURIComponent(rawQ);
    } catch {
      // keep as-is
    }
    const targetUrl = `${legacyWebBaseUrl}?q=${encodeURIComponent(rawQ)}`;
    if (typeof window !== 'undefined') window.location.replace(targetUrl);
    return;
  }

  if (parsed?.kind === 'search') {
    const qs = filtersToUrlSearchParams(parsed.filters).toString();
    const targetUrl = qs ? `/app/seeker-jobs-deeplink?${qs}` : '/app/seeker-jobs-deeplink';
    if (typeof window !== 'undefined') window.location.replace(targetUrl + hashFrag);
    return;
  }

  if (rawStart.startsWith('agentclients__')) {
    if (typeof window !== 'undefined') {
      bootstrapAgentClientsRedirect(rawStart, params, fallbackUrl, hashFrag);
    }
    return;
  }

  if (rawStart.startsWith('seekerjobs__')) {
    if (typeof window !== 'undefined') {
      bootstrapLegacySeekerJobsRedirect(rawStart, params, hashFrag);
    }
    return;
  }

  if (typeof window !== 'undefined') window.location.replace(fallbackUrl);
}

function innerParamsFromStartappPayload(raw, allowedKeys) {
  let r = String(raw || '').trim();
  if (!r) return new URLSearchParams();
  const tryParse = (s) => new URLSearchParams(String(s).startsWith('?') ? String(s).slice(1) : String(s));
  const hasAny = (sp) => allowedKeys.some((k) => String(sp.get(k) || '').trim());
  const direct = tryParse(r);
  if (hasAny(direct)) return direct;
  try {
    const decoded = decodeBase64UrlToUtf8(r);
    const inner = tryParse(decoded);
    if (hasAny(inner)) return inner;
  } catch {
    // not base64utf8 query
  }
  return new URLSearchParams();
}

function bootstrapAgentClientsRedirect(rawStart, params, fallbackUrl, hashFrag) {
  let rawQuery = rawStart.slice('agentclients__'.length).trim().replace(/^_+/, '');
  try {
    rawQuery = decodeURIComponent(rawQuery);
  } catch {
    // keep as-is
  }

  const allowedKeys = ['seekerId', 'jobId', 'page'];
  const inner = innerParamsFromStartappPayload(rawQuery, allowedKeys);
  const hasStructured = allowedKeys.some((k) => String(inner.get(k) || '').trim());
  if (!hasStructured) {
    window.location.replace(fallbackUrl + hashFrag);
    return;
  }

  const merged = new Map();
  allowedKeys.forEach((key) => {
    const v = String(inner.get(key) || '').trim();
    if (v) merged.set(key, v);
  });
  for (const [key, value] of params.entries()) {
    if (key === 'startapp' || key === 'startApp' || key === 'start') continue;
    if (!allowedKeys.includes(key)) continue;
    const v = String(value || '').trim();
    if (v) merged.set(key, v);
  }
  const nextParts = [];
  allowedKeys.forEach((key) => {
    if (merged.has(key)) nextParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(merged.get(key))}`);
  });
  const targetUrl = nextParts.length ? `/app/agent/clients?${nextParts.join('&')}` : '/app/agent/clients';
  window.location.replace(targetUrl + hashFrag);
}

function bootstrapLegacySeekerJobsRedirect(rawStart, params, hashFrag) {
  let rawQuery = rawStart.slice('seekerjobs__'.length).trim().replace(/^_+/, '');
  try {
    rawQuery = decodeURIComponent(rawQuery);
  } catch {
    // keep as-is
  }

  const parsed = parseStartParam(rawStart);
  if (parsed?.kind === 'search') {
    const qs = filtersToUrlSearchParams(parsed.filters).toString();
    const targetUrl = qs ? `/app/seeker-jobs-deeplink?${qs}` : '/app/seeker-jobs-deeplink';
    window.location.replace(targetUrl + hashFrag);
    return;
  }

  const allowedKeys = [
    'from',
    'to',
    'skillIds',
    'sourceIds',
    'page',
    'pageSize',
    'showOnlyHighlyRelevant',
    'jobId',
  ];
  const keys = allowedKeys.concat(['skillId']);
  const inner = innerParamsFromStartappPayload(rawQuery, keys);
  const keysCheck = allowedKeys.concat(['skillId']);
  const hasStructured = keysCheck.some((k) => String(inner.get(k) || '').trim());

  if (!hasStructured) {
    window.location.replace(`/app/seeker-jobs-deeplink?q=${encodeURIComponent(rawQuery)}${hashFrag}`);
    return;
  }

  const merged = new Map();
  allowedKeys.forEach((key) => {
    const v = String(inner.get(key) || '').trim();
    if (v) merged.set(key, v);
  });
  for (const [key, value] of params.entries()) {
    if (key === 'startapp' || key === 'startApp' || key === 'start') continue;
    if (!allowedKeys.includes(key)) continue;
    const v = String(value || '').trim();
    if (v) merged.set(key, v);
  }
  const nextParts = [];
  allowedKeys.forEach((key) => {
    if (merged.has(key)) nextParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(merged.get(key))}`);
  });
  const targetUrl = nextParts.length ? `/app/seeker-jobs-deeplink?${nextParts.join('&')}` : '/app/seeker-jobs-deeplink';
  window.location.replace(targetUrl + hashFrag);
}

/** @param {{ tg?: object }} [options] */
export function applyStartParamFiltersFromLocation(options = {}) {
  const tg = options.tg || (typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined);
  const raw = resolveRawStartParam({ tg });
  const parsed = parseStartParam(raw);
  if (parsed?.kind !== 'search') return parsed;
  const qs = filtersToUrlSearchParams(parsed.filters).toString();
  if (typeof window !== 'undefined') {
    history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }
  return parsed;
}

if (typeof window !== 'undefined') {
  window.SeekerStartParam = {
    SOURCE_BITS,
    TELEGRAM_START_PARAM_RE,
    SOURCE_ID_TO_APPLY_TYPE,
    isTelegramSafeStartParam,
    decodeSourceMask,
    expandCompactDate,
    buildCompactV2Payload,
    buildCompactV2DotPayload,
    buildSj2TelegramStartapp,
    parseCompactV2,
    parseLegacySeekerJobs,
    parseStartParam,
    resolveRawStartParam,
    sourceIdsToApplyTypes,
    filtersToUrlSearchParams,
    parsedFiltersToQueryState,
    bootstrapMiniAppIndexRedirect,
    applyStartParamFiltersFromLocation,
  };
}
