import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { Sequelize } from 'sequelize';
import PDFDocument from 'pdfkit';
import { PDFParse } from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { models, sequelize } from './db.js';
import { createResumeStorage } from './services/resumeStorage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const START_INTRO_MESSAGE = [
  'Что умеет бот',
  '',
  'Привет! Меня зовут Ayala, я ваш персональный карьерный агент.',
  '',
  'Я помогаю в двух направлениях:',
  '1) Каждый день ищу global remote вакансии и публикую их в Telegram-канале.',
  '2) Хотите делегировать отклики? Я откликаюсь от вашего лица.',
].join('\n');
const ABOUT_MESSAGE = [
  'Забудьте про поиск работы вручную.',
  '',
  'У вас будет личный карьерный агент.',
  'Мы используем гибридную модель: человек-агент + ИИ.',
  '',
  'Что это значит на практике:',
  '- ИИ ищет релевантные remote вакансии и готовит отклики',
  '- Человек-агент проверяет качество и помогает там, где нужна ручная работа',
  '',
  'Если у сайта или бирж труда есть политика против автооткликов,',
  'или есть риск блокировки за автоматизацию — отклик делает человек-агент.',
  '',
  'Если таких ограничений нет, отклик отправляет ИИ-агент.',
  '',
  'Вы получаете скорость ИИ и надежность ручной проверки в одном процессе.',
  '',
  'Когда от вас потребуется действие, мы сразу напишем.',
  '',
  'Отчеты о проделанных откликах всегда доступны в разделе мои отклики',
].join('\n');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Keeps Telegram «печатает…» alive for long waits (action expires ~after 5s). */
async function withTypingTelegram(telegram, chatId, ms) {
  const pulse = () => telegram.sendChatAction(chatId, 'typing').catch(() => { });
  pulse();
  const id = setInterval(pulse, 4000);
  try {
    await sleep(ms);
  } finally {
    clearInterval(id);
  }
}

/** @type {Map<number, { step: string }>} */
const hireAgentStateByChatId = new Map();
/** @type {Set<number>} */
const legacyKeyboardClearedByChatId = new Set();

const HIRE_AGENT_FAKE_QUEUE = [
  { role: 'Backend Engineer', company: 'Deel' },
  { role: 'Fullstack Engineer', company: 'GitLab' },
  { role: 'Data Engineer', company: 'Zapier' },
  { role: 'DevOps Engineer', company: 'Canonical' },
  { role: 'Software Engineer', company: 'Automattic' },
  { role: 'Product Engineer', company: 'PostHog' },
  { role: 'ML Engineer', company: 'Apollo' },
  { role: 'Frontend Engineer', company: 'ClickUp' },
  { role: 'Platform Engineer', company: 'Circle' },
  { role: 'Security Engineer', company: '1Password' },
];
const resumeStorage = createResumeStorage(config);
const genAI = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;
const HIRE_AGENT_SIMULATION_CONFIG_KEY = 'hireAgentSimulationVisible';

/** doneThroughIndex: rows with j <= index are ✅ (green); the rest ⬜. Use -1 so all are ⬜. */
function formatHireAgentFullList(doneThroughIndex) {
  return HIRE_AGENT_FAKE_QUEUE.map((p, j) => {
    const mark = j <= doneThroughIndex ? '✅' : '⬜';
    return `${mark} ${p.role} · ${p.company}`;
  }).join('\n');
}

async function runHireAgentFakeApplying(ctx, chatId) {
  await withTypingTelegram(ctx.telegram, chatId, 500 + Math.floor(Math.random() * 500));
  const pendingPreview = formatHireAgentFullList(-1);
  const statusMsg = await ctx.reply(
    `⏳ Запускаю автоматические отклики…\nСтатус: подготовка\n\nВакансии (${HIRE_AGENT_FAKE_QUEUE.length}):\n${pendingPreview}`
  );
  const mid = statusMsg.message_id;
  const api = ctx.telegram;

  for (let i = 0; i < HIRE_AGENT_FAKE_QUEUE.length; i++) {
    const current = HIRE_AGENT_FAKE_QUEUE[i];
    const listBlock = formatHireAgentFullList(i);
    const text =
      `Статус: отправка отклика…\n` +
      `Сейчас: ${current.role} — ${current.company}\n\n` +
      listBlock;
    await api.editMessageText(chatId, mid, undefined, text).catch(() => { });
    await withTypingTelegram(api, chatId, 900 + Math.floor(Math.random() * 700));
  }

  const allChecked = formatHireAgentFullList(HIRE_AGENT_FAKE_QUEUE.length - 1);
  await api
    .editMessageText(
      chatId,
      mid,
      undefined,
      `✅ Первая партия откликов завершена (демо).\n\n${allChecked}`
    )
    .catch(() => { });

  await ctx.reply(
    'Я откликнулся на первые 10 позиций. Резюме и сопроводительные письма были адаптированы под каждую вакансию.\n\n' +
    'Проверьте почту — возможно, уже есть письма от работодателей.\n\n' +
    'Чтобы продолжить, купите подписку.',
    {
      reply_markup: {
        inline_keyboard: [[{ text: 'Продолжить', callback_data: 'hireagent_continue' }]],
      },
    }
  );
  hireAgentStateByChatId.set(chatId, { step: 'idle' });
}

function parseConfigBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

async function ensureHireAgentSimulationVisibleConfig() {
  const fallback = false;
  if (!models.Configs) return fallback;
  try {
    let row = await models.Configs.findOne({ where: { Key: HIRE_AGENT_SIMULATION_CONFIG_KEY } });
    if (!row) {
      row = await models.Configs.create({
        Key: HIRE_AGENT_SIMULATION_CONFIG_KEY,
        Value: String(fallback),
        Description: 'Controls demo simulation flow in /hireagent after CV upload',
        UpdatedAt: new Date(),
      });
    }
    return parseConfigBoolean(row.Value, fallback);
  } catch (err) {
    console.error('Failed to read Configs.hireAgentSimulationVisible; fallback=false:', err?.message || err);
    return fallback;
  }
}

