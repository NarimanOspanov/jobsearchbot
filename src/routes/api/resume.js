import { Router } from 'express';
import { miniAppAuth } from '../../middleware/auth.js';
import { generateTailoredResumeMarkdown, generateCoverLetterText } from '../../services/aiService.js';
import { markdownToPdfBuffer } from '../../services/resumeService.js';
import { canUseAiToolsForUser, buildMonetizationStatus } from '../../services/planService.js';
import { ensureUserByTelegramId } from '../../services/userService.js';
import { cvScoreResultByUserId } from '../../bot/state.js';
import { config } from '../../config.js';

export function createResumeRouter() {
  const router = Router();

  router.get('/api/cvscore-result', (req, res) => {
    const uidRaw = String(req.query.uid || '').trim();
    if (!uidRaw) return res.status(400).json({ error: 'Missing uid' });
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

  router.post('/api/tailored-resume', async (req, res) => {
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
      const jobTitle = String(req.body?.jobTitle || '').trim();
      const jobDescription = String(req.body?.jobDescription || '').trim();
      const mainResumeText = String(req.body?.mainResumeText || '').trim();
      if (!Number.isSafeInteger(seekerId) || seekerId <= 0) {
        return res.status(400).json({ error: 'seekerId is required and must be a positive integer' });
      }
      if (!Number.isSafeInteger(screenlyJobId) || screenlyJobId < 0) {
        return res.status(400).json({ error: 'screenlyJobId is required and must be a non-negative integer' });
      }
      if (!jobTitle || !jobDescription || !mainResumeText) {
        return res.status(400).json({ error: 'jobTitle, jobDescription, and mainResumeText are required' });
      }
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      if (!user || Number(user.Id) !== seekerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const canUseAiTools = await canUseAiToolsForUser(user.Id);
      if (!canUseAiTools) {
        return res.status(402).json({
          error: 'gold_required',
          message: 'AI-инструменты доступны в Premium или при наличии открытий.',
          monetization: await buildMonetizationStatus(user.Id),
        });
      }

      const generateBase = String(config.generateTailoredUrl || '').trim().replace(/\/$/, '');
      if (!generateBase) {
        return res.status(503).json({ error: 'GENERATE_TAILORED_URL is not configured' });
      }
      const upstreamRes = await fetch(`${generateBase}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seekerId,
          screenlyJobId,
          existingCvText: mainResumeText,
          jobRequirements: jobDescription,
        }),
      });
      const upstreamRaw = await upstreamRes.text();
      let upstreamJson = {};
      try {
        upstreamJson = upstreamRaw ? JSON.parse(upstreamRaw) : {};
      } catch {
        upstreamJson = {};
      }
      if (!upstreamRes.ok) {
        const msg = upstreamJson?.error || upstreamRaw || upstreamRes.statusText || 'Upstream error';
        return res.status(upstreamRes.status >= 400 && upstreamRes.status < 600 ? upstreamRes.status : 502).json({
          error: String(msg).slice(0, 500),
        });
      }
      const tailoredCvUrl = upstreamJson?.url != null ? String(upstreamJson.url).trim() : '';
      if (!tailoredCvUrl) {
        return res.status(502).json({ error: 'Tailored CV service returned no url' });
      }
      return res.status(200).json({ tailoredCvUrl });
    } catch (err) {
      console.error('POST /api/tailored-resume/upload:', err);
      return res.status(500).json({ error: 'Failed to generate/upload tailored resume' });
    }
  });

  router.post('/api/cover-letter', miniAppAuth, async (req, res) => {
    try {
      const seekerId = Number.parseInt(String(req.body?.seekerId), 10);
      const jobTitle = String(req.body?.jobTitle || '').trim();
      const jobDescription = String(req.body?.jobDescription || '').trim();
      const mainResumeText = String(req.body?.mainResumeText || '').trim();
      if (!Number.isSafeInteger(seekerId) || seekerId <= 0) {
        return res.status(400).json({ error: 'seekerId is required and must be a positive integer' });
      }
      if (!jobTitle || !jobDescription || !mainResumeText) {
        return res.status(400).json({
          error: 'seekerId, jobTitle, jobDescription, and mainResumeText are required',
        });
      }
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      if (!user || Number(user.Id) !== seekerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const canUseAiTools = await canUseAiToolsForUser(user.Id);
      if (!canUseAiTools) {
        return res.status(402).json({
          error: 'gold_required',
          message: 'AI-инструменты доступны в Premium или при наличии открытий.',
          monetization: await buildMonetizationStatus(user.Id),
        });
      }
      const coverLetter = await generateCoverLetterText({ jobTitle, jobDescription, mainResumeText });
      return res.status(200).json({ coverLetter });
    } catch (err) {
      console.error('POST /api/cover-letter:', err);
      return res.status(500).json({ error: 'Failed to generate cover letter' });
    }
  });

  return router;
}
