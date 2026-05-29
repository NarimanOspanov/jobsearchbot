import { Op } from 'sequelize';
import { config, parseCommaSeparatedIdSet } from '../config.js';
import { models } from '../db.js';
import { getConfigInt } from './planService.js';
import { t } from '../i18n/botI18n.js';
import { normalizeUserLanguage } from '../utils/userLanguage.js';

export const USER_APPLICATION_STATUS = {
  PENDING_SCREENING: 'pending_screening',
  DOES_NOT_MATCH: 'does_not_match',
};

export const OUTREACH_MESSAGE_TYPES = {
  SCREENING_ACK: 'screening_ack',
  REJECTION_DEFAULT: 'rejection_default',
};

const CONFIG_KEY_SCREENING_MIN = 'PositionApplyScreeningResponseMin';
const DEFAULT_SCREENING_MINUTES = 4320;
const MAX_SCREENING_MINUTES = 30 * 24 * 60;

export async function getPositionApplyScreeningResponseMinutes() {
  const minutes = await getConfigInt(CONFIG_KEY_SCREENING_MIN, DEFAULT_SCREENING_MINUTES);
  return Math.min(MAX_SCREENING_MINUTES, Math.max(1, minutes));
}

/**
 * @param {string | string[] | Set<number> | null | undefined} override
 * @returns {Set<number> | null} null = no filter (all chat ids)
 */
export function getRejectionNotificationChatIdFilter(override = undefined) {
  if (override !== undefined) {
    if (override == null) return null;
    if (override instanceof Set) {
      return override.size > 0 ? override : null;
    }
    if (Array.isArray(override)) {
      const set = new Set();
      for (const item of override) {
        const n = Number.parseInt(String(item).trim(), 10);
        if (Number.isSafeInteger(n) && n > 0) set.add(n);
      }
      return set.size > 0 ? set : null;
    }
    const set = parseCommaSeparatedIdSet(String(override));
    return set.size > 0 ? set : null;
  }
  const fromEnv = config.rejectionNotificationChatIds;
  return fromEnv.size > 0 ? fromEnv : null;
}

export function rejectionNotificationChatIdsForResult(allowlist) {
  return allowlist ? Array.from(allowlist).sort((a, b) => a - b) : null;
}

