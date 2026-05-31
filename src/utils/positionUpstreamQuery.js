/**
 * Shared query parsing for anyhires position list proxies (global-remote-positions, remote-positions).
 */

function mapApplyTypeToken(rawToken) {
  const value = String(rawToken || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'linkedin') return 'linkedin';
  if (value === 'indeed') return 'indeed';
  if (value === 'telegram' || value === 'telegram channels') return 'telegram';
  if (value === 'external' || value === 'company sites') return 'external';
  return '';
}

function parseApplyTypes(...inputs) {
  const unique = new Set();
  for (const input of inputs) {
    const rawValues = Array.isArray(input) ? input : [input];
    const chunks = rawValues
      .flatMap((value) => String(value || '').split(','))
      .map((item) => mapApplyTypeToken(item))
      .filter(Boolean);
    for (const chunk of chunks) unique.add(chunk);
  }
  return [...unique];
}

function normalizeSourceToken(rawToken) {
  const value = String(rawToken || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'linkedin') return 'Linkedin';
  if (value === 'indeed') return 'Indeed';
  if (value === 'hirehi') return 'hirehi';
  return '';
}

function parseSource(input) {
  const rawValues = Array.isArray(input) ? input : [input];
  for (const rawValue of rawValues) {
    const tokens = String(rawValue || '')
      .split(',')
      .map((item) => normalizeSourceToken(item))
      .filter(Boolean);
    if (tokens.length) return tokens[0];
  }
  return '';
}

function parseCountryCsv(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * @param {import('express').Request} req
 */
export function parsePositionsListQuery(req) {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const skillIds = String(req.query.skillIds || req.query.skillId || '').trim();
  const showOnlyHighlyRelevantRaw = String(req.query.showOnlyHighlyRelevant || '').trim().toLowerCase();
  const showOnlyHighlyRelevant =
    showOnlyHighlyRelevantRaw === 'true' ||
    showOnlyHighlyRelevantRaw === '1' ||
    showOnlyHighlyRelevantRaw === 'yes';
  const applyTypes = parseApplyTypes(req.query.applyType, req.query.applyTypes, req.query.sourceIds);
  const source = parseSource(req.query.source);
  const country = parseCountryCsv(req.query.country);
  const pageRaw = Number.parseInt(String(req.query.page || '1'), 10);
  const pageSizeRaw = Number.parseInt(String(req.query.pageSize || '100'), 10);
  const page = Number.isSafeInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize =
    Number.isSafeInteger(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(200, pageSizeRaw) : 100;

  return {
    from,
    to,
    skillIds,
    showOnlyHighlyRelevant,
    applyTypes,
    source,
    country,
    page,
    pageSize,
  };
}

/**
 * @param {ReturnType<typeof parsePositionsListQuery>} query
 * @param {{ includeCountry?: boolean }} [options]
 */
export function buildAnyhiresPositionsSearchParams(query, options = {}) {
  const upstreamParams = new URLSearchParams();
  upstreamParams.set('from', query.from);
  upstreamParams.set('to', query.to);
  if (query.skillIds) upstreamParams.set('skillIds', query.skillIds);
  if (query.showOnlyHighlyRelevant) upstreamParams.set('showOnlyHighlyRelevant', 'true');
  if (query.source) upstreamParams.set('source', query.source);
  for (const applyType of query.applyTypes) {
    upstreamParams.append('applyType', applyType);
  }
  if (options.includeCountry && query.country.length) {
    upstreamParams.set('country', query.country.join(','));
  }
  upstreamParams.set('page', String(query.page));
  upstreamParams.set('pageSize', String(query.pageSize));
  return upstreamParams;
}

/** Positions with explicit country first, then id descending. */
export function sortRemotePositionsByCountryThenId(positions) {
  const hasCountry = (row) => {
    const value = row?.country;
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim() !== '';
  };
  return [...positions].sort((a, b) => {
    const countryA = hasCountry(a);
    const countryB = hasCountry(b);
    if (countryA !== countryB) return countryB ? 1 : -1;
    return Number(b.id) - Number(a.id);
  });
}

/**
 * @param {import('express').Response} res
 * @param {ReturnType<typeof parsePositionsListQuery>} query
 * @param {object} payload
 * @param {{ sortByCountry?: boolean }} [options]
 */
export function sendPositionsListPayload(res, query, payload, options = {}) {
  const upstreamPositions = Array.isArray(payload?.positions) ? payload.positions : [];
  const positions = options.sortByCountry
    ? sortRemotePositionsByCountryThenId(upstreamPositions)
    : upstreamPositions;

  if (
    Object.prototype.hasOwnProperty.call(payload || {}, 'page') ||
    Object.prototype.hasOwnProperty.call(payload || {}, 'hasMore')
  ) {
    return res.json({
      ...payload,
      page: Number(payload.page || query.page),
      pageSize: Number(payload.pageSize || query.pageSize),
      hasMore: Boolean(payload.hasMore),
      count: Number(payload.count || positions.length),
      positions,
    });
  }

  const all = positions;
  const offset = (query.page - 1) * query.pageSize;
  const pageItems = all.slice(offset, offset + query.pageSize);
  const hasMore = offset + pageItems.length < all.length;
  return res.json({
    ...payload,
    page: query.page,
    pageSize: query.pageSize,
    hasMore,
    count: pageItems.length,
    positions: pageItems,
  });
}
