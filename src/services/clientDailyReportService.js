import { Sequelize } from 'sequelize';
import { models, sequelize } from '../db.js';
import { config } from '../config.js';
import { runtimeBot } from '../bot/state.js';
import { normalizeChatId } from '../utils/helpers.js';
import { resolveBotLanguage } from '../utils/userLanguage.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const COPY = {
  en: {
    noNameGreeting: 'Hi!',
    greeting: (firstName) => `Hi, ${firstName}!`,
    summary: (count) =>
      `In last day we have applied to ${count} position${count === 1 ? '' : 's'} for you. We tailored resumes and cover letters for each application.`,
    listHeader: 'Applied jobs:',
    moreItems: (count) => `...and ${count} more.`,
    cta: 'Check report with details here',
    button: 'Open daily report',
  },
  ru: {
    noNameGreeting: 'Привет!',
    greeting: (firstName) => `Привет, ${firstName}!`,
    summary: (count) =>
      `За последний день мы откликнулись для вас на ${count} ваканси${count % 10 === 1 && count % 100 !== 11 ? 'ю' : 'й'}. Для каждого отклика мы подготовили адаптированные резюме и сопроводительные письма.`,
    listHeader: 'Список откликов:',
    moreItems: (count) => `...и еще ${count}.`,
    cta: 'Подробный отчет по кнопке ниже',
    button: 'Открыть дневной отчет',
  },
};

function appBaseUrl() {
  return String(process.env.ADMIN_APP_URL || config.webhookUrl || '').replace(/\/$/, '');
}

function copyForLanguage(language) {
  return COPY[language === 'ru' ? 'ru' : 'en'];
}

function parseMetaJson(metaJson) {
  if (!metaJson) return null;
  if (typeof metaJson === 'object') return metaJson;
  try {
    return JSON.parse(metaJson);
  } catch {
    return null;
  }
}

function buildDailyReportWebAppUrl() {
  const base = appBaseUrl();
  if (!base) return '';
  return `${base}/app/daily-report?period=24h`;
}

function firstNameFromUser(user) {
  return String(user?.FirstName || '').trim();
}

function normalizeRecipientRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const chatId = normalizeChatId(row?.telegramChatId);
      const userId = Number.parseInt(String(row?.userId || ''), 10);
      if (chatId == null || !Number.isSafeInteger(userId) || userId <= 0) return null;
      return {
        userId,
        chatId: Number(chatId),
        firstName: String(row?.firstName || '').trim(),
        language: resolveBotLanguage(row?.language),
      };
    })
    .filter(Boolean);
}

export function isClientDailyReportTestOnlyMode() {
  return config.clientDailyReportDeliveryMode !== 'all';
}

export function isClientDailyReportTestTarget(chatId) {
  const target = Number(config.clientDailyReportTestChatId || 0);
  return Number.isSafeInteger(target) && target > 0 && Number(chatId) === target;
}

export async function listClientDailyReportRecipients() {
  const baseSql = `
      SELECT
        u.Id AS userId,
        u.TelegramChatId AS telegramChatId,
        u.FirstName AS firstName,
        u.Language AS language
      FROM dbo.Users AS u
      WHERE u.TelegramChatId IS NOT NULL
        AND ISNULL(u.IsBlocked, 0) = 0
        AND ISNULL(u.PushNotificationsEnabled, 1) = 1
  `;

  if (isClientDailyReportTestOnlyMode()) {
    const chatId = Number(config.clientDailyReportTestChatId || 0);
    if (!Number.isSafeInteger(chatId) || chatId <= 0) return [];
    const rows = await sequelize.query(`${baseSql} AND u.TelegramChatId = :chatId`, {
      replacements: { chatId },
      type: Sequelize.QueryTypes.SELECT,
    });
    return normalizeRecipientRows(rows);
  }

  const rows = await sequelize.query(baseSql, {
    type: Sequelize.QueryTypes.SELECT,
  });
  return normalizeRecipientRows(rows);
}

