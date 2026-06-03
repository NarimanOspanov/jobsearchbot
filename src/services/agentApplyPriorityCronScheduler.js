import { applyPriorityCronHealthState } from '../bot/state.js';
import { config } from '../config.js';
import { enqueueApplyPriorityForDefaultClientSearches } from './agentApplyPriorityCronService.js';
import { getAgentApplyPriorityQueueState } from './agentApplyPriorityQueueService.js';

let schedulerStarted = false;
let applyPriorityCronRunning = false;

/**
 * Start in-process hourly enqueue-default cron (idempotent).
 * Call after Redis queue is enabled — does not depend on Telegram bot startup.
 */
export function startApplyPriorityHourlyCronIfNeeded() {
  if (schedulerStarted) return { started: false, reason: 'already_scheduled' };

  const queueState = getAgentApplyPriorityQueueState();
  if (!queueState.enabled) {
    applyPriorityCronHealthState.enabled = false;
    return { started: false, reason: 'queue_disabled' };
  }
  if (!config.applyPriorityCronEnabled) {
    applyPriorityCronHealthState.enabled = false;
    return { started: false, reason: 'APPLY_PRIORITY_CRON_ENABLED=false' };
  }

  const runApplyPriorityCron = async () => {
    if (applyPriorityCronRunning) return;
    applyPriorityCronRunning = true;
    applyPriorityCronHealthState.running = true;
    applyPriorityCronHealthState.lastStartedAt = new Date().toISOString();
    try {
      const result = await enqueueApplyPriorityForDefaultClientSearches({
        requestedBy: 'cron-hourly',
      });
      applyPriorityCronHealthState.lastResult = result;
      applyPriorityCronHealthState.lastError = null;
      console.log('Agent apply-priority cron tick:', {
        enqueued: result?.enqueued ?? 0,
        totalFetchedJobs: result?.totalFetchedJobs ?? 0,
        totalSkippedAlreadyRanked: result?.totalSkippedAlreadyRanked ?? 0,
        totalAssignedWithResume: result?.totalAssignedWithResume ?? 0,
      });
    } catch (err) {
      applyPriorityCronHealthState.lastError = err?.message || String(err);
      console.error('Agent apply-priority cron error:', err?.message || err);
    } finally {
      applyPriorityCronRunning = false;
      applyPriorityCronHealthState.running = false;
      applyPriorityCronHealthState.runCount += 1;
      applyPriorityCronHealthState.lastFinishedAt = new Date().toISOString();
    }
  };

  schedulerStarted = true;
  applyPriorityCronHealthState.enabled = true;
  applyPriorityCronHealthState.intervalMs = config.applyPriorityCronIntervalMs;
  const startupDelayMs = applyPriorityCronHealthState.startupDelayMs;

  setTimeout(() => {
    runApplyPriorityCron().catch((err) => {
      console.error('Agent apply-priority cron startup run error:', err?.message || err);
    });
  }, startupDelayMs);
  setInterval(runApplyPriorityCron, config.applyPriorityCronIntervalMs);

  console.log(
    `Agent apply-priority cron scheduled (every ${Math.round(config.applyPriorityCronIntervalMs / 60_000)} min, first run in ~${Math.round(startupDelayMs / 1000)} s, times logged in UTC)`
  );

  return { started: true, reason: null };
}
