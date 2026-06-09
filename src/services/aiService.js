import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { normalizeWorkAuthCountries } from '../utils/validators.js';
import {
  extractFirstJsonObject,
  extractFirstJsonArray,
  normalizeResumeContacts,
  normalizeSkillIds,
} from './resumeService.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const SCREENLY_SKILLS_URL = 'https://anyhires.com/api/all-skills';

const genAI = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

const screenlySkillsCache = {
  expiresAt: 0,
  skills: [],
};

export function buildTailoredResumePrompt({ jobTitle, jobDescription, mainResumeText }) {
  return `You are an expert resume tailoring assistant.
Task:
Create a tailored resume in markdown for this vacancy.
Inputs:
Job title: ${jobTitle}
Job description:
${jobDescription}
Candidate main resume text:
${mainResumeText}
Strict rules:
Use ONLY facts from the candidate main resume text.
Do NOT invent companies, dates, titles, metrics, education, certificates, or skills.
Keep the resume ATS-friendly, concise, and achievement-oriented.
Prioritize and reorder existing experience/skills to match the vacancy.
Remove irrelevant details when needed, but never fabricate.
If the resume contains multiple languages, prefer the language used in the job description.
Write the final resume in the same primary language as the job description.
ATS formatting constraints: plain headings and bullets only; no tables, no columns, no icons/emojis, no decorative separators, no markdown links.
Translate section heading labels to the same language as the job description (for example, Professional Summary, Core Competencies, Relevant Experience, Education, Certifications, Skills).
Keep the same section order, but localize heading text.
Always include the candidate's full name, email, phone number, and location at the very top of the resume.
Output MARKDOWN ONLY (no code fences, no explanations).
Render every section heading in bold markdown using this style: **<localized heading>**.
Output format (must follow exactly in this order, top-level headings only):
[Candidate Full Name]
[Phone] | [Email] | [City/Relocation info]
Professional Summary
(3-5 lines tailored to the role)
Core Competencies
(8-12 bullets)
Relevant Experience
<Role / Company / Dates exactly as in source when available>
(impact-focused bullets, 3-6 per role)
Education
(as available in source)
Certifications
(as available in source; if none, write: - Not specified)
Skills
(grouped concise bullets from source only)
Quality checks before final output:
Candidate name, phone, email, and location are present at the top
All claims traceable to source resume text
No placeholder text
No duplicated bullets
Clean markdown structure`;
}

export async function generateTailoredResumeMarkdown({ jobTitle, jobDescription, mainResumeText }) {
  if (!genAI) throw new Error('GEMINI_API_KEY is not configured');
  const prompt = buildTailoredResumePrompt({ jobTitle, jobDescription, mainResumeText });
  const response = await genAI.models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  const text = response.text?.trim();
  if (!text) throw new Error('AI response is empty');
  return text;
}

export async function generateCoverLetterText({ jobTitle, jobDescription, mainResumeText }) {
  if (!genAI) throw new Error('GEMINI_API_KEY is not configured');
  const prompt = `You are an expert career copywriter.
Task:
Write a short, strong, human-sounding cover letter tailored to this vacancy.
Inputs:
Job title: ${jobTitle}
Job description:
${jobDescription}
Candidate main resume text:
${mainResumeText}
Strict rules:
Use ONLY facts from the candidate main resume text.
Do NOT invent companies, dates, titles, metrics, education, certificates, or skills.
Write in the same primary language as the job description.
Write exactly 3-4 sentences total in one paragraph.
No greeting/header/signature.
Tone: natural and human, confident and warm, specific (not generic or robotic).
The first 1-2 sentences must hook the employer with clear role-fit.
Focus on value the candidate can bring for this role.
End with a short proactive closing.
Output plain text only (no markdown, no code fences, no explanations).`;

  const response = await genAI.models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  const text = response.text?.trim();
  if (!text) throw new Error('AI response is empty');
  const normalized = text.replace(/\s+/g, ' ').trim();
  const sentenceCandidates = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentenceCandidates.length < 3) {
    throw new Error('AI cover letter must contain at least 3 sentences');
  }
  return sentenceCandidates.slice(0, 4).join(' ');
}

