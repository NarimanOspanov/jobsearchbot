import { config } from '../config.js';

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