function checkEnvLoaded() {
  const token = config.telegramBotToken;
  console.log('Env check:');
  console.log(
    '  TELEGRAM_BOT_TOKEN:',
    token ? `${token.slice(0, 8)}...${token.slice(-4)} (length ${token.length})` : 'MISSING'
  );
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN must be set.');
  if (!config.geminiApiKey) {
    console.warn('GEMINI_API_KEY is missing; tailored resume API will fail.');
  }
  if (!config.azureStorageConnectionString) {
    console.warn('AZURE_STORAGE_CONNECTION_STRING is missing; resume uploads in /hireagent will fail.');
  }
}

function buildTailoredResumePrompt({ jobTitle, jobDescription, mainResumeText }) {
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

async function generateTailoredResumeMarkdown({ jobTitle, jobDescription, mainResumeText }) {
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

async function generateCoverLetterText({ jobTitle, jobDescription, mainResumeText }) {
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

async function markdownToPdfBuffer(markdownText) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  // Use Unicode-capable fonts to avoid Cyrillic mojibake in generated PDFs.
  const regularFontPath = 'C:/Windows/Fonts/arial.ttf';
  const boldFontPath = 'C:/Windows/Fonts/arialbd.ttf';
  const hasUnicodeFonts = existsSync(regularFontPath) && existsSync(boldFontPath);
  if (hasUnicodeFonts) {
    doc.registerFont('resume-regular', regularFontPath);
    doc.registerFont('resume-bold', boldFontPath);
    doc.font('resume-regular');
  } else {
    doc.font('Helvetica');
  }

  const titleFont = hasUnicodeFonts ? 'resume-bold' : 'Helvetica-Bold';
  const bodyFont = hasUnicodeFonts ? 'resume-regular' : 'Helvetica';
  const bodyWidth = 500;
  const sectionTitles = new Set([
    'Professional Summary',
    'Core Competencies',
    'Relevant Experience',
    'Education',
    'Certifications',
    'Skills',
  ]);

  const lines = String(markdownText || '').replace(/\r\n/g, '\n').split('\n');
  let lineIndex = 0;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      doc.moveDown(0.45);
      lineIndex += 1;
      continue;
    }

    // Top block: candidate name + contacts.
    if (lineIndex === 0) {
      doc.font(titleFont).fontSize(18).fillColor('#111111').text(trimmed, { width: bodyWidth });
      doc.moveDown(0.2);
      lineIndex += 1;
      continue;
    }
    if (lineIndex === 1) {
      doc.font(bodyFont).fontSize(11).fillColor('#1f2937').text(trimmed, { width: bodyWidth });
      doc.moveDown(0.5);
      lineIndex += 1;
      continue;
    }

    const isBoldHeading = /^\*\*.+\*\*$/.test(trimmed);
    if (isBoldHeading || sectionTitles.has(trimmed)) {
      const headingText = isBoldHeading ? trimmed.replace(/^\*\*|\*\*$/g, '') : trimmed;
      doc
        .font(titleFont)
        .fontSize(13)
        .fillColor('#0f172a')
        .text(headingText, { width: bodyWidth, underline: true });
      doc.moveDown(0.25);
      lineIndex += 1;
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const bulletText = trimmed.replace(/^[-*•]\s+/, '');
      doc
        .font(bodyFont)
        .fontSize(10.8)
        .fillColor('#111111')
        .text(`• ${bulletText}`, { width: bodyWidth, indent: 14, lineGap: 2 });
      lineIndex += 1;
      continue;
    }

    // Role/company/date style line.
    if (trimmed.includes('/') && trimmed.length <= 140) {
      doc.font(titleFont).fontSize(11.3).fillColor('#111111').text(trimmed, { width: bodyWidth });
      doc.moveDown(0.15);
      lineIndex += 1;
      continue;
    }

    doc
      .font(bodyFont)
      .fontSize(10.8)
      .fillColor('#111111')
      .text(trimmed, { width: bodyWidth, lineGap: 2 });
    lineIndex += 1;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

async function extractResumeTextFromUrl(resumeUrl) {
  const response = await fetch(resumeUrl);
  if (!response.ok) throw new Error(`Failed to download resume by URL: ${response.status}`);
  const mime = (response.headers.get('content-type') || '').toLowerCase();
  const bytes = await response.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (mime.includes('pdf') || resumeUrl.toLowerCase().endsWith('.pdf')) {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return (parsed.text || '').trim();
    } finally {
      await parser.destroy();
    }
  }
  if (mime.includes('text/') || resumeUrl.toLowerCase().endsWith('.txt')) {
    return buffer.toString('utf8').trim();
  }
  throw new Error('Resume format is not supported for text extraction; provide PDF or TXT resume.');
}

function extractFirstJsonObject(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('```')) {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) return fenceMatch[1].trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return text;
}

function normalizeResumeContacts(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const name = toStringOrUndefined(raw.name, 120);
  const lastName = toStringOrUndefined(raw.lastName, 120);
  const phoneNumber = toStringOrUndefined(raw.phoneNumber, 120);
  const email = toStringOrUndefined(raw.email, 254);
  const normalized = {};
  if (name) normalized.name = name;
  if (lastName) normalized.lastName = lastName;
  if (phoneNumber) normalized.phoneNumber = phoneNumber;
  if (email) normalized.email = email;
  return normalized;
}

function parseResumeContactsJson(jsonValue) {
  if (!jsonValue || typeof jsonValue !== 'string') return {};
  try {
    const parsed = JSON.parse(jsonValue);
    return normalizeResumeContacts(parsed);
  } catch {
    return {};
  }
}