export async function reviewResumeWithAI({ resumeText, lang = 'en' }) {
  const sourceText = String(resumeText || '').trim();
  if (!sourceText) throw new Error('Resume text is empty');
  if (config.anthropicApiKey) {
    return reviewResumeWithAnthropic({ resumeText: sourceText, lang });
  }
  if (!genAI) throw new Error('Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is configured');
  const feedbackLanguage = lang;
  const prompt = `You are a senior HR expert and ATS resume reviewer.
Task: Review the candidate resume text and provide concise expert feedback.

Return strict JSON only (no markdown fences) with this exact schema:
{
  "score": number,
  "ats_score": number,
  "structure_score": number,
  "summary": "string",
  "strengths": ["string"],
  "improvements": ["string"]
}

Rules:
- score: overall integer 0..100
- ats_score: keyword relevance & ATS compatibility, integer 0..100
- structure_score: layout, clarity & formatting, integer 0..100
- strengths: 3-6 bullet points
- improvements: 3-6 bullet points
- Use ONLY facts present in source resume. Do not invent companies, dates, titles, metrics, education, certificates, or skills.
- Write summary, strengths, and improvements in ${feedbackLanguage}.

Source resume text:
${sourceText}`;
  const response = await genAI.models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  const raw = response.text?.trim();
  if (!raw) throw new Error('AI response is empty');
  const jsonText = extractFirstJsonObject(raw);
  const parsed = JSON.parse(jsonText);
  const clamp = (n) => Math.min(100, Math.max(0, n));
  const scoreRaw = Number.parseInt(String(parsed?.score ?? ''), 10);
  const score = Number.isFinite(scoreRaw) ? clamp(scoreRaw) : null;
  const atsScore = clamp(Number.parseInt(String(parsed?.ats_score ?? ''), 10) || scoreRaw);
  const structureScore = clamp(Number.parseInt(String(parsed?.structure_score ?? ''), 10) || scoreRaw);
  const summary = String(parsed?.summary || '').trim();
  const strengths = Array.isArray(parsed?.strengths)
    ? parsed.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const improvements = Array.isArray(parsed?.improvements)
    ? parsed.improvements.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  if (score == null) throw new Error('AI review score is invalid');
  if (!summary) throw new Error('AI review summary is missing');
  return { score, atsScore, structureScore, summary, strengths, improvements };
}

export async function reviewResumeWithAnthropic({ resumeText, lang = 'en' }) {
  const sourceText = String(resumeText || '').trim();
  if (!sourceText) throw new Error('Resume text is empty');
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const feedbackLanguage = lang;
  const systemPrompt = `You are a senior HR expert and ATS resume reviewer.
Task: Review the candidate resume text and provide concise expert feedback.

Return strict JSON only (no markdown fences) with this exact schema:
{
  "score": number,
  "ats_score": number,
  "structure_score": number,
  "summary": "string",
  "strengths": ["string"],
  "improvements": ["string"]
}

Rules:
- score: overall integer 0..100
- ats_score: keyword relevance & ATS compatibility, integer 0..100
- structure_score: layout, clarity & formatting, integer 0..100
- strengths: 3-6 bullet points
- improvements: 3-6 bullet points
- Use ONLY facts present in source resume. Do not invent companies, dates, titles, metrics, education, certificates, or skills.
- Write summary, strengths, and improvements in ${feedbackLanguage}.`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropicCvScoreModel,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Source resume text:\n${sourceText}` }],
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic CV review failed: ${response.status} ${errText}`);
  }

  const payload = await response.json();
  const raw = Array.isArray(payload?.content)
    ? payload.content.find((item) => item?.type === 'text')?.text || ''
    : '';
  if (!raw.trim()) throw new Error('Anthropic response is empty');

  const jsonText = extractFirstJsonObject(raw);
  const parsed = JSON.parse(jsonText);
  const clamp = (n) => Math.min(100, Math.max(0, n));
  const scoreRaw = Number.parseInt(String(parsed?.score ?? ''), 10);
  const score = Number.isFinite(scoreRaw) ? clamp(scoreRaw) : null;
  const atsScore = clamp(Number.parseInt(String(parsed?.ats_score ?? ''), 10) || scoreRaw);
  const structureScore = clamp(Number.parseInt(String(parsed?.structure_score ?? ''), 10) || scoreRaw);
  const summary = String(parsed?.summary || '').trim();
  const strengths = Array.isArray(parsed?.strengths)
    ? parsed.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const improvements = Array.isArray(parsed?.improvements)
    ? parsed.improvements.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  if (score == null) throw new Error('Anthropic review score is invalid');
  if (!summary) throw new Error('Anthropic review summary is missing');
  return { score, atsScore, structureScore, summary, strengths, improvements };
}

