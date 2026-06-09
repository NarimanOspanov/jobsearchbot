import { Sequelize } from 'sequelize';
import { config } from '../config.js';
import { models } from '../db.js';
import { buildAnyhiresPositionsSearchParams } from '../utils/positionUpstreamQuery.js';
import { getPendingHumanAssistantUserIds } from './humanAssistantRequestService.js';
import { clientIsReadyForApplyPriority } from './agentApplyPriorityService.js';
import { enqueueApplyPriorityJobsForClients, getAgentApplyPriorityQueueState } from './agentApplyPriorityQueueService.js';

/** Hard stop when maxPages is unlimited (hasMore loop). */
const CRON_ABSOLUTE_MAX_PAGES = 200;

function normalizeCronMaxPages(maxPages) {
  const parsed = Number.parseInt(String(maxPages ?? config.applyPriorityCronMaxPages ?? '0'), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(CRON_ABSOLUTE_MAX_PAGES, parsed);
}

function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDateRangeForDays(days = 7) {
  const span = Math.min(90, Math.max(1, Number.parseInt(String(days || '7'), 10) || 7));
  const now = new Date();
  const to = localIsoDate(now);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - span);
  const from = localIsoDate(fromDate);
  return { from, to, days: span };
}

function getDefaultDateRange() {
  const { from, to } = getDateRangeForDays(7);
  return { from, to };
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

async function filterUnrankedJobsForClient({ clientUserId, jobs }) {
  const ids = [...new Set((Array.isArray(jobs) ? jobs : [])
    .map((job) => Number.parseInt(String(job?.id ?? ''), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];

  const existing = await models.Applications.findAll({
    attributes: ['ScreenlyJobId'],
    where: {
      UserId: clientUserId,
      ScreenlyJobId: { [Sequelize.Op.in]: ids },
      ApplyPriorityJson: {
        [Sequelize.Op.not]: null,
        [Sequelize.Op.ne]: '',
      },
    },
    raw: true,
  });
  const existingIds = new Set(existing.map((row) => Number(row.ScreenlyJobId)));
  return jobs.filter((job) => !existingIds.has(Number(job?.id)));
}

async function enqueueClientDefaultPages({
  client,
  from,
  to,
  pageSize,
  maxPages,
  requestedBy,
  rewrite = false,
}) {
  const skillIds = normalizeSkillIdsCsv(client?.skills);
  const country = parseCountryCsv(client?.WorkAuthorizationCountries);
  // Queue/cron uses broader job set than UI "client click" (which enables top matches).
  const showOnlyHighlyRelevant = false;
  let totalFetched = 0;
  let totalQueued = 0;
  let skippedAlreadyRanked = 0;
  let pagesProcessed = 0;
  let pagesWithJobs = 0;
  const queueJobIds = [];

  let page = 1;
  while (true) {
    const query = {
      from,
      to,
      skillIds,
      showOnlyHighlyRelevant,
      applyTypes: [],
      source: '',
      country,
      page,
      pageSize,
    };
    const payload = await fetchPositionsPage(query);
    const pageJobs = payload.positions;
    pagesProcessed += 1;
    totalFetched += pageJobs.length;
    if (pageJobs.length) pagesWithJobs += 1;

    if (pageJobs.length) {
      const jobsToQueue = rewrite
        ? pageJobs
        : await filterUnrankedJobsForClient({
            clientUserId: Number(client.Id),
            jobs: pageJobs,
          });
      skippedAlreadyRanked += rewrite ? 0 : pageJobs.length - jobsToQueue.length;
      if (jobsToQueue.length) {
        const enqueued = await enqueueApplyPriorityJobsForClients({
          clientUserIds: [Number(client.Id)],
          jobs: jobsToQueue,
          requestedBy,
        });
        totalQueued += Number(enqueued?.enqueued || 0);
        queueJobIds.push(...(Array.isArray(enqueued?.queueJobIds) ? enqueued.queueJobIds : []));
      }
    }

    if (!payload.hasMore || pageJobs.length === 0) break;
    const atConfiguredLimit = maxPages != null && page >= maxPages;
    const atAbsoluteLimit = page >= CRON_ABSOLUTE_MAX_PAGES;
    if (atConfiguredLimit || atAbsoluteLimit) {
      if (atAbsoluteLimit && maxPages == null) {
        console.warn(
          `Apply-priority cron: absolute page cap (${CRON_ABSOLUTE_MAX_PAGES}) for client ${client.Id}`
        );
      }
      break;
    }
    page += 1;
  }

  return {
    clientUserId: Number(client.Id),
    pagesProcessed,
    pagesWithJobs,
    totalFetched,
    skippedAlreadyRanked,
    queuedJobs: totalQueued,
    queueJobIds,
    defaults: {
      from,
      to,
      skillIds,
      country: country.join(','),
      showOnlyHighlyRelevant,
      pageSize,
      maxPages,
      rewrite: Boolean(rewrite),
    },
  };
}

export async function enqueueApplyPriorityForDefaultClientSearches({
  agentUserId = null,
  pageSize = config.applyPriorityCronPageSize,
  maxPages = config.applyPriorityCronMaxPages,
  requestedBy = null,
} = {}) {
  const queueState = getAgentApplyPriorityQueueState();
  if (!queueState.enabled) {
    throw new Error('Apply priority queue is disabled. Configure REDIS_URL first.');
  }

  const normalizedPageSize = Math.min(200, Math.max(1, Number.parseInt(String(pageSize || '100'), 10) || 100));
  const normalizedMaxPages = normalizeCronMaxPages(maxPages);
  const normalizedAgentUserId = Number.isSafeInteger(Number(agentUserId)) && Number(agentUserId) > 0
    ? Number(agentUserId)
    : null;
  const assignmentWhere = normalizedAgentUserId ? { AgentUserId: normalizedAgentUserId } : undefined;
  const assignments = await models.AgentClients.findAll({
    where: assignmentWhere,
    include: [{ model: models.Users, as: 'Client', required: true }],
    order: [['Id', 'ASC']],
  });
  const pendingHumanAssistantUserIds = await getPendingHumanAssistantUserIds();
  const clients = assignments
    .map((row) => row.Client)
    .filter((client) => client && String(client.ResumeURL || '').trim())
    .filter((client) => clientIsReadyForApplyPriority(client))
    .filter((client) => !pendingHumanAssistantUserIds.has(Number(client.Id)));

  const dateRange = getDefaultDateRange();
  const perClient = [];
  let totalQueued = 0;
  let totalFetched = 0;
  let totalSkippedAlreadyRanked = 0;

  for (const client of clients) {
    const summary = await enqueueClientDefaultPages({
      client,
      from: dateRange.from,
      to: dateRange.to,
      pageSize: normalizedPageSize,
      maxPages: normalizedMaxPages,
      requestedBy,
    });
    totalQueued += summary.queuedJobs;
    totalFetched += summary.totalFetched;
    totalSkippedAlreadyRanked += summary.skippedAlreadyRanked;
    perClient.push(summary);
  }

  return {
    ok: true,
    mode: queueState.mode || 'single',
    agentUserId: normalizedAgentUserId,
    defaults: {
      from: dateRange.from,
      to: dateRange.to,
      pageSize: normalizedPageSize,
      maxPages: normalizedMaxPages,
    },
    totalAssignedWithResume: clients.length,
    totalFetchedJobs: totalFetched,
    totalSkippedAlreadyRanked,
    enqueued: totalQueued,
    clients: perClient,
  };
}

export async function enqueueApplyPriorityDefaultForClient({
  clientUserId,
  pageSize = config.applyPriorityCronPageSize,
  maxPages = config.applyPriorityCronMaxPages,
  requestedBy = null,
  rewrite = false,
  days = 7,
} = {}) {
  const queueState = getAgentApplyPriorityQueueState();
  if (!queueState.enabled) {
    throw new Error('Apply priority queue is disabled. Configure REDIS_URL first.');
  }

  const normalizedClientUserId = Number.parseInt(String(clientUserId ?? ''), 10);
  if (!Number.isSafeInteger(normalizedClientUserId) || normalizedClientUserId <= 0) {
    throw new Error('clientUserId is required');
  }

  const client = await models.Users.findByPk(normalizedClientUserId);
  if (!client) throw new Error(`Client ${normalizedClientUserId} not found`);
  if (!String(client.ResumeURL || '').trim()) {
    throw new Error('Client has no resume uploaded');
  }
  if (!clientIsReadyForApplyPriority(client)) {
    throw new Error('Set client roles/skills and comment (companies to skip) before running apply priority');
  }

  const normalizedPageSize = Math.min(200, Math.max(1, Number.parseInt(String(pageSize || '100'), 10) || 100));
  const normalizedMaxPages = normalizeCronMaxPages(maxPages);
  const dateRange = getDateRangeForDays(days);
  const summary = await enqueueClientDefaultPages({
    client,
    from: dateRange.from,
    to: dateRange.to,
    pageSize: normalizedPageSize,
    maxPages: normalizedMaxPages,
    requestedBy,
    rewrite: Boolean(rewrite),
  });

  return {
    ok: true,
    mode: queueState.mode || 'single',
    rewrite: Boolean(rewrite),
    defaults: {
      from: dateRange.from,
      to: dateRange.to,
      days: dateRange.days,
      pageSize: normalizedPageSize,
      maxPages: normalizedMaxPages,
      rewrite: Boolean(rewrite),
    },
    enqueued: summary.queuedJobs,
    ...summary,
  };
}
