import { Sequelize } from 'sequelize';
import { models, sequelize } from '../db.js';
import { config } from '../config.js';
import { runtimeBot } from '../bot/state.js';
import { buildAgentPerformanceStats } from './agentPerformanceStatsService.js';
import { resolveGlobalEasyApplyAgentUserIds } from './agentAccessService.js';
import { normalizeChatId } from '../utils/helpers.js';

const DIGEST_PERIODS = [
  { label: 'Last 24 hours', hours: 24 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
];

function sinceForPeriod(period) {
  if (period.hours) {
    return new Date(Date.now() - period.hours * 60 * 60 * 1000);
  }
  const days = Number(period.days || 7);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** @param {Awaited<ReturnType<typeof buildAgentPerformanceStats>>} stats */
function formatLeaderboardSection(label, stats) {
  const lines = (stats?.byAgent || [])
    .filter((row) => Number(row.appliedCount || 0) > 0)
    .map((row) => `  ${row.agentName} — ${Number(row.appliedCount || 0)} applications`);
  const body = lines.length ? lines.join('\n') : '  (no applications)';
  return `${label}\n${body}`;
}

/** @param {Array<{ label: string, stats: Awaited<ReturnType<typeof buildAgentPerformanceStats>> }>} sections */
export function formatAgentPerformanceDigestMessage(sections) {
  const parts = ['Agent performance', ''];
  for (const section of sections) {
    parts.push(formatLeaderboardSection(section.label, section.stats));
    parts.push('');
  }
  return parts.join('\n').trim();
}

export async function buildAgentPerformanceDigestSections() {
  const sections = [];
  for (const period of DIGEST_PERIODS) {
    const stats = await buildAgentPerformanceStats({
      since: sinceForPeriod(period),
      agentUserId: null,
    });
    sections.push({ label: period.label, stats });
  }
  return sections;
}

export async function buildAgentPerformanceDigestMessage() {
  const sections = await buildAgentPerformanceDigestSections();
  return formatAgentPerformanceDigestMessage(sections);
}

/** @returns {Promise<number[]>} Telegram chat ids */
export async function listAgentPerformanceDigestRecipientChatIds() {
  const chatIds = new Set();

  for (const adminId of config.botAdminTelegramIds) {
    const chatId = normalizeChatId(adminId);
    if (chatId != null) chatIds.add(Number(chatId));
  }

  if (models.AgentClients && models.Users) {
    const rows = await sequelize.query(
      `SELECT DISTINCT u.TelegramChatId AS telegramChatId
       FROM dbo.AgentClients AS ac
       INNER JOIN dbo.Users AS u ON u.Id = ac.AgentUserId
       WHERE u.TelegramChatId IS NOT NULL
         AND ISNULL(u.IsBlocked, 0) = 0`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    for (const row of rows || []) {
      const chatId = normalizeChatId(row.telegramChatId);
      if (chatId != null) chatIds.add(Number(chatId));
    }

    const globalEasyApplyUserIds = await resolveGlobalEasyApplyAgentUserIds();
    if (globalEasyApplyUserIds.length) {
      const easyApplyUsers = await models.Users.findAll({
        attributes: ['TelegramChatId'],
        where: {
          Id: { [Sequelize.Op.in]: globalEasyApplyUserIds },
          TelegramChatId: { [Sequelize.Op.not]: null },
          [Sequelize.Op.or]: [{ IsBlocked: false }, { IsBlocked: null }],
        },
      });
      for (const user of easyApplyUsers) {
        const chatId = normalizeChatId(user.TelegramChatId);
        if (chatId != null) chatIds.add(Number(chatId));
      }
    }
  }

  return [...chatIds];
}

/**
 * @param {{ requestedBy?: string, dryRun?: boolean }} [options]
 */
export async function sendAgentPerformanceDigest(options = {}) {
  const requestedBy = String(options.requestedBy || 'manual').trim() || 'manual';
  const dryRun = Boolean(options.dryRun);
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

  const [message, recipientChatIds] = await Promise.all([
    buildAgentPerformanceDigestMessage(),
    listAgentPerformanceDigestRecipientChatIds(),
  ]);

  if (!recipientChatIds.length) {
    return {
      ok: true,
      requestedBy,
      recipientCount: 0,
      sent: 0,
      failed: 0,
      skipped: true,
      messagePreview: message.slice(0, 500),
    };
  }

  if (dryRun) {
    return {
      ok: true,
      requestedBy,
      dryRun: true,
      recipientCount: recipientChatIds.length,
      sent: 0,
      failed: 0,
      messagePreview: message.slice(0, 500),
    };
  }

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const chatId of recipientChatIds) {
    try {
      await telegram.sendMessage(chatId, message);
      sent += 1;
    } catch (err) {
      failed += 1;
      if (errors.length < 5) {
        errors.push({ chatId, error: err?.message || String(err) });
      }
    }
  }

  return {
    ok: failed === 0,
    requestedBy,
    recipientCount: recipientChatIds.length,
    sent,
    failed,
    errors,
    messagePreview: message.slice(0, 500),
  };
}
