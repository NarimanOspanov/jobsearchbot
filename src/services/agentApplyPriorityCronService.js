import { Sequelize } from 'sequelize';
import { models } from '../db.js';
import { buildAnyhiresPositionsSearchParams } from '../utils/positionUpstreamQuery.js';
import { enqueueApplyPriorityJobsForClients, getAgentApplyPriorityQueueState } from './agentApplyPriorityQueueService.js';

function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDefaultDateRange() {
  const now = new Date();
  const to = localIsoDate(now);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 7);
  const from = localIsoDate(fromDate);
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

  for (let page = 1; page <= maxPages; page += 1) {
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
      const unrankedJobs = await filterUnrankedJobsForClient({
        clientUserId: Number(client.Id),
        jobs: pageJobs,
      });
      skippedAlreadyRanked += pageJobs.length - unrankedJobs.length;
      if (unrankedJobs.length) {
        const enqueued = await enqueueApplyPriorityJobsForClients({
          clientUserIds: [Number(client.Id)],
          jobs: unrankedJobs,
          requestedBy,
        });
        totalQueued += Number(enqueued?.enqueued || 0);
        queueJobIds.push(...(Array.isArray(enqueued?.queueJobIds) ? enqueued.queueJobIds : []));
      }
    }

    if (!payload.hasMore || pageJobs.length === 0) break;
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
    },
  };
}

export async function enqueueApplyPriorityForDefaultClientSearches({
  agentUserId = null,
  pageSize = 100,
  maxPages = 5,
  requestedBy = null,
}) {
  const queueState = getAgentApplyPriorityQueueState();
  if (!queueState.enabled) {
    throw new Error('Apply priority queue is disabled. Configure REDIS_URL first.');
  }

  const normalizedPageSize = Math.min(200, Math.max(1, Number.parseInt(String(pageSize || '100'), 10) || 100));
  const normalizedMaxPages = Math.min(20, Math.max(1, Number.parseInt(String(maxPages || '5'), 10) || 5));
  const normalizedAgentUserId = Number.isSafeInteger(Number(agentUserId)) && Number(agentUserId) > 0
    ? Number(agentUserId)
    : null;
  const assignmentWhere = normalizedAgentUserId ? { AgentUserId: normalizedAgentUserId } : undefined;
  const assignments = await models.AgentClients.findAll({
    where: assignmentWhere,
    include: [{ model: models.Users, as: 'Client', required: true }],
    order: [['Id', 'ASC']],
  });
  const clients = assignments
    .map((row) => row.Client)
    .filter((client) => client && String(client.ResumeURL || '').trim());

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
