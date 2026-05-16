import { Router } from 'express';
import express from 'express';
import { miniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { config } from '../../config.js';
import { ensureUserByTelegramId } from '../../services/userService.js';
import { buildMonetizationStatus } from '../../services/planService.js';
import { resumeStorage } from '../../services/resumeStorage.js';
import { extractResumeTextFromUrl } from '../../services/resumeService.js';
import { extractResumeContactsWithAI } from '../../services/aiService.js';
import { normalizeSkillIds } from '../../services/userService.js';
import {
  toBoolOrUndefined,
  toSearchModeOrUndefined,
  toIntOrNullOrUndefined,
  toSkillIdsOrNullOrUndefined,
} from '../../utils/validators.js';
import { resolveBotLanguage } from '../../utils/userLanguage.js';

export function createProfileRouter() {
  const router = Router();

  router.get('/api/app/profile', miniAppAuth, async (req, res) => {
    try {
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      const monetization = await buildMonetizationStatus(user.Id);
      const adminIds = config.botAdminTelegramIds;
      const telegramUserId = Number(req.miniAppUser?.id);
      const isBotAdmin =
        Number.isSafeInteger(telegramUserId) &&
        adminIds.size > 0 &&
        adminIds.has(telegramUserId);
      res.json({
        id: user.Id,
        telegramChatId: String(user.TelegramChatId),
        telegramUserName: user.TelegramUserName,
        language: resolveBotLanguage(req.miniAppUser?.language_code),
        isBotAdmin,
        resumeUrl: user.ResumeURL,
        skills: user.skills,
        monetization,
        settings: {
          hhEnabled: !!user.HhEnabled,
          linkedInEnabled: !!user.LinkedInEnabled,
          indeedEnabled: !!user.IndeedEnabled,
          telegramEnabled: !!user.TelegramEnabled,
          companySitesEnabled: !!user.CompanySitesEnabled,
          emailFoundersEnabled: !!user.EmailFoundersEnabled,
          emailRecruitersEnabled: !!user.EmailRecruitersEnabled,
          searchMode: user.SearchMode || 'not_urgent',
          minimumSalary: user.MinimumSalary,
          remoteOnly: !!user.RemoteOnly,
        },
      });
    } catch (err) {
      console.error('GET /api/app/profile:', err);
      res.status(500).json({ error: 'Failed to load profile' });
    }
  });

  router.post(
    '/api/app/profile/resume-upload',
    miniAppAuth,
    express.raw({ type: 'application/octet-stream', limit: '15mb' }),
    async (req, res) => {
      try {
        const { user } = await ensureUserByTelegramId(
          req.miniAppUser.id,
          req.miniAppUser.username ?? null,
          req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
          req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : null;
        if (!bodyBuffer || bodyBuffer.length === 0) {
          return res.status(400).json({ error: 'Resume file bytes are required' });
        }

        const headerFileNameRaw = String(req.headers['x-file-name'] || '').trim();
        const headerMimeTypeRaw = String(req.headers['x-file-type'] || '').trim().toLowerCase();
        const fileName = headerFileNameRaw || `resume-${Date.now()}.pdf`;
        const mimeType = headerMimeTypeRaw || 'application/octet-stream';
        const isSupported =
          mimeType.includes('pdf') ||
          mimeType.includes('jpeg') ||
          mimeType.includes('jpg') ||
          mimeType.includes('png') ||
          mimeType.includes('webp');
        if (!isSupported) {
          return res.status(400).json({ error: 'Unsupported resume type. Use PDF or image (JPG/PNG/WEBP).' });
        }

        const resumeUrl = await resumeStorage.uploadResumeBuffer({
          chatId: user.TelegramChatId,
          fileId: `webapp-${user.TelegramChatId}-${Date.now()}`,
          fileName,
          mimeType,
          buffer: bodyBuffer,
        });

        let resumeContactsJson = user.ResumeContactsJson ?? null;
        try {
          const resumeText = await extractResumeTextFromUrl(resumeUrl);
          const resumeContacts = await extractResumeContactsWithAI(resumeText);
          if (resumeContacts) resumeContactsJson = JSON.stringify(resumeContacts);
        } catch (parseErr) {
          console.warn('WebApp resume contact extraction failed, keeping upload flow:', parseErr?.message || parseErr);
        }

        await user.update({ ResumeURL: resumeUrl, ResumeContactsJson: resumeContactsJson });
        return res.json({ ok: true, resumeUrl });
      } catch (err) {
        console.error('POST /api/app/profile/resume-upload:', err);
        return res.status(500).json({ error: 'Failed to upload resume' });
      }
    }
  );

  router.patch('/api/app/profile/settings', miniAppAuth, async (req, res) => {
    try {
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      const patch = {
        HhEnabled: toBoolOrUndefined(req.body.hhEnabled),
        LinkedInEnabled: toBoolOrUndefined(req.body.linkedInEnabled),
        IndeedEnabled: toBoolOrUndefined(req.body.indeedEnabled),
        TelegramEnabled: toBoolOrUndefined(req.body.telegramEnabled),
        CompanySitesEnabled: toBoolOrUndefined(req.body.companySitesEnabled),
        EmailFoundersEnabled: toBoolOrUndefined(req.body.emailFoundersEnabled),
        EmailRecruitersEnabled: toBoolOrUndefined(req.body.emailRecruitersEnabled),
        SearchMode: toSearchModeOrUndefined(req.body.searchMode),
        MinimumSalary: toIntOrNullOrUndefined(req.body.minimumSalary),
        RemoteOnly: toBoolOrUndefined(req.body.remoteOnly),
      };
      const skillIds = toSkillIdsOrNullOrUndefined(req.body.skills, normalizeSkillIds);

      const updates = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => typeof v === 'boolean' || typeof v === 'string' || v === null || typeof v === 'number')
      );
      if (skillIds !== undefined) updates.skills = skillIds;
      if (Object.keys(updates).length > 0) await user.update(updates);

      res.json({
        ok: true,
        language: resolveBotLanguage(req.miniAppUser?.language_code),
        skills: user.skills,
        settings: {
          hhEnabled: !!user.HhEnabled,
          linkedInEnabled: !!user.LinkedInEnabled,
          indeedEnabled: !!user.IndeedEnabled,
          telegramEnabled: !!user.TelegramEnabled,
          companySitesEnabled: !!user.CompanySitesEnabled,
          emailFoundersEnabled: !!user.EmailFoundersEnabled,
          emailRecruitersEnabled: !!user.EmailRecruitersEnabled,
          searchMode: user.SearchMode || 'not_urgent',
          minimumSalary: user.MinimumSalary,
          remoteOnly: !!user.RemoteOnly,
        },
      });
    } catch (err) {
      console.error('PATCH /api/app/profile/settings:', err);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  return router;
}
