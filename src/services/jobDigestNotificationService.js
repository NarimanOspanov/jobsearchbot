import { config } from '../config.js';
import { fetchScreenlySkillsCatalog } from './aiService.js';
import { normalizeSkillIds } from './userService.js';
import { resolveBotLanguage } from '../utils/userLanguage.js';
import {
  fetchGlobalRemotePositionCount,
  fetchSkillPositionCounts,
  getRemoteJobsDigestDateRange,
} from './remotePositionsService.js';

const COPY = {
  en: {
    title: 'For last day:',
    positions: (n) => `${n} positions`,
    openAll: 'Open all',
  },
  ru: {
    title: 'За последний день:',
    positions: (n) => `${n} вакансий`,
    openAll: 'Открыть все',
  },
};

function appBaseUrl() {
  return String(process.env.ADMIN_APP_URL || config.webhookUrl || '').replace(/\/$/, '');
}

function copyForLang(lang) {
  return COPY[lang === 'ru' ? 'ru' : 'en'];
}

function buildSeekerJobsWebAppUrl({ from, to, skillIds }) {
  const base = appBaseUrl();
  if (!base) return '';
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (skillIds) params.set('skillIds', skillIds);
  const q = params.toString();
  return `${base}/app/seeker-jobs${q ? `?${q}` : ''}`;
}

function skillNameById(skillsCatalog, skillId) {
  const row = skillsCatalog.find((s) => Number(s.id) === Number(skillId));
  return String(row?.name || row?.Name || skillId).trim() || String(skillId);
}

/**
 * @param {import('../models/User.js').default} user
 * @param {{ totalNoSkills: number, skillCounts: Map<number, number>, skillsCatalog: object[], dateRange: { from: string, to: string } }} ctx
 */
export function buildJobDigestNotificationForUser(user, ctx) {
  const lang = resolveBotLanguage(user?.Language);
  const copy = copyForLang(lang);
  const skillIds = normalizeSkillIds(user?.skills || []);
  const { dateRange, skillCounts, totalNoSkills, skillsCatalog } = ctx;

  let bodyLines = [copy.title, ''];
  let openUrlSkillIds = '';

  if (skillIds.length > 0) {
    const lines = skillIds
      .map((id) => ({ id, name: skillNameById(skillsCatalog, id), count: Number(skillCounts.get(id) || 0) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    for (const row of lines) {
      bodyLines.push(`${row.name} - ${row.count}`);
    }
    openUrlSkillIds = skillIds.join(',');
  } else {
    bodyLines.push(copy.positions(totalNoSkills));
  }

  const text = bodyLines.join('\n').trim();
  const webAppUrl = buildSeekerJobsWebAppUrl({
    from: dateRange.from,
    to: dateRange.to,
    skillIds: openUrlSkillIds,
  });

  const replyMarkup =
    webAppUrl && /^https:\/\//i.test(webAppUrl)
      ? { inline_keyboard: [[{ text: copy.openAll, web_app: { url: webAppUrl } }]] }
      : undefined;

  return {
    text,
    replyMarkupJson: replyMarkup ? JSON.stringify({ reply_markup: replyMarkup }) : null,
  };
}

export async function buildJobDigestNotificationsForUsers(users) {
  const dateRange = getRemoteJobsDigestDateRange();
  const skillsCatalog = await fetchScreenlySkillsCatalog();
  const totalNoSkills = await fetchGlobalRemotePositionCount(dateRange);

  const allSkillIds = [];
  for (const user of users) {
    allSkillIds.push(...normalizeSkillIds(user?.skills || []));
  }
  const skillCounts = await fetchSkillPositionCounts(allSkillIds, dateRange);

  const ctx = { dateRange, skillCounts, totalNoSkills, skillsCatalog };
  return users.map((user) => ({
    user,
    ...buildJobDigestNotificationForUser(user, ctx),
  }));
}
