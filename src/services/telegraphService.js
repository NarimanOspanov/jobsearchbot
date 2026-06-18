import { config } from '../config.js';

const TELEGRAPH_API = 'https://api.telegra.ph';

function sourceGroupLabel(source, applyType, lang) {
  const s = String(source || '').trim().toLowerCase();
  const a = String(applyType || '').trim().toLowerCase();
  if (s === 'linkedin' || a === 'linkedin') return lang === 'ru' ? 'LinkedIn' : 'LinkedIn';
  if (s === 'indeed' || a === 'indeed') return 'Indeed';
  if (s === 'hh' || a === 'hh') return 'HH';
  if (a === 'telegram' || s === 'telegram') return lang === 'ru' ? 'Telegram' : 'Telegram';
  if (a === 'easy_apply' && s === 'linkedin') return 'LinkedIn';
  return lang === 'ru' ? 'Сайты компаний' : 'Company sites';
}

function formatJobLinkLabel(job) {
  const title = String(job?.title || 'Role').trim();
  const company = String(job?.company || '').trim();
  return company ? `${title} at ${company}` : title;
}

function escapeTelegramHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeTelegramHtmlAttr(text) {
  return escapeTelegramHtml(text).replace(/"/g, '&quot;');
}

/**
 * Bulleted clickable job list for Telegram HTML messages.
 * @param {{ jobs: object[], appBaseUrl?: string, maxJobs?: number }}
 */
export function formatTopJobsTelegramHtml({ jobs, appBaseUrl = '', maxJobs = 10 }) {
  const lines = [];
  for (const job of (Array.isArray(jobs) ? jobs : []).slice(0, Math.max(1, maxJobs || 10))) {
    const label = formatJobLinkLabel(job);
    const href = resolveJobPreviewHref(job, appBaseUrl);
    lines.push(
      `- <a href="${escapeTelegramHtmlAttr(href)}">${escapeTelegramHtml(label)}</a>`
    );
  }
  return lines.join('\n\n');
}

export function resolveJobPreviewHref(job, appBaseUrl) {
  const applyUrl = String(job?.applyUrl || '').trim();
  if (applyUrl) return applyUrl;
  const base = String(appBaseUrl || '').replace(/\/$/, '');
  const jobId = Number.parseInt(String(job?.id ?? ''), 10);
  if (base && Number.isSafeInteger(jobId) && jobId > 0) {
    return `${base}/app/seeker-jobs-deeplink?jobId=${encodeURIComponent(String(jobId))}`;
  }
  return base ? `${base}/app/seeker-jobs` : 'https://t.me/apply_jobs_bot?start=jobsearch';
}

/**
 * @param {{ jobs: object[], lang?: string, dateFrom: string, dateTo: string, appBaseUrl?: string }}
 */
export function buildTopJobsTelegraphContent({ jobs, lang = 'en', dateFrom, dateTo, appBaseUrl = '' }) {
  const nodes = [{ tag: 'p', children: [`${dateFrom} — ${dateTo}`] }];
  const groups = new Map();

  for (const job of Array.isArray(jobs) ? jobs : []) {
    const key = sourceGroupLabel(job?.source, job?.applyType, lang);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }

  for (const [heading, groupJobs] of groups) {
    nodes.push({ tag: 'h4', children: [heading] });
    for (const job of groupJobs) {
      nodes.push({
        tag: 'p',
        children: [
          {
            tag: 'a',
            attrs: { href: resolveJobPreviewHref(job, appBaseUrl) },
            children: [formatJobLinkLabel(job)],
          },
        ],
      });
    }
  }

  return nodes;
}

function normalizeTelegraphTokenList(tokens) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(tokens) ? tokens : [tokens]) {
    const token = String(raw || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * @param {string | null | undefined} accessToken
 * @param {string[] | null | undefined} accessTokens
 */
export function resolveTelegraphAccessTokens(accessToken = null, accessTokens = null) {
  if (Array.isArray(accessTokens) && accessTokens.length) {
    return normalizeTelegraphTokenList(accessTokens);
  }
  const explicit = String(accessToken || '').trim();
  if (explicit) return [explicit];
  return normalizeTelegraphTokenList(config.telegraphTokens);
}

async function createTelegraphPageWithToken({ token, title, contentNodes, path = null }) {
  const payload = {
    access_token: token,
    title: String(title || 'Top matches').slice(0, 256),
    content: JSON.stringify(Array.isArray(contentNodes) ? contentNodes : []),
    author_name: '',
    author_url: '',
  };
  if (path) payload.path = String(path).slice(0, 256);

  const res = await fetch(`${TELEGRAPH_API}/createPage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data?.ok) {
    throw new Error(data?.error || 'Telegraph createPage failed');
  }
  return data.result;
}

/**
 * @param {{
 *   title: string,
 *   contentNodes: object[],
 *   path?: string | null,
 *   accessToken?: string | null,
 *   accessTokens?: string[] | null,
 * }}
 */
export async function createTelegraphPage({
  title,
  contentNodes,
  path = null,
  accessToken = null,
  accessTokens = null,
}) {
  const tokens = resolveTelegraphAccessTokens(accessToken, accessTokens);
  if (!tokens.length) throw new Error('TELEGRAPH_TOKEN is not configured');

  const errors = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    try {
      return await createTelegraphPageWithToken({ token, title, contentNodes, path });
    } catch (err) {
      const message = err?.message || String(err);
      errors.push({ index: index + 1, error: message });
      if (index < tokens.length - 1) {
        console.warn(`Telegraph token ${index + 1}/${tokens.length} failed, trying next:`, message);
      }
    }
  }

  throw new Error(
    `Telegraph createPage failed for all ${tokens.length} token(s): ${errors.map((row) => row.error).join('; ')}`
  );
}
