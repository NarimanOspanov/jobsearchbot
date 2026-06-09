import { models } from '../db.js';

/**
 * Persist campaign attribution for a brand-new user who arrived via ref_<slug> link.
 */
export async function recordCampaignSignup({ user, campaignSlug, startPayload = '' } = {}) {
  if (!models.CampaignSignups) {
    return { created: false, row: null };
  }

  const userId = Number(user?.Id);
  const slug = String(campaignSlug || '').trim().toLowerCase().slice(0, 50);
  const payload = String(startPayload || '').trim().slice(0, 64);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { created: false, row: null };
  }
  if (!slug || !/[a-z]/.test(slug)) {
    return { created: false, row: null };
  }

  try {
    const [row, created] = await models.CampaignSignups.findOrCreate({
      where: { UserId: userId },
      defaults: {
        UserId: userId,
        CampaignSlug: slug,
        StartPayload: payload || null,
        SignedUpAt: new Date(),
      },
    });
    return { created, row };
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const existing = await models.CampaignSignups.findOne({ where: { UserId: userId } });
      return { created: false, row: existing };
    }
    throw err;
  }
}
