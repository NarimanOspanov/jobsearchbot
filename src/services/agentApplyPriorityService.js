import { rankJobsForAgentApplyBatchWithAI } from './aiService.js';
import { buildJobRequirementsText, getSeekerResumeTextForTailoring } from './tailoredCvService.js';

const CHUNK_SIZE = 20;
const MAX_JOBS = 200;

function normalizeIncomingJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of jobs) {
    const id = Number.parseInt(String(raw?.id ?? ''), 10);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: String(raw?.title || '').trim(),
      company: String(raw?.company || '').trim(),
      location: String(raw?.location || '').trim(),
      shortSummary: raw?.shortSummary ?? null,
      description: raw?.description ?? null,
      skills: Array.isArray(raw?.skills) ? raw.skills : [],
      contacts: raw?.contacts ?? null,
      applyType: raw?.applyType ?? null,
      source: raw?.source ?? null,
      requirementsText: buildJobRequirementsText(raw),
    });
    if (out.length >= MAX_JOBS) break;
  }
  return out;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function assignGlobalApplyRanks(rows) {
  const skip = [];
  const apply = [];
  for (const row of rows) {
    if (row.priority === 'skip') skip.push(row);
    else apply.push(row);
  }
  apply.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const priorityOrder = { apply_first: 0, good: 1, low: 2 };
    const pa = priorityOrder[a.priority] ?? 2;
    const pb = priorityOrder[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.jobId - b.jobId;
  });
  skip.sort((a, b) => a.jobId - b.jobId);

  let rank = 1;
  const ranked = apply.map((row) => ({ ...row, applyRank: rank++ }));
  for (const row of skip) {
    ranked.push({ ...row, applyRank: rank++, score: 0 });
  }
  return ranked;
}

/**
 * @param {{ clientUser: object, jobs: unknown[] }}
 */
export async function rankJobsForAgentApply({ clientUser, jobs }) {
  const normalizedJobs = normalizeIncomingJobs(jobs);
  if (!normalizedJobs.length) {
    throw new Error('At least one job is required');
  }

  const resumeText = await getSeekerResumeTextForTailoring(clientUser);
  if (!String(resumeText || '').trim()) {
    throw new Error('Upload client resume before analyzing priority');
  }

  const searchMode = String(clientUser?.SearchMode || 'not_urgent').trim() === 'urgent' ? 'urgent' : 'not_urgent';
  const agentComment = String(clientUser?.Comment || '').trim();

  const chunks = chunkArray(normalizedJobs, CHUNK_SIZE);
  const merged = [];
  for (const chunk of chunks) {
    const batch = await rankJobsForAgentApplyBatchWithAI({
      resumeText,
      searchMode,
      agentComment,
      jobs: chunk,
    });
    merged.push(...batch);
  }

  const rankings = assignGlobalApplyRanks(merged);
  return {
    context: {
      searchMode,
      commentLength: agentComment.length,
      resumeTextLength: String(resumeText).length,
      jobCount: normalizedJobs.length,
    },
    rankings,
  };
}
