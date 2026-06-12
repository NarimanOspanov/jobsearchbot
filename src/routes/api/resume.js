import { Router } from 'express';
import { miniAppAuth } from '../../middleware/auth.js';
import { generateTailoredResumeMarkdown, generateCoverLetterText } from '../../services/aiService.js';
import { markdownToPdfBuffer } from '../../services/resumeService.js';
import { canUseAiToolsForUser, buildMonetizationStatus } from '../../services/planService.js';
import {
  assertCanAccessClient,
  isBotAdminTelegramId,
  resolveUserFromMiniApp,
} from '../../services/agentAccessService.js';
import { models } from '../../db.js';
import { cvScoreResultByUserId } from '../../bot/state.js';
import {
  resolveJobRequirementsFromBody,
  tailorResumeForSeeker,
  generateCoverLetterPdf,
} from '../../services/tailoredCvService.js';
import { extractMiniAppInitData, verifyInitData } from '../../utils/telegramUtils.js';
import { getRequiredChannelsState, serializeRequiredChannels } from '../../services/channelService.js';

async function resolveSeekerUserForAiGeneration(req, seekerId) {
  const actorUser = await resolveUserFromMiniApp(req.miniAppUser);
  if (!actorUser) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (Number(actorUser.Id) === seekerId) {
    return { ok: true, seekerUser: actorUser };
  }
  const isBotAdmin = isBotAdminTelegramId(req.miniAppUser?.id);
  const impersonateRaw = Number.parseInt(String(req.body?.agentUserId ?? ''), 10);
  const impersonateAgentUserId =
    isBotAdmin && Number.isSafeInteger(impersonateRaw) && impersonateRaw > 0 ? impersonateRaw : null;
  const access = await assertCanAccessClient({
    actorUserId: actorUser.Id,
    clientUserId: seekerId,
    isBotAdmin,
    impersonateAgentUserId,
  });
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error };
  }
  const seekerUser = await models.Users.findByPk(seekerId);
  if (!seekerUser) {
    return { ok: false, status: 404, error: 'User not found' };
  }
  return { ok: true, seekerUser };
}

