import { rankJobsForAgentApplyBatchWithAI } from './aiService.js';
import { buildJobRequirementsText, getSeekerResumeTextForTailoring } from './tailoredCvService.js';
import { normalizeSkillIds } from './userService.js';

const CHUNK_SIZE = 20;
const MAX_JOBS = 200;
const CHUNK_CONCURRENCY = 3;
const CHUNK_RETRY_COUNT = 1;

export function clientHasApplyPriorityComment(clientUser) {
  return Boolean(String(clientUser?.Comment || '').trim());
}

export function clientHasApplyPrioritySkills(clientUser) {
  return normalizeSkillIds(clientUser?.skills).length > 0;
}

export function clientIsReadyForApplyPriority(clientUser) {
  return clientHasApplyPriorityComment(clientUser) && clientHasApplyPrioritySkills(clientUser);
}

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

async function runChunkWithRetry({ chunk, resumeText, searchMode, agentComment, chunkIndex }) {
  let attempt = 0;
  let lastError = null;
  while (attempt <= CHUNK_RETRY_COUNT) {
    const startedAt = Date.now();
    try {
      const rows = await rankJobsForAgentApplyBatchWithAI({
        resumeText,
        searchMode,
        agentComment,
        jobs: chunk,
      });
      return {
        rows,
        meta: {
          chunkIndex,
          size: chunk.length,
          attempts: attempt + 1,
          durationMs: Date.now() - startedAt,
          ok: true,
          error: null,
        },
      };
    } catch (err) {
      lastError = err;
      if (attempt >= CHUNK_RETRY_COUNT) break;
    }
    attempt += 1;
  }
  const message = String(lastError?.message || lastError || 'Unknown chunk error');
  throw new Error(`Apply priority chunk ${chunkIndex + 1} failed: ${message}`);
}

async function processChunksInPool({ chunks, resumeText, searchMode, agentComment }) {
  const mergedRows = [];
  const chunkTimings = [];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= chunks.length) return;
      const chunk = chunks[current];
      const { rows, meta } = await runChunkWithRetry({
        chunk,
        resumeText,
        searchMode,
        agentComment,
        chunkIndex: current,
      });
      mergedRows.push(...rows);
      chunkTimings.push(meta);
    }
  }

  const workers = Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, () => worker());
  await Promise.all(workers);
  return { mergedRows, chunkTimings };
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
  const startedAt = Date.now();
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
  if (!agentComment) {
    throw new Error('Fill in client comment (companies to skip) before analyzing apply priority');
  }
  if (!clientHasApplyPrioritySkills(clientUser)) {
    throw new Error('Set client roles/skills before analyzing apply priority');
  }

  const chunks = chunkArray(normalizedJobs, CHUNK_SIZE);
  const { mergedRows, chunkTimings } = await processChunksInPool({
    chunks,
    resumeText,
    searchMode,
    agentComment,
  });

  const rankings = assignGlobalApplyRanks(mergedRows);
  const chunkDurations = chunkTimings.map((row) => Number(row.durationMs) || 0).filter((n) => n >= 0);
  const sumChunkDurations = chunkDurations.reduce((sum, n) => sum + n, 0);
  const maxChunkDurationMs = chunkDurations.length ? Math.max(...chunkDurations) : 0;
  const avgChunkDurationMs = chunkDurations.length ? Math.round(sumChunkDurations / chunkDurations.length) : 0;
  return {
    context: {
      searchMode,
      commentLength: agentComment.length,
      resumeTextLength: String(resumeText).length,
      jobCount: normalizedJobs.length,
      chunkCount: chunks.length,
      chunkSize: CHUNK_SIZE,
      chunkConcurrency: Math.min(CHUNK_CONCURRENCY, chunks.length),
      avgChunkDurationMs,
      maxChunkDurationMs,
      totalDurationMs: Date.now() - startedAt,
    },
    rankings,
  };
}
