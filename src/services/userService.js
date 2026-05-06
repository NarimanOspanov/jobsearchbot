import { Sequelize } from 'sequelize';
import { models, sequelize } from '../db.js';
import { parseResumeContactsJson, normalizeSkillIds, extractResumeTextFromUrl } from './resumeService.js';
import { extractResumeContactsWithAI, fetchScreenlySkillsCatalog, extractResumeSkillIdsWithAI } from './aiService.js';

export { normalizeSkillIds };

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
    };
  });
}

export function runResumeEnrichmentInBackground({ userId, resumeUrl, includeSkills = false }) {
  setTimeout(async () => {
    try {
      console.info('[resume-enrichment] started', { userId, includeSkills });
      const user = await models.Users.findByPk(userId);
      if (!user) return;
      const resumeText = await extractResumeTextFromUrl(resumeUrl);
      const contactsPromise = extractResumeContactsWithAI(resumeText);
      const skillsPromise = includeSkills
        ? fetchScreenlySkillsCatalog()
            .then((skillsCatalog) => extractResumeSkillIdsWithAI(resumeText, skillsCatalog))
            .catch((skillsErr) => {
              console.warn('Resume skills enrichment failed:', skillsErr?.message || skillsErr);
              return [];
            })
        : Promise.resolve([]);
      const [resumeContacts, resumeSkillIds] = await Promise.all([contactsPromise, skillsPromise]);
      const updates = {};
      if (resumeContacts) updates.ResumeContactsJson = JSON.stringify(resumeContacts);
      if (includeSkills && Array.isArray(resumeSkillIds)) updates.skills = resumeSkillIds;
      if (Object.keys(updates).length > 0) {
        await user.update(updates);
        console.info('[resume-enrichment] saved', {
          userId,
          hasContacts: Boolean(updates.ResumeContactsJson),
          skillsCount: Array.isArray(updates.skills) ? updates.skills.length : 0,
        });
      } else {
        console.warn('[resume-enrichment] no parsed data to save', { userId });
      }
    } catch (parseErr) {
      console.warn('Background resume enrichment failed:', parseErr?.message || parseErr);
    }
  }, 0);
}
