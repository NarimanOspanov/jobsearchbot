import { Sequelize } from 'sequelize';
import { models, sequelize } from '../db.js';
import { parseResumeContactsJson, normalizeSkillIds, extractResumeTextFromUrl } from './resumeService.js';
import { normalizeWorkAuthCountries } from '../utils/validators.js';
import { extractResumeContactsWithAI, fetchScreenlySkillsCatalog, extractResumeSkillIdsWithAI, extractResumeWorkAuthCountriesWithAI } from './aiService.js';
import { resumeStorage } from './resumeStorage.js';

export { normalizeSkillIds };

/** @param {unknown} raw */
export function normalizePositionSkillIds(raw) {
  if (Array.isArray(raw)) return normalizeSkillIds(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return normalizeSkillIds(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return [];
}

/** @param {unknown} raw */
export function serializePositionSkillsForDb(raw) {
  const normalized = normalizePositionSkillIds(raw);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

/**
 * Merge position skills into the user profile (e.g. when opening a tracked apply link).
 * CV upload enrichment may still replace skills later.
 * @param {import('../models/User.js').default | null | undefined} user
 * @param {{ Skills?: unknown } | null | undefined} position
 */
export async function mergePositionSkillsIntoUser(user, position) {
  if (!user || !position) return user;
  const positionSkills = normalizePositionSkillIds(position.Skills);
  if (!positionSkills.length) return user;

  const existing = normalizeSkillIds(user.skills);
  const merged = normalizeSkillIds([...existing, ...positionSkills]);
  const hasNewSkill = positionSkills.some((id) => !existing.includes(id));
  if (!hasNewSkill) return user;

  await user.update({ skills: merged });
  return user;
}

const SUPPORTED_RESUME_MIME_FRAGMENTS = ['pdf', 'jpeg', 'jpg', 'png', 'webp'];

export function isSupportedResumeMimeType(mimeType) {
  const mime = String(mimeType || '').trim().toLowerCase();
  return SUPPORTED_RESUME_MIME_FRAGMENTS.some((part) => mime.includes(part));
}

/**
 * @param {{ user: import('../models/User.js').default, buffer: Buffer, fileName: string, mimeType: string, fileIdPrefix?: string, runEnrichment?: boolean }} params
 */
export async function saveUserResumeFromBuffer({
  user,
  buffer,
  fileName,
  mimeType,
  fileIdPrefix = 'webapp',
  runEnrichment = true,
  awaitEnrichment = false,
  forceEnrichmentRefresh = false,
}) {
  const resumeUrl = await resumeStorage.uploadResumeBuffer({
    chatId: user.TelegramChatId,
    fileId: `${fileIdPrefix}-${user.TelegramChatId}-${Date.now()}`,
    fileName,
    mimeType,
    buffer,
  });

  let resumeContactsJson = user.ResumeContactsJson ?? null;
  try {
    const resumeText = await extractResumeTextFromUrl(resumeUrl);
    const resumeContacts = await extractResumeContactsWithAI(resumeText);
    if (resumeContacts) resumeContactsJson = JSON.stringify(resumeContacts);
  } catch (parseErr) {
    console.warn('Resume contact extraction failed:', parseErr?.message || parseErr);
  }

  await user.update({ ResumeURL: resumeUrl, ResumeContactsJson: resumeContactsJson });
  if (runEnrichment) {
    const enrichmentOpts = {
      userId: user.Id,
      resumeUrl,
      includeSkills: true,
      forceWorkAuthRefresh: forceEnrichmentRefresh,
    };
    if (awaitEnrichment) {
      await runResumeEnrichment(enrichmentOpts);
      await user.reload();
    } else {
      runResumeEnrichmentInBackground(enrichmentOpts);
    }
  }
  return resumeUrl;
}

/** @param {import('../models/User.js').default | Record<string, unknown> | null | undefined} user */
export function userCanReceiveMarketingNotifications(user) {
  if (!user || user.IsBlocked) return false;
  return user.PushNotificationsEnabled !== false;
}

export function buildAdminUserContactProjection(user) {
  const resumeContacts = parseResumeContactsJson(user.ResumeContactsJson);
  const resumeName = resumeContacts.name || null;
  const resumeLastName = resumeContacts.lastName || null;
  const resumePhoneNumber = resumeContacts.phoneNumber || null;
  const resumeEmail = resumeContacts.email || null;
  return {
    resumeContacts,
    resumeName,
    resumeLastName,
    resumePhoneNumber,
    resumeEmail,
    displayFirstName: resumeName || user.FirstName || null,
    displayLastName: resumeLastName || user.LastName || null,
    displayPhoneNumber: resumePhoneNumber || null,
    displayEmail: resumeEmail || null,
  };
}

export async function ensureUserByTelegramId(telegramId, username = null, firstName = null, lastName = null) {
  if (!telegramId) return { user: null, wasCreated: false };
  let wasCreated = false;
  let user = await models.Users.findOne({ where: { TelegramChatId: telegramId } });
  if (!user) {
    try {
      user = await models.Users.create({
        TelegramChatId: telegramId,
        TelegramUserName: username,
        FirstName: firstName,
        LastName: lastName,
        HhEnabled: false,
        DateJoined: Sequelize.literal('GETUTCDATE()'),
      });
      wasCreated = true;
    } catch (createErr) {
      if (createErr?.name === 'SequelizeUniqueConstraintError') {
        user = await models.Users.findOne({ where: { TelegramChatId: telegramId } });
      } else {
        throw createErr;
      }
    }
  } else if (
    user.TelegramUserName !== username ||
    user.FirstName !== firstName ||
    user.LastName !== lastName
  ) {
    await user.update({ TelegramUserName: username, FirstName: firstName, LastName: lastName });
  }
  return { user, wasCreated };
}

export async function ensureUser(ctx) {
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  const username = ctx.from?.username ?? null;
  const firstName = ctx.from?.first_name ?? null;
  const lastName = ctx.from?.last_name ?? null;
  return ensureUserByTelegramId(chatId, username, firstName, lastName);
}

export async function removeUserDataByTelegramChatId(telegramChatId) {
  return sequelize.transaction(async (transaction) => {
    const user = await models.Users.findOne({ where: { TelegramChatId: telegramChatId }, transaction });
    if (!user) {
      return {
        ok: true,
        found: false,
        applicationsDeleted: 0,
        referralsDeleted: 0,
        telegramPaymentsDeleted: 0,
        userSubscriptionsDeleted: 0,
        userBonusOpensDeleted: 0,
        requiredChannelUsersDeleted: 0,
        searchClicksDeleted: 0,
        jobDetailsOpensDeleted: 0,
        userApplicationsDeleted: 0,
        publisherSignupsDeleted: 0,
        campaignSignupsDeleted: 0,
      };
    }
    const applicationsDeleted = await models.Applications.destroy({ where: { UserId: user.Id }, transaction });
    const referralsDeleted = models.Referrals
      ? await models.Referrals.destroy({
          where: { [Sequelize.Op.or]: [{ ReferrerUserId: user.Id }, { ReferredUserId: user.Id }] },
          transaction,
        })
      : 0;
    const userSubscriptionsDeleted = models.UserSubscriptions
      ? await models.UserSubscriptions.destroy({ where: { UserId: user.Id }, transaction })
      : 0;
    const telegramPaymentsDeleted = models.TelegramPayments
      ? await models.TelegramPayments.destroy({ where: { UserId: user.Id }, transaction })
      : 0;
    const userBonusOpensDeleted = models.UserBonusOpens
      ? await models.UserBonusOpens.destroy({ where: { UserId: user.Id }, transaction })
      : 0;
    const requiredChannelUsersDeleted = models.RequiredChannelUsers
      ? await models.RequiredChannelUsers.destroy({ where: { UserId: user.TelegramChatId }, transaction })
      : 0;
    const searchClicksDeleted = models.SearchClicks
      ? await models.SearchClicks.destroy({ where: { UserId: user.Id }, transaction })
      : 0;
    const jobDetailsOpensDeleted = models.JobDetailsOpens
      ? await models.JobDetailsOpens.destroy({ where: { UserId: user.Id }, transaction })
      : 0;
    const userApplicationsDeleted = models.UserApplications
      ? await models.UserApplications.destroy({ where: { UserId: user.Id }, transaction })
      : 0;
    const publisherSignupsDeleted = models.PublisherSignups
      ? await models.PublisherSignups.destroy({ where: { UserId: user.Id }, transaction })
      : 0;
    const campaignSignupsDeleted = models.CampaignSignups
      ? await models.CampaignSignups.destroy({ where: { UserId: user.Id }, transaction })
      : 0;
    await user.destroy({ transaction });
    return {
      ok: true,
      found: true,
      applicationsDeleted,
      referralsDeleted,
      telegramPaymentsDeleted,
      userSubscriptionsDeleted,
      userBonusOpensDeleted,
      requiredChannelUsersDeleted,
      searchClicksDeleted,
      jobDetailsOpensDeleted,
      userApplicationsDeleted,
      publisherSignupsDeleted,
      campaignSignupsDeleted,
    };
  });
}

export async function runResumeEnrichment({
  userId,
  resumeUrl,
  includeSkills = false,
  forceWorkAuthRefresh = false,
  /** Skip contacts/work-auth AI — faster path for post-apply job preview. */
  previewOnly = false,
} = {}) {
  console.info('[resume-enrichment] started', { userId, includeSkills, forceWorkAuthRefresh, previewOnly });
  const user = await models.Users.findByPk(userId);
  if (!user) {
    return { ok: false, hasContacts: false, skillsCount: 0, workAuthCountries: null, resumeText: '' };
  }
  const resumeText = await extractResumeTextFromUrl(resumeUrl);
  const shouldFillWorkAuth =
    !previewOnly &&
    (forceWorkAuthRefresh || !String(user.WorkAuthorizationCountries || '').trim());
  const contactsPromise = previewOnly
    ? Promise.resolve(null)
    : extractResumeContactsWithAI(resumeText);
  const existingSkills = normalizeSkillIds(user.skills);
  const skillsPromise = includeSkills && existingSkills.length === 0
    ? fetchScreenlySkillsCatalog()
        .then((skillsCatalog) => extractResumeSkillIdsWithAI(resumeText, skillsCatalog))
        .catch((skillsErr) => {
          console.warn('Resume skills enrichment failed:', skillsErr?.message || skillsErr);
          return [];
        })
    : Promise.resolve([]);
  const workAuthPromise = shouldFillWorkAuth
    ? extractResumeWorkAuthCountriesWithAI(resumeText).catch((workAuthErr) => {
        console.warn('Resume work auth enrichment failed:', workAuthErr?.message || workAuthErr);
        return [];
      })
    : Promise.resolve([]);
  const [resumeContacts, resumeSkillIds, resumeWorkAuthCountries] = await Promise.all([
    contactsPromise,
    skillsPromise,
    workAuthPromise,
  ]);
  const updates = {};
  if (resumeContacts) updates.ResumeContactsJson = JSON.stringify(resumeContacts);
  if (includeSkills && existingSkills.length === 0 && Array.isArray(resumeSkillIds)) updates.skills = resumeSkillIds;
  if (shouldFillWorkAuth && Array.isArray(resumeWorkAuthCountries) && resumeWorkAuthCountries.length > 0) {
    updates.WorkAuthorizationCountries = normalizeWorkAuthCountries(resumeWorkAuthCountries).join(',');
  }
  if (Object.keys(updates).length > 0) {
    await user.update(updates);
    console.info('[resume-enrichment] saved', {
      userId,
      hasContacts: Boolean(updates.ResumeContactsJson),
      skillsCount: Array.isArray(updates.skills) ? updates.skills.length : 0,
      workAuthCountries: updates.WorkAuthorizationCountries || null,
      previewOnly,
    });
    return {
      ok: true,
      hasContacts: Boolean(updates.ResumeContactsJson),
      skillsCount: Array.isArray(updates.skills) ? updates.skills.length : 0,
      workAuthCountries: updates.WorkAuthorizationCountries || null,
      resumeText,
    };
  }
  console.warn('[resume-enrichment] no parsed data to save', { userId, previewOnly });
  return {
    ok: true,
    hasContacts: false,
    skillsCount: Array.isArray(resumeSkillIds) ? resumeSkillIds.length : 0,
    workAuthCountries: null,
    resumeText,
  };
}

export function runResumeEnrichmentInBackground(opts) {
  setTimeout(() => {
    runResumeEnrichment(opts).catch((parseErr) => {
      console.warn('Background resume enrichment failed:', parseErr?.message || parseErr);
    });
  }, 0);
}
