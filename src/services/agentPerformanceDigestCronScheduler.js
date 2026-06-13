import { agentPerformanceDigestCronHealthState } from '../bot/state.js';
import { config } from '../config.js';
import { sendAgentPerformanceDigest } from './agentPerformanceDigestService.js';

let schedulerStarted = false;
let digestCronRunning = false;
/** @type {string | null} date key (YYYY-MM-DD) in configured TZ when last daily send ran */
let lastSentDateKey = null;

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const read = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    dateKey: `${read('year')}-${read('month')}-${read('day')}`,
    hour: Number.parseInt(read('hour'), 10) || 0,
  };
}

async function runAgentPerformanceDigestCron(trigger) {
  if (digestCronRunning) return { skipped: true, reason: 'already_running' };
  digestCronRunning = true;
  agentPerformanceDigestCronHealthState.running = true;
  agentPerformanceDigestCronHealthState.lastStartedAt = new Date().toISOString();
  try {
    const result = await sendAgentPerformanceDigest({ requestedBy: trigger });
    agentPerformanceDigestCronHealthState.lastResult = result;
    agentPerformanceDigestCronHealthState.lastError = result.ok ? null : result.error || 'partial_failure';
    console.log('Agent performance digest cron:', {
      trigger,
      recipientCount: result.recipientCount,
      sent: result.sent,
      failed: result.failed,
    });
    return result;
  } catch (err) {
    agentPerformanceDigestCronHealthState.lastError = err?.message || String(err);
    console.error('Agent performance digest cron error:', err?.message || err);
    throw err;
  } finally {
    digestCronRunning = false;
    agentPerformanceDigestCronHealthState.running = false;
    agentPerformanceDigestCronHealthState.runCount += 1;
    agentPerformanceDigestCronHealthState.lastFinishedAt = new Date().toISOString();
  }
}

function tickDailyDigestSchedule() {
  const timeZone = config.agentPerformanceDigestCronTz;
  const targetHour = config.agentPerformanceDigestCronHour;
  const { dateKey, hour } = getZonedParts(new Date(), timeZone);
  if (hour !== targetHour) return;
  if (lastSentDateKey === dateKey) return;
  lastSentDateKey = dateKey;
  runAgentPerformanceDigestCron('cron-daily').catch((err) => {
    console.error('Agent performance digest scheduled run failed:', err?.message || err);
  });
}

/** Start daily agent performance digest cron (idempotent). */
export function startAgentPerformanceDigestCronIfNeeded() {
  if (schedulerStarted) return { started: false, reason: 'already_scheduled' };
  if (!config.agentPerformanceDigestCronEnabled) {
    agentPerformanceDigestCronHealthState.enabled = false;
    return { started: false, reason: 'AGENT_PERFORMANCE_DIGEST_CRON_ENABLED=false' };
  }

  schedulerStarted = true;
  agentPerformanceDigestCronHealthState.enabled = true;
  agentPerformanceDigestCronHealthState.timeZone = config.agentPerformanceDigestCronTz;
  agentPerformanceDigestCronHealthState.targetHour = config.agentPerformanceDigestCronHour;

  setInterval(tickDailyDigestSchedule, 60_000);
  tickDailyDigestSchedule();

  console.log(
    `Agent performance digest cron scheduled (daily at ${config.agentPerformanceDigestCronHour}:00 ${config.agentPerformanceDigestCronTz})`
  );

  return { started: true, reason: null };
}

export { runAgentPerformanceDigestCron };