export function createResumeRouter() {
  const router = Router();

  router.get('/api/cvscore-result', async (req, res) => {
    const uidRaw = String(req.query.uid || '').trim();
    if (!uidRaw) return res.status(400).json({ error: 'Missing uid' });

    const initData = extractMiniAppInitData(req);
    if (initData) {
      const miniAppUser = verifyInitData(initData);
      if (!miniAppUser?.id) return res.status(403).json({ error: 'Forbidden' });
      if (String(miniAppUser.id) !== uidRaw) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const channelsState = await getRequiredChannelsState(miniAppUser.id);
      if (channelsState.reason === 'unavailable') {
        return res.status(503).json({ error: 'Subscription check is temporarily unavailable' });
      }
      if (!channelsState.ok) {
        return res.status(403).json({
          error: 'subscribe_required',
          channels: serializeRequiredChannels(channelsState.channels),
        });
      }
    }

    const result = cvScoreResultByUserId.get(uidRaw);
    if (!result) return res.status(404).json({ error: 'No result found. Please send your CV first.' });
    return res.json(result);
  });

  router.get('/api/admin/job-import-stats', async (req, res) => {
    try {
      const periodRaw = String(req.query.period || '7').trim();
      const period = /^\d+$/.test(periodRaw)
        ? Math.min(365, Math.max(1, Number.parseInt(periodRaw, 10)))
        : 7;
      const url = `https://anyhires.com/api/global-remote-positions/job-import-stats?period=${encodeURIComponent(period)}`;
      const response = await fetch(url);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({
          error: typeof payload === 'object' && payload?.error ? payload.error : 'Failed to load job import stats',
        });
      }
      return res.json(payload);
    } catch (err) {
      console.error('GET /api/admin/job-import-stats:', err);
      return res.status(500).json({ error: 'Failed to load job import stats' });
    }
  });

  /** @deprecated Legacy Gemini markdown PDF; job tailor uses POST /api/tailored-resume/upload → generate-simple. */
  router.post('/api/tailored-resume', async (req, res) => {
    console.warn('POST /api/tailored-resume (legacy markdown) called');
    try {
      const jobTitle = String(req.body?.jobTitle || '').trim();
      const jobDescription = String(req.body?.jobDescription || '').trim();
      const mainResumeText = String(req.body?.mainResumeText || '').trim();
      if (!jobTitle || !jobDescription || !mainResumeText) {
        return res.status(400).json({
          error: 'jobTitle, jobDescription, and mainResumeText are required',
        });
      }
      const markdown = await generateTailoredResumeMarkdown({ jobTitle, jobDescription, mainResumeText });
      const pdfBuffer = await markdownToPdfBuffer(markdown);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="tailored-resume.pdf"');
      return res.status(200).send(pdfBuffer);
    } catch (err) {
      console.error('POST /api/tailored-resume:', err);
      return res.status(500).json({ error: 'Failed to generate tailored resume PDF' });
    }
  });

  router.post('/api/tailored-resume/upload', miniAppAuth, async (req, res) => {
    try {
      const seekerId = Number.parseInt(String(req.body?.seekerId), 10);
      const screenlyJobId = Number.parseInt(String(req.body?.screenlyJobId), 10);
      const jobTitle = String(req.body?.jobTitle || req.body?.job?.title || '').trim();
      const jobRequirements = resolveJobRequirementsFromBody(req.body);
      const tailorSource = String(req.body?.tailorSource || 'api-upload').trim() || 'api-upload';
      if (!Number.isSafeInteger(seekerId) || seekerId <= 0) {
        return res.status(400).json({ error: 'seekerId is required and must be a positive integer' });
      }
      if (!Number.isSafeInteger(screenlyJobId) || screenlyJobId < 0) {
        return res.status(400).json({ error: 'screenlyJobId is required and must be a non-negative integer' });
      }
      if (!jobTitle || !jobRequirements) {
        return res.status(400).json({ error: 'job title and job description are required' });
      }
      const resolved = await resolveSeekerUserForAiGeneration(req, seekerId);
      if (!resolved.ok) {
        return res.status(resolved.status).json({ error: resolved.error });
      }
      const { seekerUser } = resolved;
      const canUseAiTools = await canUseAiToolsForUser(seekerUser.Id);
      if (!canUseAiTools) {
        return res.status(402).json({
          error: 'gold_required',
          message: 'AI-инструменты доступны в Premium или при наличии открытий.',
          monetization: await buildMonetizationStatus(seekerUser.Id),
        });
      }

      const { url: tailoredCvUrl } = await tailorResumeForSeeker({
        seekerUser,
        jobRequirements,
        source: tailorSource,
      });
      return res.status(200).json({ tailoredCvUrl });
    } catch (err) {
      console.error('POST /api/tailored-resume/upload:', err);
      const status =
        Number.isFinite(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
      return res.status(status).json({
        error: err?.message || 'Failed to generate/upload tailored resume',
      });
    }
  });

  router.post('/api/cover-letter', miniAppAuth, async (req, res) => {
    try {
      const seekerId = Number.parseInt(String(req.body?.seekerId), 10);
      const jobTitle = String(req.body?.jobTitle || req.body?.job?.title || '').trim();
      const jobDescription = resolveJobRequirementsFromBody(req.body);
      const mainResumeText = String(req.body?.mainResumeText || '').trim();
      if (!Number.isSafeInteger(seekerId) || seekerId <= 0) {
        return res.status(400).json({ error: 'seekerId is required and must be a positive integer' });
      }
      if (!jobTitle || !jobDescription || !mainResumeText) {
        return res.status(400).json({
          error: 'seekerId, job title, job description, and mainResumeText are required',
        });
      }
      const resolved = await resolveSeekerUserForAiGeneration(req, seekerId);
      if (!resolved.ok) {
        return res.status(resolved.status).json({ error: resolved.error });
      }
      const { seekerUser } = resolved;
      const canUseAiTools = await canUseAiToolsForUser(seekerUser.Id);
      if (!canUseAiTools) {
        return res.status(402).json({
          error: 'gold_required',
          message: 'AI-инструменты доступны в Premium или при наличии открытий.',
          monetization: await buildMonetizationStatus(seekerUser.Id),
        });
      }
      const coverLetter = await generateCoverLetterText({ jobTitle, jobDescription, mainResumeText });
      let coverLetterUrl = null;
      try {
        const { url } = await generateCoverLetterPdf({ coverLetterText: coverLetter });
        coverLetterUrl = url;
      } catch (pdfErr) {
        console.error('POST /api/cover-letter: PDF generation failed (non-fatal):', pdfErr);
      }
      return res.status(200).json({ coverLetter, coverLetterUrl });
    } catch (err) {
      console.error('POST /api/cover-letter:', err);
      return res.status(500).json({ error: 'Failed to generate cover letter' });
    }
  });

  return router;
}
