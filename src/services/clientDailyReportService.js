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

function parseApplyPriorityJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function metaApplyUrl(meta) {
  if (!meta || typeof meta !== 'object') return '';
  return String(meta.applyUrl || meta.applyURL || '').trim();
}

async function enrichClientDailyReportRows(mappedRows) {
  if (!Array.isArray(mappedRows) || !mappedRows.length) return [];

  const rowsNeedingPositionUrl = mappedRows.filter((row) => {
    if (metaApplyUrl(row.meta)) return false;
    const positionId = Number.parseInt(String(row.meta?.positionId ?? row.screenlyJobId ?? ''), 10);
    return Number.isSafeInteger(positionId) && positionId > 0;
  });

  const urlByPositionId = new Map();
  if (rowsNeedingPositionUrl.length && models.Positions) {
    const positionIds = [
      ...new Set(
        rowsNeedingPositionUrl.map((row) =>
          Number.parseInt(String(row.meta?.positionId ?? row.screenlyJobId ?? ''), 10)
        )
      ),
    ];
    const positions = await models.Positions.findAll({
      where: { Id: positionIds },
      attributes: ['Id', 'ExternalApplyURL'],
    });
    for (const position of positions) {
      const url = String(position.ExternalApplyURL || '').trim();
      if (url) urlByPositionId.set(position.Id, url);
    }
  }

  return mappedRows.map((row) => {
    const existingUrl = metaApplyUrl(row.meta);
    if (existingUrl) {
      return { ...row, applyUrl: existingUrl };
    }
    const positionId = Number.parseInt(String(row.meta?.positionId ?? row.screenlyJobId ?? ''), 10);
    const fallbackUrl = urlByPositionId.get(positionId) || '';
    if (!fallbackUrl) {
      return { ...row, applyUrl: null };
    }
    return {
      ...row,
      applyUrl: fallbackUrl,
      meta: { ...(row.meta || {}), applyUrl: fallbackUrl },
    };
  });
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

export async function listClientDailyReportRecipients(options = {}) {
  const forceTestChatId = Number.parseInt(String(options.forceTestChatId || ''), 10);
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
    const fromOptions =
      Number.isSafeInteger(forceTestChatId) && forceTestChatId > 0 ? forceTestChatId : 0;
    const chatId = fromOptions || Number(config.clientDailyReportTestChatId || 0);
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

  const mappedRows = rows.map((row) => {
    const data = row.toJSON ? row.toJSON() : row;
    const meta = parseMetaJson(data.MetaJson);
    const applyPriority = parseApplyPriorityJson(data.ApplyPriorityJson);
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
      applyPriority: applyPriority || null,
      applyPriorityJson: applyPriority || null,
    };
  });

  return enrichClientDailyReportRows(mappedRows);
}

function displayNameFromUser(user) {
  const first = String(user?.FirstName || '').trim();
  const last = String(user?.LastName || '').trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || String(user?.TelegramUserName || '').trim() || `#${user?.Id || '?'}`;
}

function formatAppliedDay(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function buildDateKeys(since, until = new Date()) {
  const keys = [];
  const d = new Date(since);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(until);
  end.setUTCHours(0, 0, 0, 0);
  while (d <= end) {
    keys.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return keys;
}

export async function fetchMentorClientApplicationChart(clientUserIds, { since } = {}) {
  const ids = [
    ...new Set(
      (Array.isArray(clientUserIds) ? clientUserIds : [])
        .map((id) => Number.parseInt(String(id), 10))
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    ),
  ];
  const fromDate = since instanceof Date ? since : new Date(Date.now() - DAY_MS);
  const dates = buildDateKeys(fromDate);
  if (!ids.length) return { dates, series: [] };

  const rows = await sequelize.query(
    `SELECT
       a.UserId AS clientUserId,
       CAST(a.AppliedAt AS DATE) AS appliedDate,
       COUNT(*) AS appliedCount
     FROM dbo.Applications AS a
     WHERE a.UserId IN (:clientUserIds)
       AND a.AppliedAt >= :since
       AND LOWER(a.Status) = 'applied'
     GROUP BY a.UserId, CAST(a.AppliedAt AS DATE)
     ORDER BY CAST(a.AppliedAt AS DATE) ASC`,
    {
      replacements: { clientUserIds: ids, since: fromDate },
      type: Sequelize.QueryTypes.SELECT,
    }
  );

  const countByClientDate = new Map();
  for (const row of rows) {
    const clientId = Number(row.clientUserId);
    const day = formatAppliedDay(row.appliedDate);
    if (!clientId || !day) continue;
    countByClientDate.set(`${clientId}:${day}`, Number(row.appliedCount) || 0);
  }

  const users = await models.Users.findAll({ where: { Id: ids } });
  const userById = new Map(users.map((u) => [u.Id, u]));

  const series = ids.map((clientUserId) => {
    const user = userById.get(clientUserId);
    const counts = dates.map((day) => countByClientDate.get(`${clientUserId}:${day}`) || 0);
    return {
      clientUserId,
      clientName: user ? displayNameFromUser(user) : `#${clientUserId}`,
      counts,
    };
  });

  return { dates, series };
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

  const recipients = await listClientDailyReportRecipients({
    forceTestChatId: options.forceTestChatId,
  });
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
