import { clientDailyReportCronHealthState } from '../bot/state.js';
import { config } from '../config.js';
import { sendClientDailyReportDigest } from './clientDailyReportService.js';

let schedulerStarted = false;
let reportCronRunning = false;
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

export async function runClientDailyReportCron(trigger, options = {}) {
  if (reportCronRunning) return { skipped: true, reason: 'already_running' };
  reportCronRunning = true;
  clientDailyReportCronHealthState.running = true;
  clientDailyReportCronHealthState.lastStartedAt = new Date().toISOString();
  try {
    const result = await sendClientDailyReportDigest({
      requestedBy: trigger,
      forceTestChatId: options.forceTestChatId,
    });
    clientDailyReportCronHealthState.lastResult = result;
    clientDailyReportCronHealthState.lastError = result.ok ? null : result.error || 'partial_failure';
    console.log('Client daily report cron:', {
      trigger,
      recipientCount: result.recipientCount,
      sent: result.sent,
      failed: result.failed,
      skippedNoApplications: result.skippedNoApplications,
    });
    return result;
  } catch (err) {
    clientDailyReportCronHealthState.lastError = err?.message || String(err);
    console.error('Client daily report cron error:', err?.message || err);
    throw err;
  } finally {
    reportCronRunning = false;
    clientDailyReportCronHealthState.running = false;
    clientDailyReportCronHealthState.runCount += 1;
    clientDailyReportCronHealthState.lastFinishedAt = new Date().toISOString();
  }
}

function tickDailyReportSchedule() {
  const timeZone = config.clientDailyReportCronTz;
  const targetHour = config.clientDailyReportCronHour;
  const { dateKey, hour } = getZonedParts(new Date(), timeZone);
  if (hour !== targetHour) return;
  if (lastSentDateKey === dateKey) return;
  lastSentDateKey = dateKey;
  runClientDailyReportCron('cron-daily').catch((err) => {
    console.error('Client daily report scheduled run failed:', err?.message || err);
  });
}

export function startClientDailyReportCronIfNeeded() {
  if (schedulerStarted) return { started: false, reason: 'already_scheduled' };
  if (!config.clientDailyReportCronEnabled) {
    clientDailyReportCronHealthState.enabled = false;
    return { started: false, reason: 'CLIENT_DAILY_REPORT_CRON_ENABLED=false' };
  }

  schedulerStarted = true;
  clientDailyReportCronHealthState.enabled = true;
  clientDailyReportCronHealthState.timeZone = config.clientDailyReportCronTz;
  clientDailyReportCronHealthState.targetHour = config.clientDailyReportCronHour;

  setInterval(tickDailyReportSchedule, 60_000);
  tickDailyReportSchedule();

  console.log(
    `Client daily report cron scheduled (daily at ${config.clientDailyReportCronHour}:00 ${config.clientDailyReportCronTz})`
  );

  return { started: true, reason: null };
}
