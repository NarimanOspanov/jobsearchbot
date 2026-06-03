import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { runtimeBot, screeningCronHealthState } from '../bot/state.js';
import { config } from '../config.js';
import {
  buildScreeningJobsUi,
  processDueScreeningResponses,
} from './positionApplyScreeningService.js';

const QUEUE_NAME = 'position-apply-screening';
const JOB_NAME = 'process-due-screenings';
const QUEUE_PREFIX = '{position-apply-screening}';

let queueState = {
  enabled: false,
  reason: 'REDIS_URL is not configured',
  queue: null,
  worker: null,
  boardAdapter: null,
};

function createRedisConnection(label) {
  if (!config.redisUrl) return null;

  let parsed;
  try {
    parsed = new URL(config.redisUrl);
  } catch {
    console.info(`Redis screening queue (${label}): URL parse failed, using string URL`);
    return new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
  }

  const isTls = parsed.protocol === 'rediss:';
  const host = parsed.hostname;
  const port = Number.parseInt(parsed.port || (isTls ? '6380' : '6379'), 10);
  const password = decodeURIComponent(parsed.password || '');
  const username = decodeURIComponent(parsed.username || '');

  if (config.redisClusterMode) {
    console.info(`Redis screening queue (${label}): cluster`, { host, port, tls: isTls });
    return new IORedis.Cluster(
      [{ host, port }],
      {
        enableReadyCheck: true,
        slotsRefreshTimeout: 15000,
        redisOptions: {
          ...(password ? { password } : {}),
          ...(username ? { username } : {}),
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          ...(isTls ? { tls: { servername: host } } : {}),
        },
      }
    );
  }

  console.info(`Redis screening queue (${label}): single-endpoint`, { host, port, tls: isTls });
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
    console.error(`Redis screening queue (${label}) error:`, err?.message || err);
  });

  return client;
}

function normalizeTickPayload(raw = {}) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(raw.limit ?? '50'), 10) || 50));
  const rejectionNotificationIds =
    raw.rejectionNotificationIds != null && String(raw.rejectionNotificationIds).trim() !== ''
      ? String(raw.rejectionNotificationIds)
      : undefined;
  const onlyUserApplicationId = Number.parseInt(String(raw.onlyUserApplicationId ?? ''), 10);
  return {
    limit,
    rejectionNotificationIds,
    onlyUserApplicationId:
      Number.isSafeInteger(onlyUserApplicationId) && onlyUserApplicationId > 0
        ? onlyUserApplicationId
        : null,
    requestedBy: raw.requestedBy || null,
  };
}

function screeningJobId(payload) {
  if (payload.onlyUserApplicationId) {
    return `manual-${payload.onlyUserApplicationId}-${Date.now()}`;
  }
  return `tick-${Math.floor(Date.now() / 60000)}`;
}

export function initPositionApplyScreeningQueue() {
  if (queueState.queue || queueState.worker || queueState.enabled) return queueState;
  const queueConnection = createRedisConnection('screening-queue');
  const workerConnection = createRedisConnection('screening-worker');
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
      screeningCronHealthState.running = true;
      screeningCronHealthState.lastStartedAt = new Date().toISOString();
      screeningCronHealthState.lastError = null;

      const payload = normalizeTickPayload(job.data);
      if (!runtimeBot.telegram) {
        return { ok: false, reason: 'telegram_not_ready', ...payload };
      }

      const result = await processDueScreeningResponses({
        telegram: runtimeBot.telegram,
        limit: payload.limit,
        rejectionNotificationIds: payload.rejectionNotificationIds,
        onlyUserApplicationId: payload.onlyUserApplicationId,
        jobsUi: buildScreeningJobsUi(),
      });

      screeningCronHealthState.lastResult = result;
      if (result.processed > 0 || result.warning || result.rejectionNotificationChatIds) {
        console.log('Position apply screening queue job:', {
          queueJobId: job.id,
          processed: result.processed,
          sent: result.sent,
          failed: result.failed,
          skipped: result.skipped,
        });
      }
      return result;
    },
    { connection: workerConnection, concurrency: 1, prefix: QUEUE_PREFIX }
  );

  worker.on('completed', () => {
    screeningCronHealthState.running = false;
    screeningCronHealthState.runCount += 1;
    screeningCronHealthState.lastFinishedAt = new Date().toISOString();
  });

  worker.on('failed', (job, err) => {
    screeningCronHealthState.running = false;
    screeningCronHealthState.runCount += 1;
    screeningCronHealthState.lastFinishedAt = new Date().toISOString();
    screeningCronHealthState.lastError = err?.message || String(err);
    console.error('Position apply screening queue job failed:', {
      queueJobId: job?.id,
      error: err?.message || String(err),
    });
  });

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/api/cron/position-apply-screening/board');
  createBullBoard({
    queues: [new BullMQAdapter(queue)],
    serverAdapter,
  });

  queueState = {
    enabled: true,
    reason: null,
    mode: config.redisClusterMode ? 'cluster' : 'single',
    queue,
    worker,
    boardAdapter: serverAdapter,
  };
  return queueState;
}

export function getPositionApplyScreeningQueueState() {
  return queueState;
}

export async function enqueueScreeningTick(opts = {}) {
  if (!queueState.enabled || !queueState.queue) {
    throw new Error('Position apply screening queue is not enabled (REDIS_URL is missing)');
  }
  const payload = normalizeTickPayload(opts);
  const jobId = screeningJobId(payload);
  try {
    const queued = await queueState.queue.add(
      JOB_NAME,
      {
        ...payload,
        enqueuedAt: new Date().toISOString(),
      },
      { jobId }
    );
    return { enqueued: true, skipped: false, queueJobId: String(queued.id), jobId };
  } catch (err) {
    const msg = err?.message || String(err);
    if (/already exists|Job .* exists/i.test(msg)) {
      return { enqueued: false, skipped: true, queueJobId: null, jobId, reason: 'duplicate_tick' };
    }
    throw err;
  }
}

export async function getPositionApplyScreeningQueueSnapshot() {
  if (!queueState.enabled || !queueState.queue) {
    return {
      enabled: false,
      reason: queueState.reason || 'Queue disabled',
      counts: null,
    };
  }
  const counts = await queueState.queue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
    'paused'
  );
  return {
    enabled: true,
    reason: null,
    mode: queueState.mode || 'single',
    counts,
  };
}
