import { Op } from 'sequelize';
import { models } from '../db.js';
import { getMissingRequiredChannelsForUser } from './channelService.js';
import { runtimeBot } from '../bot/state.js';

const LIVE_CHECK_CONCURRENCY = 8;

function buildUserLabel(user) {
  const firstName = String(user?.FirstName || '').trim();
  const lastName = String(user?.LastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const username = String(user?.TelegramUserName || '').trim();
  if (fullName && username) return `${fullName} (@${username})`;
  if (fullName) return fullName;
  if (username) return `@${username}`;
  return `User #${user?.Id ?? '-'}`;
}

function conversionRate(liveMembers, signups) {
  const total = Number(signups) || 0;
  const live = Number(liveMembers) || 0;
  if (total <= 0) return 0;
  return Math.round((live / total) * 1000) / 10;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const results = new Array(list.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

export async function getActiveRequiredChannels() {
  if (!models.RequiredChannels) return [];
  const rows = await models.RequiredChannels.findAll({
    where: { IsActive: true },
    order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
    attributes: ['ChannelId', 'JoinUrl'],
  });
  return rows.map((row) => ({
    channelId: String(row.ChannelId || ''),
    joinUrl: String(row.JoinUrl || ''),
  }));
}

export async function isLiveMemberOfAllRequiredChannels(telegram, telegramChatId) {
  const chatId = Number(telegramChatId);
  if (!Number.isSafeInteger(chatId) || chatId <= 0) return false;
  const bot = telegram || runtimeBot.telegram;
  if (!bot) return false;
  const activeChannels = await getActiveRequiredChannels();
  if (!activeChannels.length) return true;
  const missing = await getMissingRequiredChannelsForUser(bot, chatId);
  return missing.length === 0;
}

async function loadPublisherCohortRows(since) {
  if (!models.PublisherSignups) return [];
  return models.PublisherSignups.findAll({
    where: { SignedUpAt: { [Op.gte]: since } },
    include: models.Users
      ? [
          {
            model: models.Users,
            attributes: ['Id', 'TelegramChatId', 'FirstName', 'LastName', 'TelegramUserName'],
            required: true,
          },
        ]
      : [],
    order: [['SignedUpAt', 'DESC']],
  });
}

async function loadCampaignCohortRows(since) {
  if (!models.CampaignSignups) return [];
  return models.CampaignSignups.findAll({
    where: { SignedUpAt: { [Op.gte]: since } },
    include: models.Users
      ? [
          {
            model: models.Users,
            attributes: ['Id', 'TelegramChatId', 'FirstName', 'LastName', 'TelegramUserName'],
            required: true,
          },
        ]
      : [],
    order: [['SignedUpAt', 'DESC']],
  });
}

function normalizeCohortEntry({ sourceType, sourceLabel, sourceKey, signedUpAt, user, publisherUserId, publishedInChatId, campaignSlug }) {
  return {
    userId: Number(user?.Id),
    telegramChatId: Number(user?.TelegramChatId),
    displayName: buildUserLabel(user),
    sourceType,
    sourceLabel,
    sourceKey,
    signedUpAt: signedUpAt || null,
    publisherUserId: publisherUserId ?? null,
    publishedInChatId: publishedInChatId ?? null,
    campaignSlug: campaignSlug ?? null,
    isLiveMember: false,
  };
}

export async function buildConversionStats({ since, telegram = null, maxChecks = 500 } = {}) {
  const bot = telegram || runtimeBot.telegram;
  const checkedAt = new Date();
  const activeChannels = await getActiveRequiredChannels();
  const activeChannelCount = activeChannels.length;
  const checkLimit = Math.min(5000, Math.max(1, Number.parseInt(String(maxChecks || '500'), 10) || 500));

  const [publisherRows, campaignRows] = await Promise.all([
    loadPublisherCohortRows(since),
    loadCampaignCohortRows(since),
  ]);

  const publisherIds = [
    ...new Set(
      publisherRows
        .map((row) => Number(row.Publisher))
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    ),
  ];
  const publisherUsers =
    publisherIds.length && models.Users
      ? await models.Users.findAll({
          attributes: ['Id', 'FirstName', 'LastName', 'TelegramUserName'],
          where: { Id: { [Op.in]: publisherIds } },
        })
      : [];
  const publisherNameById = new Map(publisherUsers.map((u) => [Number(u.Id), buildUserLabel(u)]));

  const cohort = [
    ...publisherRows.map((row) => {
      const user = row.User || row.Users;
      const publisherUserId = Number(row.Publisher);
      return normalizeCohortEntry({
        sourceType: 'publisher',
        sourceLabel: publisherNameById.get(publisherUserId) || `Publisher #${publisherUserId}`,
        sourceKey: `publisher:${publisherUserId}`,
        signedUpAt: row.SignedUpAt,
        user,
        publisherUserId,
        publishedInChatId: Number(row.PublishedIn),
      });
    }),
    ...campaignRows.map((row) => {
      const user = row.User || row.Users;
      const campaignSlug = String(row.CampaignSlug || '').trim();
      return normalizeCohortEntry({
        sourceType: 'campaign',
        sourceLabel: `ref_${campaignSlug}`,
        sourceKey: `campaign:${campaignSlug}`,
        signedUpAt: row.SignedUpAt,
        user,
        campaignSlug,
      });
    }),
  ].sort((a, b) => new Date(b.signedUpAt).getTime() - new Date(a.signedUpAt).getTime());

  const truncated = cohort.length > checkLimit;
  const toCheck = truncated ? cohort.slice(0, checkLimit) : cohort;

  if (bot && activeChannelCount > 0) {
    await mapWithConcurrency(toCheck, LIVE_CHECK_CONCURRENCY, async (entry) => {
      entry.isLiveMember = await isLiveMemberOfAllRequiredChannels(bot, entry.telegramChatId);
    });
  } else if (activeChannelCount === 0) {
    for (const entry of toCheck) entry.isLiveMember = true;
  }

  const byPublisherMap = new Map();
  const byCampaignMap = new Map();

  for (const entry of toCheck) {
    if (entry.sourceType === 'publisher') {
      const key = String(entry.publisherUserId);
      const bucket = byPublisherMap.get(key) || {
        publisherUserId: entry.publisherUserId,
        publisherName: entry.sourceLabel,
        signups: 0,
        liveMembers: 0,
        conversionRate: 0,
      };
      bucket.signups += 1;
      if (entry.isLiveMember) bucket.liveMembers += 1;
      byPublisherMap.set(key, bucket);
    } else if (entry.sourceType === 'campaign') {
      const key = String(entry.campaignSlug);
      const bucket = byCampaignMap.get(key) || {
        campaignSlug: entry.campaignSlug,
        signups: 0,
        liveMembers: 0,
        conversionRate: 0,
      };
      bucket.signups += 1;
      if (entry.isLiveMember) bucket.liveMembers += 1;
      byCampaignMap.set(key, bucket);
    }
  }

  const byPublisher = [...byPublisherMap.values()]
    .map((row) => ({
      ...row,
      conversionRate: conversionRate(row.liveMembers, row.signups),
    }))
    .sort((a, b) => b.signups - a.signups || b.liveMembers - a.liveMembers);

  const byCampaign = [...byCampaignMap.values()]
    .map((row) => ({
      ...row,
      conversionRate: conversionRate(row.liveMembers, row.signups),
    }))
    .sort((a, b) => b.signups - a.signups || b.liveMembers - a.liveMembers);

  const publisherChecked = toCheck.filter((e) => e.sourceType === 'publisher');
  const campaignChecked = toCheck.filter((e) => e.sourceType === 'campaign');
  const publisherSignups = publisherRows.length;
  const campaignSignups = campaignRows.length;
  const publisherLiveMembers = publisherChecked.filter((e) => e.isLiveMember).length;
  const campaignLiveMembers = campaignChecked.filter((e) => e.isLiveMember).length;

  return {
    checkedAt: checkedAt.toISOString(),
    activeChannelCount,
    activeChannels,
    truncated,
    maxChecks: checkLimit,
    checkedCount: toCheck.length,
    totals: {
      publisherSignups,
      publisherLiveMembers,
      publisherConversionRate: conversionRate(publisherLiveMembers, publisherChecked.length),
      campaignSignups,
      campaignLiveMembers,
      campaignConversionRate: conversionRate(campaignLiveMembers, campaignChecked.length),
    },
    byPublisher,
    byCampaign,
    recent: toCheck.map((entry) => ({
      userId: entry.userId,
      displayName: entry.displayName,
      sourceType: entry.sourceType,
      sourceLabel: entry.sourceLabel,
      signedUpAt: entry.signedUpAt,
      isLiveMember: entry.isLiveMember,
      publisherUserId: entry.publisherUserId,
      publishedInChatId: entry.publishedInChatId,
      campaignSlug: entry.campaignSlug,
    })),
  };
}