export function formatScreeningResponseWindow(lang, minutes) {
  const total = Math.max(1, Math.round(Number(minutes) || 1));
  const locale = normalizeUserLanguage(lang);
  if (total < 60) {
    if (locale === 'ru') {
      const mod10 = total % 10;
      const mod100 = total % 100;
      const word =
        mod10 === 1 && mod100 !== 11
          ? 'минуту'
          : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
            ? 'минуты'
            : 'минут';
      return `${total} ${word}`;
    }
    return `${total} minute${total === 1 ? '' : 's'}`;
  }
  if (total < 24 * 60) {
    const hours = Math.max(1, Math.ceil(total / 60));
    if (locale === 'ru') {
      const mod10 = hours % 10;
      const mod100 = hours % 100;
      const word =
        mod10 === 1 && mod100 !== 11
          ? 'час'
          : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
            ? 'часа'
            : 'часов';
      return `${hours} ${word}`;
    }
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.max(1, Math.ceil(total / (24 * 60)));
  if (locale === 'ru') {
    const mod10 = days % 10;
    const mod100 = days % 100;
    const word =
      mod10 === 1 && mod100 !== 11
        ? 'день'
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
          ? 'дня'
          : 'дней';
    return `${days} ${word}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function computeScreeningResponseDueAt(fromDate = new Date(), minutes = null) {
  const n = Number.isSafeInteger(minutes) && minutes > 0 ? minutes : 4320;
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  return new Date(base.getTime() + n * 60 * 1000);
}

export function resolveApplicantLanguage(user, telegramLanguageCode = null) {
  const fromUser = normalizeUserLanguage(user?.Language);
  if (user?.Language) return fromUser;
  if (telegramLanguageCode) {
    const fromTelegram = String(telegramLanguageCode || '').trim().toLowerCase();
    if (fromTelegram === 'ru' || fromTelegram.startsWith('ru-')) return 'ru';
  }
  return fromUser;
}

export function buildOpenJobsReplyMarkup(lang, { seekerJobsUrl, canUseSeekerJobsWebApp }) {
  const button = canUseSeekerJobsWebApp
    ? { text: t(lang, 'btn_jobsearch'), web_app: { url: seekerJobsUrl } }
    : { text: t(lang, 'btn_jobsearch'), callback_data: 'start_open_jobsearch' };
  return { inline_keyboard: [[button]] };
}

export async function buildScreeningAckText(lang) {
  const minutes = await getPositionApplyScreeningResponseMinutes();
  const responseWindow = formatScreeningResponseWindow(lang, minutes);
  return t(lang, 'position_apply_screening_received', { responseWindow });
}

export function buildRejectionText(lang) {
  return t(lang, 'position_apply_rejection_default');
}

export async function recordUserApplicationOutreach({
  userApplicationId,
  userId,
  messageType,
  language,
  text,
  replyMarkup,
  status,
  error = null,
  telegramMessageId = null,
  sentAt = null,
}) {
  if (!models.UserApplicationOutreach) return null;
  try {
    return await models.UserApplicationOutreach.create({
      UserApplicationId: userApplicationId,
      UserId: userId,
      MessageType: messageType,
      Language: normalizeUserLanguage(language),
      Text: String(text || '').slice(0, 4000),
      ReplyMarkupJson: replyMarkup ? JSON.stringify(replyMarkup) : null,
      Status: status,
      Error: error ? String(error).slice(0, 500) : null,
      TelegramMessageId: telegramMessageId != null ? Number(telegramMessageId) : null,
      SentAt: sentAt || (status === 'sent' ? new Date() : null),
      CreatedAt: new Date(),
    });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') return null;
    throw err;
  }
}

/**
 * @param {object} opts
 * @param {import('telegraf').Telegram} opts.telegram
 * @param {object} opts.applicantUser - Users row
 * @param {number} opts.userApplicationId
 * @param {string} [opts.telegramLanguageCode]
 * @param {{ seekerJobsUrl: string, canUseSeekerJobsWebApp: boolean }} opts.jobsUi
 */
export async function sendScreeningAcknowledgment({
  telegram,
  applicantUser,
  userApplicationId,
  telegramLanguageCode = null,
  jobsUi = null,
}) {
  if (!telegram || !applicantUser) return { ok: false, skipped: true };

  const chatId = Number(applicantUser.TelegramChatId);
  if (!Number.isSafeInteger(chatId) || chatId <= 0) return { ok: false, skipped: true };

  const lang = resolveApplicantLanguage(applicantUser, telegramLanguageCode);
  const text = await buildScreeningAckText(lang);

  try {
    const sent = await telegram.sendMessage(chatId, text);
    await recordUserApplicationOutreach({
      userApplicationId,
      userId: applicantUser.Id,
      messageType: OUTREACH_MESSAGE_TYPES.SCREENING_ACK,
      language: lang,
      text,
      replyMarkup: null,
      status: 'sent',
      telegramMessageId: sent?.message_id ?? null,
      sentAt: new Date(),
    });
    return { ok: true };
  } catch (err) {
    await recordUserApplicationOutreach({
      userApplicationId,
      userId: applicantUser.Id,
      messageType: OUTREACH_MESSAGE_TYPES.SCREENING_ACK,
      language: lang,
      text,
      replyMarkup: null,
      status: 'failed',
      error: err?.message || String(err),
    });
    console.warn('sendScreeningAcknowledgment failed:', err?.message || err);
    return { ok: false, error: err };
  }
}

/**
 * @param {object} opts
 * @param {import('telegraf').Telegram} opts.telegram
 * @param {number} [opts.limit]
 * @param {string | string[] | null} [opts.rejectionNotificationIds] — TelegramChatId allowlist; env default if omitted
 * @param {{ seekerJobsUrl: string, canUseSeekerJobsWebApp: boolean }} opts.jobsUi
 */
export async function processDueScreeningResponses({
  telegram,
  limit = 50,
  jobsUi,
  rejectionNotificationIds = undefined,
}) {
  const chatIdAllowlist = getRejectionNotificationChatIdFilter(rejectionNotificationIds);
  const result = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    filtered: 0,
    rejectionNotificationChatIds: rejectionNotificationChatIdsForResult(chatIdAllowlist),
  };
  if (!telegram || !models.UserApplications) return result;

  const where = {
    Status: USER_APPLICATION_STATUS.PENDING_SCREENING,
    ScreeningResponseDueAt: { [Op.lte]: new Date() },
  };

  if (chatIdAllowlist) {
    const allowedUsers = await models.Users.findAll({
      where: { TelegramChatId: { [Op.in]: Array.from(chatIdAllowlist) } },
      attributes: ['Id'],
      raw: true,
    });
    const allowedUserIds = allowedUsers
      .map((row) => Number(row.Id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (allowedUserIds.length === 0) return result;
    where.UserId = { [Op.in]: allowedUserIds };
  }

  const rows = await models.UserApplications.findAll({
    where,
    order: [['ScreeningResponseDueAt', 'ASC'], ['Id', 'ASC']],
    limit: Math.min(200, Math.max(1, Number(limit) || 50)),
  });

  for (const row of rows) {
    result.processed += 1;

    if (models.UserApplicationOutreach) {
      const existing = await models.UserApplicationOutreach.findOne({
        where: {
          UserApplicationId: row.Id,
          MessageType: OUTREACH_MESSAGE_TYPES.REJECTION_DEFAULT,
        },
        attributes: ['Id'],
      });
      if (existing) {
        result.skipped += 1;
        if (row.Status === USER_APPLICATION_STATUS.PENDING_SCREENING) {
          await row.update({ Status: USER_APPLICATION_STATUS.DOES_NOT_MATCH });
        }
        continue;
      }
    }

    const applicant = await models.Users.findByPk(row.UserId, {
      attributes: ['Id', 'TelegramChatId', 'Language'],
    });
    const chatId = Number(applicant?.TelegramChatId);
    if (!applicant || !Number.isSafeInteger(chatId) || chatId <= 0) {
      result.failed += 1;
      await recordUserApplicationOutreach({
        userApplicationId: row.Id,
        userId: row.UserId,
        messageType: OUTREACH_MESSAGE_TYPES.REJECTION_DEFAULT,
        language: 'en',
        text: '',
        replyMarkup: null,
        status: 'failed',
        error: 'Applicant TelegramChatId missing',
      });
      continue;
    }

    const lang = resolveApplicantLanguage(applicant);
    const text = buildRejectionText(lang);
    const replyMarkup =
      jobsUi?.seekerJobsUrl != null
        ? buildOpenJobsReplyMarkup(lang, jobsUi)
        : null;

    try {
      const sent = await telegram.sendMessage(chatId, text, {
        reply_markup: replyMarkup || undefined,
      });
      await row.update({ Status: USER_APPLICATION_STATUS.DOES_NOT_MATCH });
      await recordUserApplicationOutreach({
        userApplicationId: row.Id,
        userId: row.UserId,
        messageType: OUTREACH_MESSAGE_TYPES.REJECTION_DEFAULT,
        language: lang,
        text,
        replyMarkup,
        status: 'sent',
        telegramMessageId: sent?.message_id ?? null,
        sentAt: new Date(),
      });
      result.sent += 1;
    } catch (err) {
      await recordUserApplicationOutreach({
        userApplicationId: row.Id,
        userId: row.UserId,
        messageType: OUTREACH_MESSAGE_TYPES.REJECTION_DEFAULT,
        language: lang,
        text,
        replyMarkup,
        status: 'failed',
        error: err?.message || String(err),
      });
      result.failed += 1;
      console.warn('processDueScreeningResponses send failed:', row.Id, err?.message || err);
    }
  }

  return result;
}

export async function listUserApplicationOutreach({ limit = 100, offset = 0 } = {}) {
  if (!models.UserApplicationOutreach) return { rows: [], total: 0 };
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const { rows, count } = await models.UserApplicationOutreach.findAndCountAll({
    order: [['CreatedAt', 'DESC'], ['Id', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  });
  return {
    total: count,
    rows: rows.map((r) => ({
      id: r.Id,
      userApplicationId: r.UserApplicationId,
      userId: r.UserId,
      messageType: r.MessageType,
      language: r.Language,
      text: r.Text,
      status: r.Status,
      error: r.Error,
      telegramMessageId: r.TelegramMessageId != null ? String(r.TelegramMessageId) : null,
      sentAt: r.SentAt,
      createdAt: r.CreatedAt,
    })),
  };
}