async function extractResumeContactsWithAI(resumeText) {
  if (!genAI) return null;
  const text = String(resumeText || '').trim();
  if (!text) return null;

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

function buildAdminUserContactProjection(user) {
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

function toBoolOrUndefined(value) {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function toSearchModeOrUndefined(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'urgent' || normalized === 'not_urgent') return normalized;
  return undefined;
}

function toIntOrNullOrUndefined(value) {
  if (value == null || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function toScoreOrNullOrUndefined(value) {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return undefined;
  if (n < 0 || n > 99.9) return undefined;
  return Math.round(n * 10) / 10;
}

function toStringOrUndefined(value, maxLen = 255) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function toValidUrlOrUndefined(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function isValidTelegramWebAppUrl(urlValue) {
  if (!urlValue) return false;
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== 'https:') return false;
    const host = (parsed.hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    return true;
  } catch {
    return false;
  }
}

function verifyInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = createHmac('sha256', 'WebAppData').update(config.telegramBotToken).digest();
    const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (expected !== hash) return null;

    const userStr = params.get('user');
    return userStr ? JSON.parse(userStr) : {};
  } catch {
    return null;
  }
}

async function ensureUserByTelegramId(telegramId, username = null, firstName = null, lastName = null) {
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
    await user.update({
      TelegramUserName: username,
      FirstName: firstName,
      LastName: lastName,
    });
  }
  return { user, wasCreated };
}

async function ensureUser(ctx) {
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  const username = ctx.from?.username ?? null;
  const firstName = ctx.from?.first_name ?? null;
  const lastName = ctx.from?.last_name ?? null;
  return ensureUserByTelegramId(chatId, username, firstName, lastName);
}

/** Deletes Applications rows then User for the given Telegram chat id. */
async function removeUserDataByTelegramChatId(telegramChatId) {
  return sequelize.transaction(async (transaction) => {
    const user = await models.Users.findOne({
      where: { TelegramChatId: telegramChatId },
      transaction,
    });
    if (!user) return { ok: true, found: false, applicationsDeleted: 0 };
    const applicationsDeleted = await models.Applications.destroy({
      where: { UserId: user.Id },
      transaction,
    });
    await user.destroy({ transaction });
    return { ok: true, found: true, applicationsDeleted };
  });
}

function pickResumeSourceFromMessage(message) {
  if (!message) return null;
  if (message.document?.file_id) {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name || null,
      mimeType: message.document.mime_type || 'application/octet-stream',
    };
  }
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    if (!largest?.file_id) return null;
    return {
      fileId: largest.file_id,
      fileName: `resume-${largest.file_unique_id || largest.file_id}.jpg`,
      mimeType: 'image/jpeg',
    };
  }
  return null;
}

