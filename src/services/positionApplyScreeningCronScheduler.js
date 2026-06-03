import { runtimeBot, screeningCronHealthState } from '../bot/state.js';
import { config } from '../config.js';
import {
  buildScreeningJobsUi,
  processDueScreeningResponses,
} from './positionApplyScreeningService.js';
import {
  enqueueScreeningTick,
  getPositionApplyScreeningQueueState,
} from './positionApplyScreeningQueueService.js';

let schedulerStarted = false;
let fallbackStarted = false;
let screeningCronRunning = false;

function logScreeningScheduleMode() {
  const rejectionChatFilter = config.rejectionNotificationChatIds;
  if (rejectionChatFilter.size > 0) {
    console.log(
      `Position apply screening cron: TEST MODE — only TelegramChatIds=[${Array.from(rejectionChatFilter).join(', ')}] (unset REJECTION_NOTIFICATION_IDS for all users)`
    );
  }
}

function startScreeningCronFallback() {
  if (fallbackStarted) return { started: false, reason: 'fallback_already_scheduled' };
  fallbackStarted = true;
  screeningCronHealthState.enabled = true;
  screeningCronHealthState.intervalMs = config.screeningCronIntervalMs;
  screeningCronHealthState.startupDelayMs = config.screeningCronStartupDelayMs;

  const screeningJobsUi = buildScreeningJobsUi();
  const runScreeningCron = async () => {
    if (screeningCronRunning || !runtimeBot.telegram) return;
    screeningCronRunning = true;
    screeningCronHealthState.running = true;
    screeningCronHealthState.lastStartedAt = new Date().toISOString();
    try {
      const result = await processDueScreeningResponses({
        telegram: runtimeBot.telegram,
        jobsUi: screeningJobsUi,
      });
      screeningCronHealthState.lastResult = result;
      screeningCronHealthState.lastError = null;
      if (result.processed > 0 || result.warning || result.rejectionNotificationChatIds) {
        console.log('Position apply screening cron (fallback):', result);
      }
    } catch (err) {
      screeningCronHealthState.lastError = err?.message || String(err);
      console.error('Position apply screening cron (fallback) error:', err?.message || err);
    } finally {
      screeningCronRunning = false;
      screeningCronHealthState.running = false;
      screeningCronHealthState.runCount += 1;
      screeningCronHealthState.lastFinishedAt = new Date().toISOString();
    }
  };

  const startupDelayMs = screeningCronHealthState.startupDelayMs;
  setTimeout(() => {
    runScreeningCron().catch((err) => {
      console.error('Position apply screening fallback startup error:', err?.message || err);
    });
  }, startupDelayMs);
  setInterval(runScreeningCron, config.screeningCronIntervalMs);

  console.log(
    `Position apply screening cron fallback (every ${Math.round(config.screeningCronIntervalMs / 1000)} s, first run in ~${Math.round(startupDelayMs / 1000)} s)`
  );
  logScreeningScheduleMode();
  return { started: true, reason: 'fallback_in_process', mode: 'fallback' };
}

/**
 * Start screening cron scheduler (Redis queue) or in-process fallback when Redis is unavailable.
 * Call after Telegram bot is ready.
 */
export function startPositionApplyScreeningCronIfNeeded() {
  if (schedulerStarted) return { started: false, reason: 'already_scheduled' };
  if (!config.screeningCronEnabled) {
    screeningCronHealthState.enabled = false;
    return { started: false, reason: 'SCREENING_CRON_ENABLED=false' };
  }

  const queueState = getPositionApplyScreeningQueueState();
  if (!queueState.enabled) {
    screeningCronHealthState.enabled = false;
    return startScreeningCronFallback();
  }

  schedulerStarted = true;
  screeningCronHealthState.enabled = true;
  screeningCronHealthState.intervalMs = config.screeningCronIntervalMs;
  screeningCronHealthState.startupDelayMs = config.screeningCronStartupDelayMs;

  const runEnqueueTick = async () => {
    if (screeningCronRunning) return;
    screeningCronRunning = true;
    screeningCronHealthState.lastStartedAt = new Date().toISOString();
    try {
      const enqueued = await enqueueScreeningTick({ requestedBy: 'cron-minute' });
      screeningCronHealthState.lastError = null;
      if (enqueued.enqueued) {
        screeningCronHealthState.running = true;
      } else if (enqueued.skipped) {
        screeningCronHealthState.lastResult = { ok: true, skippedEnqueue: true, reason: enqueued.reason };
      }
    } catch (err) {
      screeningCronHealthState.lastError = err?.message || String(err);
      console.error('Position apply screening cron enqueue error:', err?.message || err);
    } finally {
      screeningCronRunning = false;
    }
  };

  const startupDelayMs = screeningCronHealthState.startupDelayMs;
  setTimeout(() => {
    runEnqueueTick().catch((err) => {
      console.error('Position apply screening cron startup enqueue error:', err?.message || err);
    });
  }, startupDelayMs);
  setInterval(runEnqueueTick, config.screeningCronIntervalMs);

  console.log(
    `Position apply screening cron scheduled via Redis (every ${Math.round(config.screeningCronIntervalMs / 1000)} s, first enqueue in ~${Math.round(startupDelayMs / 1000)} s)`
  );
  logScreeningScheduleMode();
  return { started: true, reason: null, mode: 'redis' };
}
