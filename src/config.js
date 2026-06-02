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
  /** Redis URL for BullMQ queues (e.g. rediss://:password@host:10000). */
  redisUrl: getEnv('REDIS_URL'),
  /** Set true only for true OSS Redis Cluster (not Azure Managed Redis Enterprise). */
  redisClusterMode: String(process.env.REDIS_CLUSTER_MODE || '').toLowerCase() === 'true',
  /** Shared secret for apply-priority queue cron/board endpoints. */
  applyPriorityCronSecret: getEnv('APPLY_PRIORITY_CRON_SECRET') || getEnv('SCREENING_CRON_SECRET'),
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