async function downloadTelegramFileAsBuffer(telegram, fileId) {
  const fileUrl = await telegram.getFileLink(fileId);
  const response = await fetch(fileUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

async function miniAppAuth(req, res, next) {
  const initData = req.headers['x-init-data'];

  if (!initData && process.env.NODE_ENV !== 'production') {
    const fallbackId = Number(req.headers['x-dev-telegram-id']);
    if (Number.isSafeInteger(fallbackId) && fallbackId > 0) {
      req.miniAppUser = { id: fallbackId, username: req.headers['x-dev-username'] || null };
      return next();
    }
  }

  if (!initData) return res.status(401).json({ error: 'Unauthorized' });
  const user = verifyInitData(initData);
  if (!user || !user.id) return res.status(403).json({ error: 'Forbidden' });
  req.miniAppUser = user;
  return next();
}

async function adminMiniAppAuth(req, res, next) {
  await miniAppAuth(req, res, async () => {
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) return res.status(403).json({ error: 'Admin mode is disabled' });
    const userId = Number(req.miniAppUser?.id);
    if (!Number.isSafeInteger(userId) || !adminIds.has(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  });
}

function registerHandlers(bot, appBaseUrl, options = {}) {
  const hireAgentSimulationVisible = Boolean(options.hireAgentSimulationVisible);
  const applicationsUrl = appBaseUrl ? `${appBaseUrl}/app/applications` : '';
  const profileUrl = appBaseUrl ? `${appBaseUrl}/app/profile` : '';
  const companiesUrl = appBaseUrl ? `${appBaseUrl}/app/companies` : '';
  const adminUrl = appBaseUrl ? `${appBaseUrl}/app/admin` : '';
  const adminCompaniesUrl = appBaseUrl ? `${appBaseUrl}/app/admin/companies` : '';
  const canUseApplicationsWebApp = isValidTelegramWebAppUrl(applicationsUrl);
  const canUseProfileWebApp = isValidTelegramWebAppUrl(profileUrl);
  const canUseCompaniesWebApp = isValidTelegramWebAppUrl(companiesUrl);
  const canUseAdminWebApp = isValidTelegramWebAppUrl(adminUrl);
  const canUseAdminCompaniesWebApp = isValidTelegramWebAppUrl(adminCompaniesUrl);
  const startAvatarPath = join(__dirname, '..', 'avatar.png');
  const startKeyboard = {
    inline_keyboard: [
      [{ text: 'Телеграм Канал с удалёнкой', url: 'https://t.me/digitalnomadsrelocation' }],
      [{ text: 'Узнать больше про делегирование откликов', callback_data: 'start_hireagent_info' }],
    ],
  };

  const formatUserDisplayName = (user) => {
    const fullName = [user?.FirstName, user?.LastName]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ');
    return fullName || 'Не указано';
  };

  const formatUsername = (raw, { withAt = true } = {}) => {
    const usernameRaw = String(raw || '').trim();
    if (!usernameRaw) return 'нет';
    if (!withAt) return usernameRaw.replace(/^@/, '');
    return usernameRaw.startsWith('@') ? usernameRaw : `@${usernameRaw}`;
  };

  const notifyAdmins = async (ctx, message, errorLabel, telemetry = {}) => {
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) return;
    for (const adminId of adminIds) {
      await ctx.telegram.sendMessage(adminId, message).catch((err) => {
        console.error(errorLabel, {
          adminId,
          ...telemetry,
          error: err?.message || err,
        });
      });
    }
  };

  const startHireAgentScenario = async (ctx) => {
    const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat;
    if (chat?.type !== 'private') {
      await ctx.reply('Этот сценарий доступен только в личном чате с ботом.');
      return;
    }
    if (ctx.callbackQuery) await withTypingTelegram(ctx.telegram, chat.id, 700);
    hireAgentStateByChatId.set(chat.id, { step: 'awaiting_cv' });
    await ctx.reply(
      'Отправьте резюме файлом (PDF или изображение) — я разберу его и начну работу.\n' +
      'Когда потребуются действия, я напишу.'
    );
  };

  const tryRemoveLegacyKeyboard = async (ctx) => {
    const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat;
    if (chat?.type !== 'private') return;
    const chatId = chat?.id ?? ctx.from?.id;
    if (!chatId || legacyKeyboardClearedByChatId.has(chatId)) return;
    try {
      const cleanupMessage = await ctx.telegram.sendMessage(chatId, '\u2060', {
        reply_markup: { remove_keyboard: true },
      });
      if (cleanupMessage?.message_id) {
        await ctx.telegram.deleteMessage(chatId, cleanupMessage.message_id).catch(() => { });
      }
      legacyKeyboardClearedByChatId.add(chatId);
    } catch (err) {
      console.error('Failed to remove legacy keyboard:', err?.message || err);
    }
  };

  bot.use(async (ctx, next) => {
    await tryRemoveLegacyKeyboard(ctx);
    return next();
  });

  bot.use(async (ctx, next) => {
    try {
      const { user, wasCreated } = await ensureUser(ctx);
      ctx.state.isFirstTimeUser = wasCreated;
      if (wasCreated && user) {
        const totalUsers = await models.Users.count();
        const message = [
          '🔔 Новый пользователь присоединился!',
          `Имя: ${formatUserDisplayName(user)}`,
          `Username: ${formatUsername(user.TelegramUserName, { withAt: true })}`,
          `ChatId: ${user.TelegramChatId}`,
          `Всего пользователей: ${totalUsers}`,
        ].join('\n');
        await notifyAdmins(
          ctx,
          message,
          'Failed to send new-user admin notification:',
          { telegramChatId: user.TelegramChatId }
        );
      }
    } catch (err) {
      console.error('ensureUser error:', err);
    }
    return next();
  });

  // Show "typing..." for all slash commands.
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    if (ctx.chat?.id && typeof text === 'string' && text.trim().startsWith('/')) {
      await withTypingTelegram(ctx.telegram, ctx.chat.id, 700);
    }
    return next();
  });

  bot.start(async (ctx) => {
    if (existsSync(startAvatarPath)) {
      await ctx.replyWithPhoto(
        { source: startAvatarPath },
        {
          caption: START_INTRO_MESSAGE,
          reply_markup: startKeyboard,
        }
      );
      return;
    }
    await ctx.reply(START_INTRO_MESSAGE, { reply_markup: startKeyboard });
  });

  bot.command('applications', async (ctx) => {
    if (canUseApplicationsWebApp) {
      await ctx.reply('Мои отклики', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Applications', web_app: { url: applicationsUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Applications page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  });

  bot.command('hireagent', async (ctx) => {
    await startHireAgentScenario(ctx);
  });

  bot.action('start_hireagent', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    await startHireAgentScenario(ctx);
  });

  bot.action('start_hireagent_info', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (chatId) await withTypingTelegram(ctx.telegram, chatId, 700);
    await ctx.reply(ABOUT_MESSAGE, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Отправить резюме и попробовать', callback_data: 'start_hireagent' }]],
      },
    });
  });

  bot.action('hireagent_yes', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    if (!hireAgentSimulationVisible) {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { });
      await ctx.reply('Симуляция откликов сейчас отключена. Мы сообщим вам по результатам проверки резюме.');
      return;
    }
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) return;
    const st = hireAgentStateByChatId.get(chatId);
    if (st?.step !== 'awaiting_confirm') {
      await ctx.reply('Сначала пройдите шаг с резюме в диалоге с агентом (/hireagent).');
      return;
    }
    hireAgentStateByChatId.set(chatId, { step: 'applying' });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { });
    await runHireAgentFakeApplying(ctx, chatId);
  });

  bot.action('hireagent_no', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    if (!hireAgentSimulationVisible) {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { });
      return;
    }
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) return;
    const st = hireAgentStateByChatId.get(chatId);
    if (st?.step !== 'awaiting_confirm') return;
    hireAgentStateByChatId.set(chatId, { step: 'idle' });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { });
    await ctx.reply('Хорошо. Когда будете готовы — снова выберите «Делегировать отклики» в меню.');
  });

  bot.action('hireagent_continue', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
  });

  bot.on(['document', 'photo'], async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const chatId = ctx.chat.id;
    const st = hireAgentStateByChatId.get(chatId);
    if (st?.step !== 'awaiting_cv') return next();
    const resumeSource = pickResumeSourceFromMessage(ctx.message);
    if (!resumeSource) {
      await ctx.reply('Не удалось распознать файл резюме. Отправьте PDF или изображение еще раз.');
      return;
    }
    try {
      await ctx.reply('Спасибо! Загружаю и анализирую резюме…');
      await withTypingTelegram(ctx.telegram, chatId, 1200 + Math.floor(Math.random() * 600));

      const fileBuffer = await downloadTelegramFileAsBuffer(ctx.telegram, resumeSource.fileId);
      const resumeUrl = await resumeStorage.uploadResumeBuffer({
        chatId,
        fileId: resumeSource.fileId,
        fileName: resumeSource.fileName,
        mimeType: resumeSource.mimeType,
        buffer: fileBuffer,
      });

      const { user } = await ensureUserByTelegramId(
        chatId,
        ctx.from?.username ?? null,
        ctx.from?.first_name ?? null,
        ctx.from?.last_name ?? null
      );
      let resumeContactsJson = null;
      try {
        const resumeText = await extractResumeTextFromUrl(resumeUrl);
        const resumeContacts = await extractResumeContactsWithAI(resumeText);
        if (resumeContacts) resumeContactsJson = JSON.stringify(resumeContacts);
      } catch (parseErr) {
        console.warn('Resume contact extraction failed, keeping upload flow:', parseErr?.message || parseErr);
      }
      await user.update({ ResumeURL: resumeUrl, ResumeContactsJson: resumeContactsJson });
      const totalWithResume = await models.Users.count({
        where: {
          ResumeURL: {
            [Sequelize.Op.ne]: null,
          },
        },
      });
      const resumeUploadMessage = [
        '📄 CV Пользователь загрузил резюме',
        `Имя: ${formatUserDisplayName(user)}`,
        `Username: ${formatUsername(user.TelegramUserName, { withAt: false })}`,
        `ChatId: ${user.TelegramChatId}`,
        `Всего пользователей загрузило: ${totalWithResume}`,
        `URL: ${resumeUrl}`,
      ].join('\n');
      await notifyAdmins(
        ctx,
        resumeUploadMessage,
        'Failed to send CV upload admin notification:',
        { telegramChatId: user.TelegramChatId }
      );

      await withTypingTelegram(ctx.telegram, chatId, 800 + Math.floor(Math.random() * 400));
      if (hireAgentSimulationVisible) {
        hireAgentStateByChatId.set(chatId, { step: 'awaiting_confirm' });
        await ctx.reply(
          'Готово. Я сохранил ваше резюме и нашёл 263 вакансии с полной удалёнкой (100%), которые вам подходят.\n\n' +
          'Запустить автоматические отклики?',
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Да, начинай', callback_data: 'hireagent_yes' },
                  { text: 'Нет, позже', callback_data: 'hireagent_no' },
                ],
              ],
            },
          }
        );
      } else {
        hireAgentStateByChatId.set(chatId, { step: 'idle' });
        await ctx.reply('Резюме принято. Мы передали его на проверку — свяжемся с вами с обратной связью.');
      }
    } catch (err) {
      console.error('hireagent resume upload failed:', err);
      await ctx.reply(
        'Не удалось сохранить резюме. Проверьте настройки Azure Storage (AZURE_STORAGE_CONNECTION_STRING) и попробуйте снова.'
      );
      hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv' });
    }
  });

  bot.command('profile', async (ctx) => {
    if (canUseProfileWebApp) {
      await ctx.reply('Открыть настройки:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Настройки', web_app: { url: profileUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Страница настроек требует публичный HTTPS WEBHOOK_URL/ADMIN_APP_URL (не localhost).');
  });

  bot.command('about', async (ctx) => {
    await ctx.reply(ABOUT_MESSAGE);
  });

  bot.command('companies', async (ctx) => {
    if (canUseCompaniesWebApp) {
      await ctx.reply('Открыть компании с удалёнкой:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Компании с удалёнкой', web_app: { url: companiesUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Страница компаний требует публичный HTTPS WEBHOOK_URL/ADMIN_APP_URL (не localhost).');
  });

  bot.command('admin', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Admin panel is available only in private chat.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size > 0 && (!ctx.from?.id || !adminIds.has(ctx.from.id))) {
      await ctx.reply('Unauthorized.');
      return;
    }
    if (canUseAdminWebApp) {
      await ctx.reply('Open admin panel:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Admin Panel', web_app: { url: adminUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Admin page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  });

  const openAdminCompanies = async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Admin companies page is available only in private chat.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size > 0 && (!ctx.from?.id || !adminIds.has(ctx.from.id))) {
      await ctx.reply('Unauthorized.');
      return;
    }
    if (canUseAdminCompaniesWebApp) {
      await ctx.reply('Open admin companies:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Admin Companies', web_app: { url: adminCompaniesUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Admin companies page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  };

  bot.command('admin_companies', async (ctx) => {
    await openAdminCompanies(ctx);
  });

  bot.hears(/^\/admin-companies(?:@\w+)?$/, async (ctx) => {
    await openAdminCompanies(ctx);
  });

  bot.command('stat', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('This command only works in a private chat with the bot.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) {
      await ctx.reply('This command is disabled. Set BOT_ADMIN_TELEGRAM_IDS in the server environment.');
      return;
    }
    const fromId = ctx.from?.id;
    if (!fromId || !adminIds.has(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    await ctx.reply('Открыть статистику импорта вакансий:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть статистику', url: 'https://screenly.work/JobStat?period=1' }]],
      },
    });
  });

  bot.command('removeuser', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('This command only works in a private chat with the bot.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) {
      await ctx.reply('This command is disabled. Set BOT_ADMIN_TELEGRAM_IDS in the server environment.');
      return;
    }
    const fromId = ctx.from?.id;
    if (!fromId || !adminIds.has(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    const text = (ctx.message?.text || '').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const arg = parts[1];
    if (!arg || !/^-?\d+$/.test(arg)) {
      await ctx.reply('Usage: /removeuser <telegramChatId>');
      return;
    }
    const targetChatId = Number(arg);
    if (!Number.isSafeInteger(targetChatId)) {
      await ctx.reply('Chat id is not a valid integer.');
      return;
    }
    try {
      const result = await removeUserDataByTelegramChatId(targetChatId);
      console.log('removeuser:', { adminTelegramId: fromId, targetChatId, ...result });
      if (!result.found) {
        await ctx.reply(`No user found for chat id ${targetChatId}.`);
        return;
      }
      await ctx.reply(
        `Removed user ${targetChatId} and ${result.applicationsDeleted} application(s).`
      );
    } catch (err) {
      console.error('removeuser failed:', err);
      await ctx.reply('Failed to remove user data. Check server logs.');
    }
  });

  bot.on('text', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const cmd = ctx.message?.entities?.[0];
    if (cmd?.type === 'bot_command' && cmd.offset === 0) return next();
    const st = hireAgentStateByChatId.get(ctx.chat.id);
    if (st?.step === 'awaiting_cv') {
      await ctx.reply('Пожалуйста, отправьте резюме файлом (PDF или изображение), а не текстом.');
      return;
    }
    return next();
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });
}

async function main() {
  process.stdout.write('App: main() started\n');
  const port = process.env.PORT || 3000;

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) => res.status(200).send('OK'));
  app.use('/app', express.static(join(__dirname, '..', 'public', 'app')));
  app.get('/app/applications', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'applications.html'));
  });
  app.get('/app/profile', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'profile.html'));
  });
  app.get('/app/companies', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'companies.html'));
  });
  app.get('/app/admin/companies', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'admin-companies.html'));
  });
  app.get('/app/admin', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'admin.html'));
  });
  app.get('/app/stat', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'stats.html'));
  });

  let runtimeBotUsername = '';
  app.get('/api/app/bot-info', (_req, res) => res.json({ botUsername: runtimeBotUsername }));

  app.get('/api/admin/job-import-stats', async (req, res) => {
    try {
      const periodRaw = String(req.query.period || '7').trim();
      const period = /^\d+$/.test(periodRaw)
        ? Math.min(365, Math.max(1, Number.parseInt(periodRaw, 10)))
        : 7;
      const url = `https://screenly.work/api/global-remote-positions/job-import-stats?period=${encodeURIComponent(period)}`;
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

  app.get('/api/admin/skills', async (_req, res) => {
    try {
      const response = await fetch('https://screenly.work/api/all-skills');
      if (!response.ok) return res.status(response.status).json({ error: 'Failed to load skills from Screenly' });
      const payload = await response.json();
      return res.json(payload);
    } catch (err) {
      console.error('GET /api/admin/skills:', err);
      return res.status(500).json({ error: 'Failed to load skills' });
    }
  });

  app.get('/api/admin/positions', async (req, res) => {
    try {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const skillId = String(req.query.skillId || '').trim();
      const sourceRaw = String(req.query.source || '').trim();
      const source = sourceRaw && sourceRaw.toLowerCase() !== 'all' ? sourceRaw : '';
      const pageRaw = Number.parseInt(String(req.query.page || '1'), 10);
      const pageSizeRaw = Number.parseInt(String(req.query.pageSize || '100'), 10);
      const page = Number.isSafeInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
      const pageSize = Number.isSafeInteger(pageSizeRaw) && pageSizeRaw > 0
        ? Math.min(200, pageSizeRaw)
        : 100;
      if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
      const url =
        `https://screenly.work/api/global-remote-positions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        (skillId ? `&skillIds=${encodeURIComponent(skillId)}` : '') +
        (source ? `&source=${encodeURIComponent(source)}` : '') +
        `&page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`;
      const response = await fetch(url);
      if (!response.ok) {
        const txt = await response.text();
        return res.status(response.status).json({ error: txt || 'Failed to load positions from Screenly' });
      }
      const payload = await response.json();
      if (
        Object.prototype.hasOwnProperty.call(payload || {}, 'page') ||
        Object.prototype.hasOwnProperty.call(payload || {}, 'hasMore')
      ) {
        const upstreamPositions = Array.isArray(payload?.positions) ? payload.positions : [];
        return res.json({
          ...payload,
          page: Number(payload.page || page),
          pageSize: Number(payload.pageSize || pageSize),
          hasMore: Boolean(payload.hasMore),
          count: Number(payload.count || upstreamPositions.length),
          positions: upstreamPositions,
        });
      }
      const all = Array.isArray(payload?.positions) ? payload.positions : [];
      const offset = (page - 1) * pageSize;
      const pageItems = all.slice(offset, offset + pageSize);
      const hasMore = offset + pageItems.length < all.length;
      return res.json({
        ...payload,
        page,
        pageSize,
        hasMore,
        count: pageItems.length,
        positions: pageItems,
      });
    } catch (err) {
      console.error('GET /api/admin/positions:', err);
      return res.status(500).json({ error: 'Failed to load positions' });
    }
  });

  app.get('/api/app/admin/users/:id/resume-text', async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const user = await models.Users.findByPk(id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.ResumeURL) return res.status(404).json({ error: 'Resume URL is not set for this user' });
      const resumeText = await extractResumeTextFromUrl(user.ResumeURL);
      if (!resumeText) return res.status(422).json({ error: 'Could not extract resume text' });
      return res.json({ userId: id, resumeUrl: user.ResumeURL, resumeText });
    } catch (err) {
      console.error('GET /api/app/admin/users/:id/resume-text:', err);
      return res.status(500).json({ error: 'Failed to extract resume text' });
    }
  });

  app.post('/api/tailored-resume', async (req, res) => {
    try {
      const jobTitle = String(req.body?.jobTitle || '').trim();
      const jobDescription = String(req.body?.jobDescription || '').trim();
      const mainResumeText = String(req.body?.mainResumeText || '').trim();
      if (!jobTitle || !jobDescription || !mainResumeText) {
        return res.status(400).json({
          error: 'jobTitle, jobDescription, and mainResumeText are required',
        });
      }

      const markdown = await generateTailoredResumeMarkdown({
        jobTitle,
        jobDescription,
        mainResumeText,
      });
      const pdfBuffer = await markdownToPdfBuffer(markdown);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="tailored-resume.pdf"');
      return res.status(200).send(pdfBuffer);
    } catch (err) {
      console.error('POST /api/tailored-resume:', err);
      return res.status(500).json({ error: 'Failed to generate tailored resume PDF' });
    }
  });

  app.post('/api/tailored-resume/upload', async (req, res) => {
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
        return res.status(400).json({
          error: 'jobTitle, jobDescription, and mainResumeText are required',
        });
      }

      const markdown = await generateTailoredResumeMarkdown({ jobTitle, jobDescription, mainResumeText });
      const pdfBuffer = await markdownToPdfBuffer(markdown);
      const tailoredCvUrl = await resumeStorage.uploadTailoredResumeBuffer({
        seekerId,
        screenlyJobId,
        fileName: `tailored-cv-${screenlyJobId}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });

      return res.status(200).json({ tailoredCvUrl, markdown });
    } catch (err) {
      console.error('POST /api/tailored-resume/upload:', err);
      return res.status(500).json({ error: 'Failed to generate/upload tailored resume' });
    }
  });

  app.post('/api/cover-letter', async (req, res) => {
    try {
      const jobTitle = String(req.body?.jobTitle || '').trim();
      const jobDescription = String(req.body?.jobDescription || '').trim();
      const mainResumeText = String(req.body?.mainResumeText || '').trim();
      if (!jobTitle || !jobDescription || !mainResumeText) {
        return res.status(400).json({
          error: 'jobTitle, jobDescription, and mainResumeText are required',
        });
      }

      const coverLetter = await generateCoverLetterText({
        jobTitle,
        jobDescription,
        mainResumeText,
      });
      return res.status(200).json({ coverLetter });
    } catch (err) {
      console.error('POST /api/cover-letter:', err);
      return res.status(500).json({ error: 'Failed to generate cover letter' });
    }
  });

  app.get('/api/app/profile', miniAppAuth, async (req, res) => {
    try {
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      res.json({
        id: user.Id,
        telegramChatId: String(user.TelegramChatId),
        telegramUserName: user.TelegramUserName,
        resumeUrl: user.ResumeURL,
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

  app.patch('/api/app/profile/settings', miniAppAuth, async (req, res) => {
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

      const updates = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => typeof v === 'boolean' || typeof v === 'string' || v === null || typeof v === 'number')
      );
      if (Object.keys(updates).length > 0) await user.update(updates);

      res.json({
        ok: true,
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

  app.get('/api/app/applications', async (req, res) => {
    try {
      let userId = Number.parseInt(String(req.query.userId || ''), 10);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        await miniAppAuth(req, res, async () => {
          const { user } = await ensureUserByTelegramId(
            req.miniAppUser.id,
            req.miniAppUser.username ?? null,
            req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
            req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
          );
          userId = user.Id;
        });
        if (!Number.isSafeInteger(userId) || userId <= 0) return;
      }
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.Applications.findAll({
        where: {
          UserId: userId,
          [Sequelize.Op.and]: Sequelize.where(
            Sequelize.fn('lower', Sequelize.col('Status')),
            'applied'
          ),
        },
        order: [['Id', 'DESC']],
        limit,
        offset,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/applications:', err);
      res.status(500).json({ error: 'Failed to load applications' });
    }
  });

  app.get('/api/app/applications/by-user', async (req, res) => {
    try {
      const userId = Number.parseInt(String(req.query.userId), 10);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId is required and must be a positive integer' });
      }
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.Applications.findAll({
        where: { UserId: userId },
        order: [['AppliedAt', 'DESC'], ['Id', 'DESC']],
        limit,
        offset,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/applications/by-user:', err);
      res.status(500).json({ error: 'Failed to load applications by user' });
    }
  });

  app.post('/api/app/applications', async (req, res) => {
    try {
      const userId = Number.parseInt(String(req.body.userId), 10);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId is required and must be a positive integer' });
      }
      const user = await models.Users.findByPk(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const screenlyJobId = toIntOrNullOrUndefined(req.body.screenlyJobId);
      if (screenlyJobId === undefined || screenlyJobId === null) {
        return res.status(400).json({ error: 'screenlyJobId is required and must be a non-negative integer' });
      }
      const existing = await models.Applications.findOne({
        where: { UserId: user.Id, ScreenlyJobId: screenlyJobId },
      });
      if (existing) return res.status(200).json(existing);

      const vacancyTitle = String(req.body.vacancyTitle || '').trim();

      const row = await models.Applications.create({
        UserId: user.Id,
        VacancyTitle: (vacancyTitle || `Screenly #${screenlyJobId}`).slice(0, 255),
        CompanyName: req.body.companyName ? String(req.body.companyName).slice(0, 255) : null,
        Source: req.body.source ? String(req.body.source).slice(0, 50) : null,
        Status: req.body.status ? String(req.body.status).slice(0, 50) : 'applied',
        AppliedAt: req.body.appliedAt ? new Date(req.body.appliedAt) : new Date(),
        Notes: req.body.notes ? String(req.body.notes) : null,
        MetaJson: req.body.metaJson ? JSON.stringify(req.body.metaJson) : null,
        Score: toScoreOrNullOrUndefined(req.body.score),
        ScreenlyJobId: screenlyJobId,
        TailoredCVURL: toStringOrUndefined(req.body.tailoredCvUrl, 2048) ?? null,
        CoverLetter: req.body.coverLetter == null ? null : String(req.body.coverLetter),
      });

      res.status(201).json(row);
    } catch (err) {
      console.error('POST /api/app/applications:', err);
      res.status(500).json({ error: 'Failed to create application' });
    }
  });

  app.patch('/api/app/applications/:id', async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.Applications.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Application not found' });

      const updates = {};

      if (typeof req.body.vacancyTitle === 'string') {
        const v = req.body.vacancyTitle.trim();
        if (!v) return res.status(400).json({ error: 'vacancyTitle cannot be empty' });
        updates.VacancyTitle = v.slice(0, 255);
      }
      if (req.body.companyName !== undefined) {
        updates.CompanyName = req.body.companyName ? String(req.body.companyName).slice(0, 255) : null;
      }
      if (req.body.source !== undefined) {
        updates.Source = req.body.source ? String(req.body.source).slice(0, 50) : null;
      }
      if (req.body.status !== undefined) {
        updates.Status = req.body.status ? String(req.body.status).slice(0, 50) : null;
      }
      if (req.body.appliedAt !== undefined) {
        if (req.body.appliedAt == null || req.body.appliedAt === '') {
          updates.AppliedAt = new Date();
        } else {
          const d = new Date(req.body.appliedAt);
          if (!Number.isFinite(d.getTime())) return res.status(400).json({ error: 'Invalid appliedAt' });
          updates.AppliedAt = d;
        }
      }
      if (req.body.notes !== undefined) {
        updates.Notes = req.body.notes ? String(req.body.notes) : null;
      }
      if (req.body.metaJson !== undefined) {
        updates.MetaJson = req.body.metaJson ? JSON.stringify(req.body.metaJson) : null;
      }
      if (req.body.score !== undefined) {
        const score = toScoreOrNullOrUndefined(req.body.score);
        if (score === undefined) return res.status(400).json({ error: 'Invalid score' });
        updates.Score = score;
      }
      if (req.body.screenlyJobId !== undefined) {
        const screenlyJobId = toIntOrNullOrUndefined(req.body.screenlyJobId);
        if (screenlyJobId === undefined) return res.status(400).json({ error: 'Invalid screenlyJobId' });
        updates.ScreenlyJobId = screenlyJobId;
      }
      if (req.body.tailoredCvUrl !== undefined) {
        updates.TailoredCVURL = toStringOrUndefined(req.body.tailoredCvUrl, 2048) ?? null;
      }
      if (req.body.coverLetter !== undefined) {
        updates.CoverLetter = req.body.coverLetter == null ? null : String(req.body.coverLetter);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      await row.update(updates);
      res.json(row);
    } catch (err) {
      console.error('PATCH /api/app/applications/:id:', err);
      res.status(500).json({ error: 'Failed to update application' });
    }
  });

  app.get('/api/app/companies', miniAppAuth, async (_req, res) => {
    try {
      const rows = await models.RemoteCompanies.findAll({
        order: [['DateAdded', 'DESC'], ['Id', 'DESC']],
        limit: 500,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/companies:', err);
      res.status(500).json({ error: 'Failed to load companies' });
    }
  });

  app.get('/api/app/admin/companies', adminMiniAppAuth, async (_req, res) => {
    try {
      const rows = await models.RemoteCompanies.findAll({
        order: [['DateAdded', 'DESC'], ['Id', 'DESC']],
        limit: 1000,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/admin/companies:', err);
      res.status(500).json({ error: 'Failed to load admin companies' });
    }
  });

  app.get('/api/app/admin/users', async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.Users.findAll({
        order: [['DateJoined', 'DESC'], ['Id', 'DESC']],
        limit,
        offset,
      });
      res.json(rows.map((u) => {
        const projection = buildAdminUserContactProjection(u);
        return {
          id: u.Id,
          telegramChatId: String(u.TelegramChatId),
          telegramUserName: u.TelegramUserName,
          firstName: u.FirstName || null,
          lastName: u.LastName || null,
          dateJoined: u.DateJoined,
          isBlocked: !!u.IsBlocked,
          resumeUrl: u.ResumeURL || null,
          ...projection,
        };
      }));
    } catch (err) {
      console.error('GET /api/app/admin/users:', err);
      res.status(500).json({ error: 'Failed to load users' });
    }
  });

  app.get('/api/app/admin/users/:id', async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

      const u = await models.Users.findByPk(id);
      if (!u) return res.status(404).json({ error: 'User not found' });

      res.json({
        id: u.Id,
        telegramChatId: String(u.TelegramChatId),
        telegramUserName: u.TelegramUserName,
        firstName: u.FirstName || null,
        lastName: u.LastName || null,
        dateJoined: u.DateJoined,
        isBlocked: !!u.IsBlocked,
        muteBotUntil: u.MuteBotUntil,
        timezone: u.Timezone,
        promocode: u.Promocode,
        resumeUrl: u.ResumeURL || null,
        settings: {
          hhEnabled: !!u.HhEnabled,
          linkedInEnabled: !!u.LinkedInEnabled,
          indeedEnabled: !!u.IndeedEnabled,
          telegramEnabled: !!u.TelegramEnabled,
          companySitesEnabled: !!u.CompanySitesEnabled,
          emailFoundersEnabled: !!u.EmailFoundersEnabled,
          emailRecruitersEnabled: !!u.EmailRecruitersEnabled,
          searchMode: u.SearchMode || 'not_urgent',
          minimumSalary: u.MinimumSalary,
          remoteOnly: !!u.RemoteOnly,
        },
        ...buildAdminUserContactProjection(u),
      });
    } catch (err) {
      console.error('GET /api/app/admin/users/:id:', err);
      res.status(500).json({ error: 'Failed to load user' });
    }
  });

  app.post('/api/app/admin/companies', adminMiniAppAuth, async (req, res) => {
    try {
      const name = toStringOrUndefined(req.body.name, 255);
      const url = toValidUrlOrUndefined(req.body.url);
      if (!name || !url) return res.status(400).json({ error: 'name and valid url are required' });
      const notes = toStringOrUndefined(req.body.notes, 1000);
      const row = await models.RemoteCompanies.create({
        Name: name,
        Url: url,
        Notes: notes ?? null,
        DateAdded: Sequelize.literal('GETUTCDATE()'),
      });
      res.status(201).json(row);
    } catch (err) {
      console.error('POST /api/app/admin/companies:', err);
      res.status(500).json({ error: 'Failed to create company' });
    }
  });

  app.patch('/api/app/admin/companies/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.RemoteCompanies.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Company not found' });

      const updates = {};
      const name = toStringOrUndefined(req.body.name, 255);
      const url = toValidUrlOrUndefined(req.body.url);
      if (name) updates.Name = name;
      if (url) updates.Url = url;
      if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) {
        if (req.body.notes == null || String(req.body.notes).trim() === '') {
          updates.Notes = null;
        } else {
          const notes = toStringOrUndefined(req.body.notes, 1000);
          if (!notes) {
            return res.status(400).json({ error: 'notes must be a non-empty string up to 1000 characters' });
          }
          updates.Notes = notes;
        }
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'At least one valid field is required' });
      }
      await row.update(updates);
      res.json(row);
    } catch (err) {
      console.error('PATCH /api/app/admin/companies/:id:', err);
      res.status(500).json({ error: 'Failed to update company' });
    }
  });

  app.delete('/api/app/admin/companies/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const deleted = await models.RemoteCompanies.destroy({ where: { Id: id } });
      if (!deleted) return res.status(404).json({ error: 'Company not found' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/app/admin/companies/:id:', err);
      res.status(500).json({ error: 'Failed to delete company' });
    }
  });

  await new Promise((resolve) => app.listen(port, resolve));
  console.log('HTTP server listening on port', port);

  try {
    checkEnvLoaded();
  } catch (err) {
    console.error('Env error:', err.message);
    return;
  }

  const bot = new Telegraf(config.telegramBotToken, { handlerTimeout: 300_000 });
  console.log('Checking Telegram connection (getMe)...');

  try {
    const me = await bot.telegram.getMe();
    runtimeBotUsername = me?.username || '';
    console.log('Telegram OK.', runtimeBotUsername ? `@${runtimeBotUsername}` : '(username not set)');
  } catch (err) {
    console.error('Cannot reach Telegram:', err.message);
    return;
  }

  const appBaseUrl = (process.env.ADMIN_APP_URL || config.webhookUrl || '').replace(/\/$/, '');
  const hireAgentSimulationVisible = await ensureHireAgentSimulationVisibleConfig();
  registerHandlers(bot, appBaseUrl, { hireAgentSimulationVisible });

  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Что умеет бот' },
      { command: 'applications', description: 'Мои отклики' },
      { command: 'hireagent', description: 'Делегировать отклики' },
      { command: 'profile', description: 'Настройки' },
      { command: 'companies', description: 'Компании с удалёнкой' },
      { command: 'about', description: 'О боте' },
    ]);
  } catch (err) {
    console.error('Failed to set menu commands:', err.message);
  }

  if (config.isProduction) {
    app.use(bot.webhookCallback('/'));
    const webhookUrl = config.webhookUrl.replace(/\/$/, '');
    console.log('Setting webhook:', webhookUrl);
    try {
      await bot.telegram.setWebhook(webhookUrl);
      console.log('Webhook set. Bot is ready.');
    } catch (err) {
      console.error('Failed to set webhook:', err.message);
    }
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch();
    console.log('Polling started. Bot is ready.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
