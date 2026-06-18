import { config } from '../config.js';
import { buildAnyhiresPositionsSearchParams } from '../utils/positionUpstreamQuery.js';
import {
  clientHasApplyPrioritySkills,
  rankJobsForSeekerPreview,
} from './agentApplyPriorityService.js';
import {
  buildTopJobsTelegraphContent,
  createTelegraphPage,
} from './telegraphService.js';

function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDateRangeForDays(days = 7) {
  const span = Math.min(90, Math.max(1, Number.parseInt(String(days || '7'), 10) || 7));
  const now = new Date();
  const to = localIsoDate(now);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - span);
  const from = localIsoDate(fromDate);
  return { from, to, days: span };
}

function normalizeSkillIdsCsv(rawSkills) {
  const list = Array.isArray(rawSkills) ? rawSkills : [];
  return list
    .map((id) => Number.parseInt(String(id), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .join(',');
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
 * @param {Array<{ jobId: number, applyRank: number, priority: string }>} rankings
 * @param {Map<number, object>} jobsById
 * @param {number} [limit]
 */
export function selectTopPreviewJobs(rankings, jobsById, limit = 10) {
  const safeLimit = Math.max(1, Number(limit) || 10);
  return rankings
    .filter((row) => row.priority !== 'skip')
    .sort((a, b) => a.applyRank - b.applyRank)
    .slice(0, safeLimit)
    .map((row) => jobsById.get(Number(row.jobId)))
    .filter(Boolean);
}

function previewPageTitle(lang) {
  return lang === 'ru' ? 'Подходящие удалённые вакансии' : 'Matching remote jobs';
}

/**
 * @param {{ user: object, lang?: string }}
 */
export async function buildApplyAckJobPreview({ user, lang = 'en' }) {
  try {
    if (!clientHasApplyPrioritySkills(user)) {
      return { skipped: true, reason: 'no_skills' };
    }
    if (!Array.isArray(config.telegraphTokens) || config.telegraphTokens.length === 0) {
      return { skipped: true, reason: 'no_telegraph_token' };
    }

    const skillIds = normalizeSkillIdsCsv(user?.skills);
    if (!skillIds) {
      return { skipped: true, reason: 'no_skills' };
    }

    const dateRange = getDateRangeForDays(7);
    const country = parseCountryCsv(user?.WorkAuthorizationCountries);
    const pageSize = 100;
    const { positions } = await fetchPositionsPage({
      from: dateRange.from,
      to: dateRange.to,
      skillIds,
      showOnlyHighlyRelevant: false,
      applyTypes: [],
      source: '',
      country,
      page: 1,
      pageSize,
    });

    if (!positions.length) {
      return { skipped: true, reason: 'no_jobs' };
    }

    const { rankings } = await rankJobsForSeekerPreview({ clientUser: user, jobs: positions });
    const jobsById = new Map(
      positions.map((job) => [Number.parseInt(String(job?.id ?? ''), 10), job])
    );
    const topJobs = selectTopPreviewJobs(rankings, jobsById, config.applyAckPreviewJobCount);
    if (!topJobs.length) {
      return { skipped: true, reason: 'no_ranked_jobs' };
    }

    const appBaseUrl = (process.env.ADMIN_APP_URL || config.webhookUrl || '').replace(/\/$/, '');
    const contentNodes = buildTopJobsTelegraphContent({
      jobs: topJobs,
      lang,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      appBaseUrl,
    });
    const page = await createTelegraphPage({
      title: previewPageTitle(lang),
      contentNodes,
    });

    return {
      skipped: false,
      previewUrl: page?.url || null,
      previewCount: topJobs.length,
      dateRange,
    };
  } catch (err) {
    return { skipped: true, reason: err?.message || 'preview_failed' };
  }
}

/**
 * @param {{ user: object, lang?: string, timeoutMs?: number }}
 */
export async function buildApplyAckJobPreviewWithTimeout({
  user,
  lang = 'en',
  timeoutMs = config.applyAckPreviewTimeoutMs,
} = {}) {
  const ms = Math.max(1000, Number(timeoutMs) || config.applyAckPreviewTimeoutMs);
  let timer = null;
  try {
    return await Promise.race([
      buildApplyAckJobPreview({ user, lang }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ skipped: true, reason: 'timeout' }), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
