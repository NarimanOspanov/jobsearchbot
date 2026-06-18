import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load .env from project root (same folder as package.json) so it works from any cwd
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const result = dotenv.config({ path: envPath });
if (result.error && result.error.code !== 'ENOENT') {
  console.error('Error loading .env:', result.error.message);
}
console.log('Config: env loaded (path:', envPath, ')');

// Returns the value or empty string — does NOT throw at module load time.
// Validation happens later in main() via checkEnvLoaded().
function getEnv(name) {
  return process.env[name] || '';
}

/** Comma-separated positive numeric IDs (Telegram user/chat ids, etc.). */
export function parseCommaSeparatedIdSet(raw) {
  const set = new Set();
  for (const part of (raw || '').split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isSafeInteger(n) && n > 0) set.add(n);
  }
  return set;
}

/** Comma-separated non-empty strings (deduped, order preserved). */
export function parseCommaSeparatedStrings(raw) {
  const out = [];
  const seen = new Set();
  for (const part of String(raw || '').split(',')) {
    const value = part.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** @param {string} raw */
function parseTelegramUserIdSet(raw) {
  return parseCommaSeparatedIdSet(raw);
}

const isProduction = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3000;
const defaultWebhookUrl = isProduction
  ? 'https://imagetext-to-image-bot-asd9azexgqhxb2hs.northeurope-01.azurewebsites.net'
  : `http://localhost:${port}`;

export const config = {
  isProduction,
  telegramBotToken: getEnv('TELEGRAM_BOT_TOKEN'),
  geminiApiKey: getEnv('GEMINI_API_KEY'),
  geminiTextModel: getEnv('GEMINI_TEXT_MODEL') || 'gemini-2.5-flash',
  anthropicApiKey: getEnv('ANTHROPIC_API_KEY'),
  anthropicCvScoreModel: getEnv('ANTHROPIC_CVSCORE_MODEL') || 'claude-sonnet-4-20250514',
  botAdminTelegramIds: parseTelegramUserIdSet(getEnv('BOT_ADMIN_TELEGRAM_IDS')),
  /** Job posters who may build tracked apply links (Telegram user ids). */
  botPublisherTelegramIds: parseTelegramUserIdSet(getEnv('BOT_PUBLISHER_TELEGRAM_IDS')),
  /**
   * When non-empty, screening rejections only for applicants whose Users.TelegramChatId or Users.Id is listed.
   * Comma-separated. Unset/empty = all due applicants.
   */
  rejectionNotificationChatIds: parseCommaSeparatedIdSet(getEnv('REJECTION_NOTIFICATION_IDS')),
  /** Shared secret for POST/GET /api/cron/position-apply-screening/* (manual or external scheduler). */
  screeningCronSecret: getEnv('SCREENING_CRON_SECRET'),
  /** Run position-apply-screening cron (Redis queue, or in-process fallback without REDIS_URL). */
  screeningCronEnabled: String(process.env.SCREENING_CRON_ENABLED || 'true').toLowerCase() !== 'false',
  screeningCronIntervalMs: Math.max(
    10_000,
    Number.parseInt(process.env.SCREENING_CRON_INTERVAL_MS || '60000', 10) || 60_000
  ),
  screeningCronStartupDelayMs: Math.max(
    0,
    Number.parseInt(process.env.SCREENING_CRON_STARTUP_DELAY_MS || '30000', 10) || 30_000
  ),
  /** Redis URL for BullMQ queues (e.g. rediss://:password@host:10000). */
  redisUrl: getEnv('REDIS_URL'),
  /** Set true only for true OSS Redis Cluster (not Azure Managed Redis Enterprise). */
  redisClusterMode: String(process.env.REDIS_CLUSTER_MODE || '').toLowerCase() === 'true',
  /** Shared secret for apply-priority queue cron/board endpoints. */
  applyPriorityCronSecret: getEnv('APPLY_PRIORITY_CRON_SECRET') || getEnv('SCREENING_CRON_SECRET'),
  /** Run in-process enqueue-default cron (requires REDIS_URL). Set false to disable. */
  applyPriorityCronEnabled: String(process.env.APPLY_PRIORITY_CRON_ENABLED || 'true').toLowerCase() !== 'false',
  /** Interval for apply-priority default enqueue cron (default 10 minutes). */
  applyPriorityCronIntervalMs: Math.max(
    60_000,
    Number.parseInt(process.env.APPLY_PRIORITY_CRON_INTERVAL_MS || String(10 * 60 * 1000), 10) ||
      10 * 60 * 1000
  ),
  /** Jobs per Anyhires page when cron enqueues apply-priority (default 100, max 200). */
  applyPriorityCronPageSize: Math.min(
    200,
    Math.max(1, Number.parseInt(process.env.APPLY_PRIORITY_CRON_PAGE_SIZE || '100', 10) || 100)
  ),
  /**
   * Max pages per client per cron run. 0 or unset = all pages until hasMore (capped at 200 pages).
   * Set e.g. 10 to limit API load per tick.
   */
  applyPriorityCronMaxPages: Number.parseInt(process.env.APPLY_PRIORITY_CRON_MAX_PAGES || '0', 10) || 0,
  /** Daily Telegram digest of agent applied-job counts (24h / 7d / 30d). */
  agentPerformanceDigestCronEnabled:
    String(process.env.AGENT_PERFORMANCE_DIGEST_CRON_ENABLED || 'true').toLowerCase() !== 'false',
  /** IANA timezone for daily send hour (default 21:00). */
  agentPerformanceDigestCronTz: getEnv('AGENT_PERFORMANCE_DIGEST_CRON_TZ') || 'UTC',
  agentPerformanceDigestCronHour: Math.min(
    23,
    Math.max(0, Number.parseInt(process.env.AGENT_PERFORMANCE_DIGEST_CRON_HOUR || '21', 10) || 21)
  ),
  /** Daily Telegram digest for clients with last-24h applied job report. */
  clientDailyReportCronEnabled:
    String(process.env.CLIENT_DAILY_REPORT_CRON_ENABLED || 'true').toLowerCase() !== 'false',
  /** IANA timezone for daily send hour (default 20:00). */
  clientDailyReportCronTz: getEnv('CLIENT_DAILY_REPORT_CRON_TZ') || 'UTC',
  clientDailyReportCronHour: Math.min(
    23,
    Math.max(0, Number.parseInt(process.env.CLIENT_DAILY_REPORT_CRON_HOUR || '20', 10) || 20)
  ),
  /**
   * Delivery mode:
   * - test_only: send only to CLIENT_DAILY_REPORT_TEST_CHAT_ID (default)
   * - all: send to all eligible clients
   */
  clientDailyReportDeliveryMode: String(process.env.CLIENT_DAILY_REPORT_DELIVERY_MODE || 'test_only')
    .trim()
    .toLowerCase(),
  /** Test target Telegram chat id (used when delivery mode is test_only). */
  clientDailyReportTestChatId: Number.parseInt(getEnv('CLIENT_DAILY_REPORT_TEST_CHAT_ID') || '0', 10) || 0,
  /** Users.TelegramChatId values for LinkedIn Easy Apply specialists (global client pool). */
  globalEasyApplyAgentTelegramChatIds: [
    ...parseCommaSeparatedIdSet(
      getEnv('GLOBAL_EASY_APPLY_AGENT_TELEGRAMCHAT_ID') || getEnv('GLOBAL_EASY_APPLY_AGENT_USER_ID')
    ),
  ],
  telegraphTokens: parseCommaSeparatedStrings(getEnv('TELEGRAPH_TOKEN')),
  /** @deprecated Use telegraphTokens[0]; first token from TELEGRAPH_TOKEN env. */
  telegraphToken: parseCommaSeparatedStrings(getEnv('TELEGRAPH_TOKEN'))[0] || '',
  applyAckPreviewJobCount: Math.min(
    20,
    Math.max(1, Number.parseInt(process.env.APPLY_ACK_PREVIEW_JOB_COUNT || '10', 10) || 10)
  ),
  applyAckPreviewTimeoutMs: Math.min(
    60000,
    Math.max(5000, Number.parseInt(process.env.APPLY_ACK_PREVIEW_TIMEOUT_MS || '20000', 10) || 20000)
  ),
  azureStorageConnectionString: getEnv('AZURE_STORAGE_CONNECTION_STRING'),
  azureResumeContainerName: 'resumes',
  azureTailoredResumeContainerName: 'tailoredresumes',
  webhookUrl: getEnv('WEBHOOK_URL') || defaultWebhookUrl,
  /** Base URL for tailored CV microservice (same host as /cvscore bot flows). */
  tailoredCvServiceUrl: (
    getEnv('TAILORED_CV_SERVICE_URL') ||
    getEnv('GENERATE_TAILORED_URL') ||
    'https://tailered-cv.onrender.com'
  ).replace(/\/$/, ''),
  /** @deprecated Use tailoredCvServiceUrl; kept for older configs. */
  generateTailoredUrl: getEnv('GENERATE_TAILORED_URL').replace(/\/$/, ''),
  // MSSQL (Azure SQL) – override with DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    database: process.env.DB_NAME || 'jobsearchbot',
    username: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    dialect: 'mssql',
  },
};
