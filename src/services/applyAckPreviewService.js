import { config } from '../config.js';
import { buildAnyhiresPositionsSearchParams } from '../utils/positionUpstreamQuery.js';
import { normalizeSkillIds } from './userService.js';

function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDateRangeForDays(days = 3) {
  const span = Math.min(90, Math.max(1, Number.parseInt(String(days || '3'), 10) || 3));
  const now = new Date();
  const to = localIsoDate(now);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - span);
  const from = localIsoDate(fromDate);
  return { from, to, days: span };
}

export function firstSkillIdFromUser(user) {
  const ids = normalizeSkillIds(user?.skills);
  return ids.length ? ids[0] : null;
}

export function takeFirstPositions(positions, limit = 5) {
  const safeLimit = Math.max(1, Number(limit) || 5);
  return (Array.isArray(positions) ? positions : []).slice(0, safeLimit);
}

function parseCountryCsv(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function fetchPositionsPage(query) {
  const upstreamParams = buildAnyhiresPositionsSearchParams(query, {
    includeCountry: query.country.length > 0,
  });
  const route = query.country.length > 0 ? 'remote-positions' : 'global-remote-positions';
  const url = `https://anyhires.com/api/${route}?${upstreamParams.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    throw new Error(`Failed to load ${route}: ${txt || response.status}`);
  }
  const payload = await response.json();
  return {
    positions: Array.isArray(payload?.positions) ? payload.positions : [],
    hasMore: Boolean(payload?.hasMore),
  };
}

/**
 * Fast post-apply job list: first skill only, last N days, first M API results (no AI / Telegraph).
 * @param {{ user: object }}
 */
export async function fetchApplyAckQuickJobs({ user }) {
  try {
    const skillId = firstSkillIdFromUser(user);
    if (!skillId) {
      return { skipped: true, reason: 'no_skills' };
    }

    const previewDays = config.applyAckPreviewDays;
    const jobCount = config.applyAckPreviewJobCount;
    const dateRange = getDateRangeForDays(previewDays);
    const country = parseCountryCsv(user?.WorkAuthorizationCountries);

    const { positions } = await fetchPositionsPage({
      from: dateRange.from,
      to: dateRange.to,
      skillIds: String(skillId),
      showOnlyHighlyRelevant: false,
      applyTypes: [],
      source: '',
      country,
      page: 1,
      pageSize: jobCount,
    });

    const topJobs = takeFirstPositions(positions, jobCount);
    if (!topJobs.length) {
      return { skipped: true, reason: 'no_jobs', dateRange, previewDays, skillId };
    }

    const appBaseUrl = (process.env.ADMIN_APP_URL || config.webhookUrl || '').replace(/\/$/, '');
    return {
      skipped: false,
      previewCount: topJobs.length,
      topJobs,
      appBaseUrl,
      dateRange,
      previewDays,
      skillId,
    };
  } catch (err) {
    return { skipped: true, reason: err?.message || 'fetch_failed' };
  }
}