export async function extractResumeContactsWithAI(resumeText) {
  const text = String(resumeText || '').trim();
  if (!text) return null;
  if (!genAI) {
    console.warn('Resume contacts AI parsing skipped: GEMINI_API_KEY is missing');
    return null;
  }

  const prompt = `Extract candidate contact information from this resume text.
Return strict JSON only (no markdown, no explanations), with this exact shape:
{"name":"string|null","lastName":"string|null","phoneNumber":"string|null","email":"string|null"}
Rules:
- Use only data present in resume text.
- If a field is missing, set it to null.
- Do not invent data.

Resume text:
${text}`;

  const response = await genAI.models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  const raw = response.text?.trim();
  if (!raw) return null;

  const jsonText = extractFirstJsonObject(raw);
  const parsed = JSON.parse(jsonText);
  const normalized = normalizeResumeContacts(parsed);
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export async function fetchScreenlySkillsCatalog() {
  const now = Date.now();
  if (screenlySkillsCache.expiresAt > now && screenlySkillsCache.skills.length > 0) {
    return screenlySkillsCache.skills;
  }

  const response = await fetch(SCREENLY_SKILLS_URL);
  if (!response.ok) {
    throw new Error(`Screenly skills request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const skills = Array.isArray(payload?.skills)
    ? payload.skills
        .map((item) => {
          const id = Number.parseInt(String(item?.id), 10);
          const name = typeof item?.name === 'string' ? item.name.trim() : '';
          return Number.isSafeInteger(id) && id > 0 && name
            ? {
                id,
                name,
                parent: item?.parent ?? null,
                roleName: typeof item?.roleName === 'string' ? item.roleName.trim() : '',
              }
            : null;
        })
        .filter(Boolean)
    : [];

  screenlySkillsCache.skills = skills;
  screenlySkillsCache.expiresAt = now + 5 * 60 * 1000;
  return skills;
}

export async function extractResumeSkillIdsWithAI(resumeText, skillsCatalog) {
  if (!genAI) return [];
  const text = String(resumeText || '').trim();
  if (!text) return [];
  if (!Array.isArray(skillsCatalog) || skillsCatalog.length === 0) return [];

  const allowedSkills = skillsCatalog.map((skill) => `${skill.id}: ${skill.name}`).join('\n');
  const allowedIds = new Set(skillsCatalog.map((skill) => skill.id));
  const prompt = `You analyze resume text and map it to a predefined skills catalog.
Return strict JSON only as an array of integer ids, for example: [4,12,35]
Rules:
- Use only ids from the provided catalog.
- Include only skills clearly supported by the resume text.
- Do not invent skills or ids.
- If unsure, leave the skill out.
- Return only the 2-3 most relevant skills (by strongest evidence in resume text).
- Never return more than 3 skill ids.
- Return [] when no skill is confidently supported.

Allowed skills catalog:
${allowedSkills}

Resume text:
${text}`;

  const response = await genAI.models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  const raw = response.text?.trim();
  if (!raw) return [];

  const jsonText = extractFirstJsonArray(raw);
  const parsed = JSON.parse(jsonText);
  return normalizeSkillIds(parsed).filter((id) => allowedIds.has(id)).slice(0, 3);
}

const RESUME_WORK_AUTH_COUNTRY_TOKENS = ['kazakhstan', 'Russian', 'uzbekistan', 'kyrgyzstan'];

export async function extractResumeWorkAuthCountriesWithAI(resumeText) {
  if (!genAI) return [];
  const text = String(resumeText || '').trim();
  if (!text) return [];

  const allowedList = RESUME_WORK_AUTH_COUNTRY_TOKENS.join(', ');
  const prompt = `Extract countries where this candidate explicitly states they can legally work (work authorization, right to work, work permit, citizenship used for employment).
Return strict JSON only as an array of country tokens, for example: ["kazakhstan","Russian"]
Rules:
- Use ONLY these exact tokens (case-sensitive): ${allowedList}
- Map Kazakhstan -> kazakhstan, Russia -> Russian, Uzbekistan -> uzbekistan, Kyrgyzstan -> kyrgyzstan
- Include a country only if the resume clearly states work authorization, legal right to work, citizenship for employment, or an active work permit there
- Do not guess from location alone, job history alone, or language skills alone
- Return [] when nothing is clearly stated

Resume text:
${text}`;

  const response = await genAI.models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  const raw = response.text?.trim();
  if (!raw) return [];

  const jsonText = extractFirstJsonArray(raw);
  const parsed = JSON.parse(jsonText);
  return normalizeWorkAuthCountries(parsed);
}

const APPLY_PRIORITY_VALUES = new Set(['apply_first', 'good', 'low', 'skip']);
const APPLY_PRIORITY_RESUME_MAX = 9000;
const APPLY_PRIORITY_COMMENT_MAX = 2500;
const APPLY_PRIORITY_JOB_TEXT_MAX = 1200;

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampApplyScore(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function normalizeApplyPriorityRow(raw, allowedJobIds) {
  const jobId = Number.parseInt(String(raw?.jobId ?? raw?.id ?? ''), 10);
  if (!Number.isSafeInteger(jobId) || !allowedJobIds.has(jobId)) return null;
  const priorityRaw = String(raw?.priority || 'good').trim().toLowerCase();
  const priority = APPLY_PRIORITY_VALUES.has(priorityRaw) ? priorityRaw : 'good';
  const score = priority === 'skip' ? 0 : clampApplyScore(raw?.score);
  const justification = String(raw?.justification || raw?.reason || '').trim().slice(0, 500);
  const skipReason =
    priority === 'skip' ? String(raw?.skipReason || raw?.skip_reason || justification || 'Skip per agent notes').trim().slice(0, 300) : null;
  return {
    jobId,
    score,
    priority,
    justification: justification || (priority === 'skip' ? skipReason || 'Skip' : 'No justification provided'),
    skipReason,
  };
}

/**
 * Rank a batch of jobs (<=20) for agent apply priority.
 * @param {{ resumeText: string, searchMode: string, agentComment: string, jobs: Array<{ id: number, title: string, company: string, requirementsText: string }> }}
 */
export async function rankJobsForAgentApplyBatchWithAI({
  resumeText,
  searchMode = 'not_urgent',
  agentComment = '',
  jobs = [],
}) {
  if (!genAI) throw new Error('GEMINI_API_KEY is not configured');
  const resume = compactText(resumeText).slice(0, APPLY_PRIORITY_RESUME_MAX);
  if (!resume) throw new Error('Resume text is empty');
  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  const mode = String(searchMode || 'not_urgent').trim() === 'urgent' ? 'urgent' : 'not_urgent';
  const comment = compactText(agentComment).slice(0, APPLY_PRIORITY_COMMENT_MAX);
  const jobBlocks = jobs
    .map((job) => {
      const id = Number(job.id);
      const title = String(job.title || '').trim();
      const company = String(job.company || '').trim();
      const req = compactText(job.requirementsText).slice(0, APPLY_PRIORITY_JOB_TEXT_MAX);
      return `Job id: ${id}\nTitle: ${title}\nCompany: ${company}\nDescription:\n${req || '(no description)'}`;
    })
    .join('\n\n---\n\n');

  const modeHint =
    mode === 'urgent'
      ? 'Search mode is URGENT: favor roles with strong resume fit that can be applied quickly; prioritize practical near-term wins.'
      : 'Search mode is NOT URGENT: favor the best long-term career fit even if the role is more selective.';

  const prompt = `You are a career agent assistant ranking remote job opportunities for a specific candidate.

Candidate resume (facts only — do not invent credentials):
${resume}

Agent apply preferences for this candidate (free-form notes from the career agent — may include companies to avoid, priority employers, target industries, preferred or excluded roles, current employer, etc.):
${comment || '(none)'}

${modeHint}

Jobs to evaluate:
${jobBlocks}

Return strict JSON only as an array with one object per job id listed above:
[
  {
    "jobId": number,
    "score": number,
    "priority": "apply_first" | "good" | "low" | "skip",
    "justification": "string",
    "skipReason": "string|null"
  }
]

Rules:
- score: integer 0..100 resume-to-job fit based ONLY on resume facts vs job requirements, adjusted by agent apply preferences below
- Use agent apply preferences when scoring and ranking: favor jobs that match priority companies, industries, or roles mentioned; penalize or skip jobs that conflict with exclusions
- priority apply_first: top-tier fit (resume + preferences) and should be applied soon; good: solid fit; low: weak fit; skip: conflicts with preferences (companies/industries/roles to avoid), current employer listed in preferences, or very poor resume fit
- If preferences say to skip or avoid a company, industry, or role type, mark matching jobs priority skip with score 0
- If preferences list priority companies, industries, or roles, boost matching jobs in score and prefer apply_first or good when resume fit is reasonable
- justification: 1-2 short sentences for the agent (plain language); mention preference match or conflict when relevant
- skipReason: required when priority is skip, else null
- Include every job id exactly once
- Do not invent resume facts`;

  const response = await genAI.models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  const raw = response.text?.trim();
  if (!raw) throw new Error('AI response is empty');

  const jsonText = extractFirstJsonArray(raw);
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error('AI ranking response must be an array');

  const allowedJobIds = new Set(jobs.map((j) => Number(j.id)).filter((id) => Number.isSafeInteger(id)));
  const byId = new Map();
  for (const row of parsed) {
    const normalized = normalizeApplyPriorityRow(row, allowedJobIds);
    if (normalized) byId.set(normalized.jobId, normalized);
  }

  return jobs.map((job) => {
    const existing = byId.get(Number(job.id));
    if (existing) return existing;
    return {
      jobId: Number(job.id),
      score: 50,
      priority: 'good',
      justification: 'AI did not return a ranking for this job.',
      skipReason: null,
    };
  });
}
