import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { config } from '../config.js';
import { models } from '../db.js';
import { rankJobsForAgentApply } from './agentApplyPriorityService.js';
import { persistApplyPriorityForPageJobs } from './agentApplyPriorityPersistenceService.js';

const QUEUE_NAME = 'agent-apply-priority';
const JOB_NAME = 'analyze-client-priority';
// Redis Cluster requirement: all BullMQ keys for a queue must hash to the same slot.
// Hash-tagged prefix enforces same slot and avoids CROSSSLOT evalsha errors.
const QUEUE_PREFIX = '{agent-apply-priority}';

let queueState = {
  enabled: false,
  reason: 'REDIS_URL is not configured',
  queue: null,
  worker: null,
  boardAdapter: null,
};

function createRedisConnection(label) {
  if (!config.redisUrl) return null;

  if (config.redisClusterMode) {
    console.warn(
      'REDIS_CLUSTER_MODE is set but ignored. Azure Managed Redis (Enterprise) needs a single-endpoint client, not ioredis.Cluster.'
    );
  }

  let parsed;
  try {
    parsed = new URL(config.redisUrl);
  } catch {
    console.info(`Redis queue client (${label}): URL parse failed, using string URL`);
    return new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
  }

  const isTls = parsed.protocol === 'rediss:';
  const host = parsed.hostname;
  const port = Number.parseInt(parsed.port || (isTls ? '6380' : '6379'), 10);
  const password = decodeURIComponent(parsed.password || '');
  const username = decodeURIComponent(parsed.username || '');

  console.info(`Redis queue client (${label}): single-endpoint`, {
    host,
    port,
    tls: isTls,
    client: 'IORedis',
  });

  const client = new IORedis({
    host,
    port,
    ...(password ? { password } : {}),
    ...(username ? { username } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...(isTls ? { tls: { servername: host } } : {}),
  });

  client.on('error', (err) => {
    console.error(`Redis queue client (${label}) error:`, err?.message || err);
  });

  return client;
}

function sanitizeJobPayload(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((job) => ({
      id: Number.parseInt(String(job?.id ?? ''), 10),
      title: String(job?.title || '').trim().slice(0, 255),
      company: String(job?.company || '').trim().slice(0, 255),
      source: String(job?.source || '').trim() || null,
      applyUrl: String(job?.applyUrl || '').trim() || null,
      location: String(job?.location || '').trim().slice(0, 255) || null,
      shortSummary: String(job?.shortSummary || '').trim().slice(0, 1200) || null,
      description: String(job?.description || '').trim().slice(0, 6000) || null,
      skills: Array.isArray(job?.skills) ? job.skills.slice(0, 40) : [],
    }))
    .filter((job) => Number.isSafeInteger(job.id) && job.id > 0)
    .slice(0, 200);
}

export function initAgentApplyPriorityQueue() {
  if (queueState.queue || queueState.worker || queueState.enabled) return queueState;
  const queueConnection = createRedisConnection('queue');
  const workerConnection = createRedisConnection('worker');
  if (!queueConnection || !workerConnection) return queueState;

  const queue = new Queue(QUEUE_NAME, {
    connection: queueConnection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      removeOnComplete: 200,
      removeOnFail: 500,
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
    },
  });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const clientUserId = Number.parseInt(String(job.data?.clientUserId ?? ''), 10);
      const jobs = sanitizeJobPayload(job.data?.jobs);
      if (!Number.isSafeInteger(clientUserId) || clientUserId <= 0) {
        throw new Error('Invalid clientUserId in queued job');
      }
      if (!jobs.length) throw new Error('Queued job has no jobs payload');
      const client = await models.Users.findByPk(clientUserId);
      if (!client) throw new Error(`Client ${clientUserId} not found`);
      const result = await rankJobsForAgentApply({ clientUser: client, jobs });
      const persisted = await persistApplyPriorityForPageJobs({
        clientUserId,
        client,
        jobs,
        rankings: result.rankings,
        context: result.context,
      });
      return {
        clientUserId,
        jobCount: result?.context?.jobCount ?? jobs.length,
        persisted,
      };
    },
    { connection: workerConnection, concurrency: 3, prefix: QUEUE_PREFIX }
  );

  worker.on('failed', (job, err) => {
    console.error('Apply priority queue job failed:', {
      queueJobId: job?.id,
      clientUserId: job?.data?.clientUserId,
      error: err?.message || String(err),
    });
  });

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/api/cron/agent-apply-priority/board');
  createBullBoard({
    queues: [new BullMQAdapter(queue)],
    serverAdapter,
  });

  queueState = {
    enabled: true,
    reason: null,
    mode: 'single',
    queue,
    worker,
    boardAdapter: serverAdapter,
  };
  return queueState;
}

export function getAgentApplyPriorityQueueState() {
  return queueState;
}

export async function enqueueApplyPriorityJobsForClients({ clientUserIds, jobs, requestedBy }) {
  if (!queueState.enabled || !queueState.queue) {
    throw new Error('Apply priority queue is not enabled (REDIS_URL is missing)');
  }
  const normalizedClientIds = [...new Set((Array.isArray(clientUserIds) ? clientUserIds : [])
    .map((id) => Number.parseInt(String(id), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
  const sanitizedJobs = sanitizeJobPayload(jobs);
  if (!normalizedClientIds.length) {
    return { enqueued: 0, skipped: 0, queueJobIds: [] };
  }
  if (!sanitizedJobs.length) {
    throw new Error('jobs array is required');
  }

  const queueJobIds = [];
  for (const clientUserId of normalizedClientIds) {
    const queued = await queueState.queue.add(
      JOB_NAME,
      {
        clientUserId,
        jobs: sanitizedJobs,
        requestedBy: requestedBy || null,
        enqueuedAt: new Date().toISOString(),
      },
      {
        jobId: `${clientUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }
    );
    queueJobIds.push(String(queued.id));
  }
  return { enqueued: queueJobIds.length, skipped: 0, queueJobIds };
}

export async function getAgentApplyPriorityQueueSnapshot() {
  if (!queueState.enabled || !queueState.queue) {
    return {
      enabled: false,
      reason: queueState.reason || 'Queue disabled',
      counts: null,
    };
  }
  const counts = await queueState.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  return {
    enabled: true,
    reason: null,
    mode: queueState.mode || 'single',
    counts,
  };
}
