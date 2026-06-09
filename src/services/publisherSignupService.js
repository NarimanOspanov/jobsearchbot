import { Op } from 'sequelize';
import { models } from '../db.js';
import { runtimeBot } from '../bot/state.js';

function trackedSignupWhere(publisherUserId, extra = {}) {
  return {
    Publisher: publisherUserId,
    PublishedIn: { [Op.ne]: null },
    ...extra,
  };
}

/**
 * Persist publisher attribution for a brand-new user who arrived via tracked apply link.
 */
export async function recordTrackedPublisherSignup({
  user,
  positionId,
  publisherUserId,
  publishedInChatId,
  startPayload = '',
} = {}) {
  if (!models.PublisherSignups) {
    return { created: false, row: null };
  }

  const userId = Number(user?.Id);
  const publisherId = Number(publisherUserId);
  const resourceChatId = Number(publishedInChatId);
  const posId = String(positionId || '').trim().toLowerCase();
  const payload = String(startPayload || '').trim().slice(0, 64);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { created: false, row: null };
  }
  if (!Number.isSafeInteger(publisherId) || publisherId <= 0) {
    return { created: false, row: null };
  }
  if (!Number.isSafeInteger(resourceChatId) || resourceChatId === 0) {
    return { created: false, row: null };
  }
  if (!posId) {
    return { created: false, row: null };
  }

  try {
    const [row, created] = await models.PublisherSignups.findOrCreate({
      where: { UserId: userId },
      defaults: {
        UserId: userId,
        Publisher: publisherId,
        PublishedIn: resourceChatId,
        PositionId: posId,
        StartPayload: payload || null,
        SignedUpAt: new Date(),
      },
    });
    return { created, row };
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const existing = await models.PublisherSignups.findOne({ where: { UserId: userId } });
      return { created: false, row: existing };
    }
    throw err;
  }
}

/**
 * Notify job poster (publisher) about a new user signup via their tracked link.
 */
export async function notifyPublisherOfNewSignup({
  telegram,
  signupUser,
  positionId,
  publisherUserId,
  publishedInChatId,
}) {
  const bot = telegram || runtimeBot.telegram;
  const publisherId = Number(publisherUserId);
  const resourceChatId = Number(publishedInChatId);
  const posId = String(positionId || '').trim().toLowerCase();
  if (!bot) {
    console.warn('notifyPublisherOfNewSignup skipped: telegram not available');
    return;
  }
  if (!models.PublisherSignups) {
    console.warn('notifyPublisherOfNewSignup skipped: PublisherSignups model missing');
    return;
  }
  if (!Number.isSafeInteger(publisherId) || publisherId <= 0) {
    console.warn('notifyPublisherOfNewSignup skipped: invalid publisherUserId', publisherId);
    return;
  }
  if (!Number.isSafeInteger(resourceChatId) || resourceChatId === 0) {
    console.warn('notifyPublisherOfNewSignup skipped: invalid publishedInChatId', resourceChatId);
    return;
  }
  if (!posId) {
    console.warn('notifyPublisherOfNewSignup skipped: missing positionId');
    return;
  }

  const signupChatId = Number(signupUser?.TelegramChatId);
  if (!Number.isSafeInteger(signupChatId) || signupChatId <= 0) {
    console.warn('notifyPublisherOfNewSignup skipped: invalid signup chat id');
    return;
  }

  const [publisher, position] = await Promise.all([
    models.Users.findByPk(publisherId, { attributes: ['Id', 'TelegramChatId'] }),
    models.Positions?.findByPk(posId, { attributes: ['Id', 'Title', 'CompanyName'] }),
  ]);

  const publisherChatId = Number(publisher?.TelegramChatId);
  if (!Number.isSafeInteger(publisherChatId) || publisherChatId <= 0) {
    console.warn('notifyPublisherOfNewSignup skipped: publisher has no TelegramChatId', {
      publisherId,
    });
    return;
  }
  if (publisherChatId === signupChatId) {
    console.warn('notifyPublisherOfNewSignup skipped: publisher is the signup user', {
      publisherChatId,
    });
    return;
  }

  const positionLabel = (() => {
    const title = String(position?.Title || '').trim();
    const company = String(position?.CompanyName || '').trim();
    if (title && company) return `${title} (${company})`;
    return title || company || posId;
  })();

  const [positionLinkCount, overallCount] = await Promise.all([
    models.PublisherSignups.count({
      where: trackedSignupWhere(publisherId, {
        PositionId: posId,
        PublishedIn: resourceChatId,
      }),
    }),
    models.PublisherSignups.count({
      where: trackedSignupWhere(publisherId),
    }),
  ]);

  const lines = [
    'New signup',
    '',
    `user: ${signupChatId}`,
    `position: ${positionLabel}`,
    `resource: ${resourceChatId}`,
    `number of signups for your position link: ${positionLinkCount}`,
    `overall number of signups from your links: ${overallCount}`,
  ];

  try {
    await bot.sendMessage(publisherChatId, lines.join('\n'));
    console.log('notifyPublisherOfNewSignup sent', {
      publisherChatId,
      publisherId,
      positionId: posId,
    });
  } catch (err) {
    console.warn('notifyPublisherOfNewSignup failed:', err?.message || err, {
      publisherChatId,
      publisherId,
    });
  }
}