export async function fetchClientDailyReportRows(userId, { since = null } = {}) {
  const fromDate = since instanceof Date ? since : new Date(Date.now() - DAY_MS);
  const rows = await models.Applications.findAll({
    where: {
      UserId: userId,
      AppliedAt: { [Sequelize.Op.gte]: fromDate },
      [Sequelize.Op.and]: Sequelize.where(Sequelize.fn('lower', Sequelize.col('Status')), 'applied'),
    },
    order: [['AppliedAt', 'DESC'], ['Id', 'DESC']],
    limit: 500,
  });

  return rows.map((row) => {
    const data = row.toJSON ? row.toJSON() : row;
    const meta = parseMetaJson(data.MetaJson);
    return {
      id: data.Id,
      userId: data.UserId,
      screenlyJobId: data.ScreenlyJobId ?? null,
      vacancyTitle: data.VacancyTitle || '',
      companyName: data.CompanyName || '',
      source: data.Source || '',
      applyType: data.ApplyType || '',
      status: data.Status || '',
      appliedAt: data.AppliedAt || null,
      tailoredCvUrl: data.TailoredCVURL || null,
      coverLetter: data.CoverLetter || null,
      coverLetterUrl: data.CoverLetterUrl || null,
      screenshotArtifactUrl: data.ScreenshotArtifactURL || null,
      meta: meta || {},
    };
  });
}

function buildAppliedJobsLines(rows, copy) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return [];
  const maxItems = 12;
  const visible = items.slice(0, maxItems);
  const lines = visible.map((row) => {
    const title = String(row?.vacancyTitle || '').trim() || '—';
    const company = String(row?.companyName || '').trim() || '—';
    return `• ${title} — ${company}`;
  });
  if (items.length > maxItems) lines.push(copy.moreItems(items.length - maxItems));
  return [copy.listHeader, ...lines];
}

export function formatClientDailyReportMessage({ firstName, language, appliedCount, rows = [] }) {
  const copy = copyForLanguage(resolveBotLanguage(language));
  const greeting = firstName ? copy.greeting(firstName) : copy.noNameGreeting;
  const jobsLines = buildAppliedJobsLines(rows, copy);
  return [greeting, '', copy.summary(appliedCount), ...(jobsLines.length ? ['', ...jobsLines] : []), '', copy.cta].join(
    '\n'
  );
}

function buildClientDailyReportReplyMarkup(language) {
  const url = buildDailyReportWebAppUrl();
  if (!url || !/^https:\/\//i.test(url)) return undefined;
  const copy = copyForLanguage(resolveBotLanguage(language));
  return {
    inline_keyboard: [[{ text: copy.button, web_app: { url } }]],
  };
}

export async function sendClientDailyReportDigest(options = {}) {
  const requestedBy = String(options.requestedBy || 'manual').trim() || 'manual';
  const dryRun = Boolean(options.dryRun);
  const since = options.since instanceof Date ? options.since : new Date(Date.now() - DAY_MS);
  const telegram = runtimeBot.telegram;

  if (!telegram && !dryRun) {
    return {
      ok: false,
      error: 'Telegram bot is not ready',
      requestedBy,
      recipientCount: 0,
      sent: 0,
      failed: 0,
    };
  }

  const recipients = await listClientDailyReportRecipients();
  if (!recipients.length) {
    return {
      ok: true,
      requestedBy,
      recipientCount: 0,
      sent: 0,
      failed: 0,
      skipped: true,
    };
  }

  let sent = 0;
  let failed = 0;
  let skippedNoApplications = 0;
  const errors = [];

  for (const recipient of recipients) {
    try {
      const rows = await fetchClientDailyReportRows(recipient.userId, { since });
      const appliedCount = rows.length;
      if (appliedCount <= 0) {
        skippedNoApplications += 1;
        continue;
      }
      const text = formatClientDailyReportMessage({
        firstName: firstNameFromUser(recipient),
        language: recipient.language,
        appliedCount,
        rows,
      });
      const replyMarkup = buildClientDailyReportReplyMarkup(recipient.language);
      if (!dryRun) {
        await telegram.sendMessage(recipient.chatId, text, replyMarkup ? { reply_markup: replyMarkup } : undefined);
      }
      sent += 1;
    } catch (err) {
      failed += 1;
      if (errors.length < 10) {
        errors.push({
          userId: recipient.userId,
          chatId: recipient.chatId,
          error: err?.message || String(err),
        });
      }
    }
  }

  return {
    ok: failed === 0,
    requestedBy,
    recipientCount: recipients.length,
    sent,
    failed,
    skippedNoApplications,
    errors,
  };
}
