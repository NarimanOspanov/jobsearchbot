import { Op } from 'sequelize';
import { models } from '../db.js';
import { runtimeBot } from '../bot/state.js';

function trackedApplicationWhere(publisherUserId, extra = {}) {
  return {
    Publisher: publisherUserId,
    PublishedIn: { [Op.ne]: null },
    ...extra,
  };
}

/**
 * Notify job poster (publisher) about a new application via their tracked link.
 * Does not include resume content.
 */
export async function notifyPublisherOfNewApplication({
  telegram,
  applicantUser,
  positionId,
  publisherUserId,
  publishedInChatId,
}) {
  const bot = telegram || runtimeBot.telegram;
  const publisherId = Number(publisherUserId);
  const resourceChatId = Number(publishedInChatId);
  const posId = String(positionId || '').trim().toLowerCase();
  if (!bot) {
    console.warn('notifyPublisherOfNewApplication skipped: telegram not available');
    return;
  }
  if (!models.UserApplications) {
    console.warn('notifyPublisherOfNewApplication skipped: UserApplications model missing');
    return;
  }
  if (!Number.isSafeInteger(publisherId) || publisherId <= 0) {
    console.warn('notifyPublisherOfNewApplication skipped: invalid publisherUserId', publisherId);
    return;
  }
  if (!Number.isSafeInteger(resourceChatId) || resourceChatId === 0) {
    console.warn('notifyPublisherOfNewApplication skipped: invalid publishedInChatId', resourceChatId);
    return;
  }
  if (!posId) {
    console.warn('notifyPublisherOfNewApplication skipped: missing positionId');
    return;
  }

  const applicantChatId = Number(applicantUser?.TelegramChatId);
  if (!Number.isSafeInteger(applicantChatId) || applicantChatId <= 0) {
    console.warn('notifyPublisherOfNewApplication skipped: invalid applicant chat id');
    return;
  }

  const [publisher, position] = await Promise.all([
    models.Users.findByPk(publisherId, { attributes: ['Id', 'TelegramChatId'] }),
    models.Positions?.findByPk(posId, { attributes: ['Id', 'Title', 'CompanyName'] }),
  ]);

  const publisherChatId = Number(publisher?.TelegramChatId);
  if (!Number.isSafeInteger(publisherChatId) || publisherChatId <= 0) {
    console.warn('notifyPublisherOfNewApplication skipped: publisher has no TelegramChatId', {
      publisherId,
    });
    return;
  }
  if (publisherChatId === applicantChatId) {
    console.warn('notifyPublisherOfNewApplication skipped: publisher is the applicant', {
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
    models.UserApplications.count({
      where: trackedApplicationWhere(publisherId, {
        PositionId: posId,
        PublishedIn: resourceChatId,
      }),
    }),
    models.UserApplications.count({
      where: trackedApplicationWhere(publisherId),
    }),
  ]);

  const lines = [
    'New application',
    '',
    `user: ${applicantChatId}`,
    `position: ${positionLabel}`,
    `resource: ${resourceChatId}`,
    `number of applicants for your position link: ${positionLinkCount}`,
    `overall number of applicants from your links: ${overallCount}`,
  ];

  try {
    await bot.sendMessage(publisherChatId, lines.join('\n'));
    console.log('notifyPublisherOfNewApplication sent', {
      publisherChatId,
      publisherId,
      positionId: posId,
    });
  } catch (err) {
    console.warn('notifyPublisherOfNewApplication failed:', err?.message || err, {
      publisherChatId,
      publisherId,
    });
  }
}
