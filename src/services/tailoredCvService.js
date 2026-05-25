import { config } from '../config.js';
import { extractResumeTextFromUrl } from './resumeService.js';

/** Build job requirements text (same shape as /cvscore «Адаптация под вакансию» user paste). */
export function buildJobRequirementsText(job) {
  const title = String(job?.title || '').trim();
  const company = String(job?.company || '').trim();
  const location = String(job?.location || '').trim();
  const summary = String(job?.shortSummary || job?.description || '').trim();
  const contacts = String(job?.contacts || '').trim();
  const parts = [];
  if (title) parts.push(`Job title: ${title}`);
  if (company) parts.push(`Company: ${company}`);
  if (location) parts.push(`Location: ${location}`);
  if (summary) parts.push(summary);
  const skills = Array.isArray(job?.skills) ? job.skills : [];
  const keySkills = skills
    .filter((s) => s?.isHighlyRelevant === true)
    .map((s) => String(s?.name || '').trim())
    .filter(Boolean);
  if (keySkills.length) parts.push(`Key skills: ${keySkills.join(', ')}`);
  if (contacts) parts.push(contacts);
  return parts.join('\n\n').trim();
}

/** Prefer explicit paste; else build from job-search job object (same as CVScore tailor input). */
export function resolveJobRequirementsFromBody(body) {
  const direct = String(body?.jobRequirements || body?.jobDescription || '').trim();
  if (direct) return direct;
  return buildJobRequirementsText(body?.job);
}

/** Resume text for tailoring: always from Users.ResumeURL when set (same PDF for all flows). */
export async function getSeekerResumeTextForTailoring(seekerUser, fallbackText = '') {
  const resumeUrl = String(seekerUser?.ResumeURL || '').trim();
  if (resumeUrl) {
    const fromUrl = await extractResumeTextFromUrl(resumeUrl);
    if (fromUrl) return fromUrl;
  }
  const fallback = String(fallbackText || '').trim();
  if (fallback) return fallback;
  throw new Error('Resume text is empty; upload a PDF resume first');
}

/**
 * Single entry for CVScore «Адаптация под вакансию», job search, and agent clients.
 * @param {{ seekerUser: object, jobRequirements: string, source?: string, fallbackResumeText?: string }}
 * @returns {Promise<{ url: string, resumeTextLength: number, jobRequirementsLength: number }>}
 */
export async function tailorResumeForSeeker({
  seekerUser,
  jobRequirements,
  source = 'unknown',
  fallbackResumeText = '',
}) {
  const requirements = String(jobRequirements || '').trim();
  if (!requirements) throw new Error('jobRequirements is required');
  if (requirements.length < 50) throw new Error('Job description is too short for tailoring');

  const existingCvText = await getSeekerResumeTextForTailoring(seekerUser, fallbackResumeText);
  console.info('[tailor-cv]', {
    source,
    userId: seekerUser?.Id,
    resumeUrl: seekerUser?.ResumeURL || null,
    resumeTextLength: existingCvText.length,
    jobRequirementsLength: requirements.length,
  });

  const { url } = await generateTailoredCvSimple({ existingCvText, jobRequirements: requirements });
  return { url, resumeTextLength: existingCvText.length, jobRequirementsLength: requirements.length };
}

/**
 * CVScore job tailor + job search job details use generate-simple on tailered-cv service.
 * @returns {Promise<{ url: string }>}
 */
export async function generateTailoredCvSimple({ existingCvText, jobRequirements }) {
  const cvText = String(existingCvText || '').trim();
  const requirements = String(jobRequirements || '').trim();
  if (!cvText) throw new Error('existingCvText is required');
  if (!requirements) throw new Error('jobRequirements is required');

  const tailoredBase = String(config.tailoredCvServiceUrl || '').trim().replace(/\/$/, '');
  if (!tailoredBase) throw new Error('Tailored CV service URL is not configured');

  const upstreamRes = await fetch(`${tailoredBase}/generate-simple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      existingCvText: cvText,
      jobRequirements: requirements,
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
    const err = new Error(String(msg).slice(0, 500));
    err.status = upstreamRes.status;
    throw err;
  }
  const url = upstreamJson?.url != null ? String(upstreamJson.url).trim() : '';
  if (!url) throw new Error('Tailored CV service returned no url');
  return { url };
}
