import { models } from '../db.js';
import { normalizeChatId } from '../utils/helpers.js';
import { runtimeBot } from '../bot/state.js';

export async function getMissingRequiredChannelsForUser(telegram, telegramUserId) {
  if (!telegram || !telegramUserId || !models.RequiredChannels) return [];
  const channels = await models.RequiredChannels.findAll({
    where: { IsActive: true },
    order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
  });
  if (!channels || channels.length === 0) return [];

  const okStatuses = new Set(['member', 'administrator', 'creator']);
  const missing = [];
  for (const ch of channels) {
    const chatId = normalizeChatId(ch.ChannelId);
    if (!chatId) {
      missing.push(ch);
      continue;
    }
    try {
      const member = await telegram.getChatMember(chatId, telegramUserId);
      if (!okStatuses.has(member?.status)) {
        missing.push(ch);
        continue;
      }
    } catch (err) {
      console.warn('getChatMember check error:', ch.ChannelId, err?.message || err);
      missing.push(ch);
    }
  }
  return missing;
}

export async function ensureRequiredChannelUserRecords(telegramUserId) {
  if (!telegramUserId || !models.RequiredChannels || !models.RequiredChannelUsers) return;
  const channels = await models.RequiredChannels.findAll({
    where: { IsActive: true },
    order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
  });
  if (!channels || channels.length === 0) return;
  for (const ch of channels) {
    try {
      await models.RequiredChannelUsers.findOrCreate({
        where: { ChannelId: String(ch.ChannelId), UserId: String(telegramUserId) },
        defaults: {
          ChannelId: String(ch.ChannelId),
          UserId: String(telegramUserId),
          DateTime: new Date(),
        },
      });
    } catch (e) {
      if (e?.name !== 'SequelizeUniqueConstraintError') {
        console.warn('RequiredChannelUsers upsert error:', e?.message || e);
      }
    }
  }
}

export function serializeRequiredChannels(channels) {
  const list = Array.isArray(channels) ? channels : [];
  return list.map((ch) => ({
    channelId: String(ch.ChannelId || ''),
    joinUrl: String(ch.JoinUrl || ''),
  }));
}

export async function getRequiredChannelsState(telegramUserId) {
  if (!runtimeBot.telegram) {
    return { ok: false, reason: 'unavailable', channels: [] };
  }
  const missing = await getMissingRequiredChannelsForUser(runtimeBot.telegram, telegramUserId);
  return { ok: missing.length === 0, reason: null, channels: missing };
}
