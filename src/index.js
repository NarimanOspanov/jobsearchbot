import { createHmac, randomUUID } from 'node:crypto';
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
  'Привет',
  '',
  'Получи доступ к вакансиям на 100% удалёнку',
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

async function runWithTyping(telegram, chatId, work) {
  const pulse = () => telegram.sendChatAction(chatId, 'typing').catch(() => { });
  pulse();
  const id = setInterval(pulse, 4000);
  try {
    return await work();
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
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const HIRE_AGENT_SIMULATION_CONFIG_KEY = 'hireAgentSimulationVisible';
// Configs key: free job-details opens before channel subscription gate starts (0 = disabled).
const JOB_DETAILS_SUBSCRIBE_GATE_CONFIG_KEY = 'JobDetailsOpensBeforeSubscribeGate';
const FREE_JOB_OPENS_MONTHLY_LIMIT_CONFIG_KEY = 'FreeJobOpensMonthlyLimit';
const CHANNEL_SUBSCRIBE_BONUS_OPENS_CONFIG_KEY = 'ChannelSubscribeBonusOpens';
const REFERRAL_BONUS_OPENS_CONFIG_KEY = 'ReferralBonusOpens';
const SCREENLY_SKILLS_URL = 'https://screenly.work/api/all-skills';
const DIGITAL_NOMADS_CHANNEL_URL = 'https://t.me/+0zv_MNh22Xw3NTMy';
const screenlySkillsCache = {
  expiresAt: 0,
  skills: [],
};
let runtimeBotTelegram = null;
const cvScoreResultByUserId = new Map();
const adminNotificationRunControl = {
  activeRunId: null,
  stopRequestedRunIds: new Set(),
};

const FALLBACK_PLANS = [
  {
    Id: 1,
    Code: 'silver',
    Name: 'Silver',
    PriceInStars: 500,
    PriceUsd: 10,
    DurationDays: 30,
    JobOpenMonthlyLimit: 300,
    IncludesAiTools: false,
    IsActive: true,
    SortOrder: 10,
  },
  {
    Id: 2,
    Code: 'gold',
    Name: 'Gold',
    PriceInStars: 1000,
    PriceUsd: 20,
    DurationDays: 30,
    JobOpenMonthlyLimit: 1000,
    IncludesAiTools: true,
    IsActive: true,
    SortOrder: 20,
  },
];

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

function parseConfigInt(value, fallback = 0) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n)) return fallback;
  return n;
}

async function getConfigInt(key, fallback = 0) {
  const safeFallback = Number.isSafeInteger(fallback) ? fallback : 0;
  if (!models.Configs) return safeFallback;
  try {
    const row = await models.Configs.findOne({ where: { Key: key } });
    if (!row) return safeFallback;
    return parseConfigInt(row.Value, safeFallback);
  } catch (err) {
    console.error(`Failed to read Configs.${key}; fallback=${safeFallback}:`, err?.message || err);
    return safeFallback;
  }
}

async function getJobDetailsSubscribeGateN() {
  return Math.max(0, await getConfigInt(JOB_DETAILS_SUBSCRIBE_GATE_CONFIG_KEY, 0));
}

function getMonthBoundsUtc(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function normalizePriceUsd(value) {
  const n = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function formatUsd(amount) {
  const normalized = normalizePriceUsd(amount);
  if (!normalized) return '';
  return `$${normalized.toFixed(2)}`;
}

function formatPlanPrice(stars, usd) {
  const starsAmount = Number(stars || 0);
  const usdText = formatUsd(usd);
  return usdText ? `${starsAmount} ⭐ (~${usdText})` : `${starsAmount} ⭐`;
}

function toPlanSummary(plan) {
  if (!plan) return null;
  const monthlyOpens = Number(plan.JobOpenMonthlyLimit || 0);
  const durationDays = Number(plan.DurationDays || 30);
  const includesAiTools = Boolean(plan.IncludesAiTools);
  const priceUsd = normalizePriceUsd(plan.PriceUsd);
  return {
    id: Number(plan.Id || 0),
    code: String(plan.Code || '').toLowerCase(),
    name: String(plan.Name || ''),
    priceInStars: Number(plan.PriceInStars || 0),
    priceUsd,
    durationDays,
    jobOpenMonthlyLimit: monthlyOpens,
    includesAiTools,
    description:
      `${monthlyOpens} открытий вакансий в месяц на ${durationDays} дней. ` +
      `${formatPlanPrice(plan.PriceInStars, priceUsd)}. ` +
      `${includesAiTools ? 'Включает AI CV + Cover Letter.' : 'AI CV + Cover Letter не включены.'}`,
    sortOrder: Number(plan.SortOrder || 0),
  };
}

async function getActivePlans() {
  if (!models.Plans) return FALLBACK_PLANS.map((plan) => ({ ...plan }));
  try {
    const rows = await models.Plans.findAll({
      where: { IsActive: true },
      order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
    });
    if (!rows || rows.length === 0) return FALLBACK_PLANS.map((plan) => ({ ...plan }));
    return rows.map((row) => row.get({ plain: true }));
  } catch (err) {
    console.warn('Failed to load Plans, using fallback:', err?.message || err);
    return FALLBACK_PLANS.map((plan) => ({ ...plan }));
  }
}

async function getPlanByCode(planCode) {
  const normalized = String(planCode || '').trim().toLowerCase();
  if (!normalized) return null;
  const plans = await getActivePlans();
  return plans.find((plan) => String(plan.Code || '').trim().toLowerCase() === normalized) || null;
}

async function getPlanById(planId) {
  const id = Number.parseInt(String(planId), 10);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const plans = await getActivePlans();
  return plans.find((plan) => Number(plan.Id) === id) || null;
}

async function getActiveSubscriptionForUser(userId, now = new Date()) {
  if (!models.UserSubscriptions || !userId) return null;
  try {
    const row = await models.UserSubscriptions.findOne({
      where: {
        UserId: userId,
        Status: 'active',
        StartsAt: { [Sequelize.Op.lte]: now },
        EndsAt: { [Sequelize.Op.gt]: now },
      },
      order: [['EndsAt', 'DESC'], ['Id', 'DESC']],
    });
    return row || null;
  } catch (err) {
    console.warn('Failed to load active UserSubscription:', err?.message || err);
    return null;
  }
}

async function getUserBonusOpensTotal(userId) {
  if (!models.UserBonusOpens || !userId) return 0;
  try {
    const rows = await models.UserBonusOpens.findAll({
      where: { UserId: userId },
      attributes: ['OpensGranted'],
    });
    return rows.reduce((acc, row) => acc + Math.max(0, Number(row.OpensGranted || 0)), 0);
  } catch (err) {
    console.warn('Failed to load UserBonusOpens:', err?.message || err);
    return 0;
  }
}

async function ensureChannelSubscribeBonus(userId) {
  if (!models.UserBonusOpens || !userId) return 0;
  const bonusOpens = Math.max(0, await getConfigInt(CHANNEL_SUBSCRIBE_BONUS_OPENS_CONFIG_KEY, 20));
  if (bonusOpens <= 0) return 0;
  try {
    const [row, created] = await models.UserBonusOpens.findOrCreate({
      where: { UserId: userId, Source: 'required_channels_join', Note: 'auto-bonus-v1' },
      defaults: {
        UserId: userId,
        Source: 'required_channels_join',
        OpensGranted: bonusOpens,
        Note: 'auto-bonus-v1',
        CreatedAt: new Date(),
      },
    });
    return created ? Number(row.OpensGranted || 0) : 0;
  } catch (err) {
    console.warn('Failed to grant channel subscribe bonus:', err?.message || err);
    return 0;
  }
}

async function grantReferralBonusToReferrer(referrerUserId, referredUserId) {
  if (!models.UserBonusOpens || !referrerUserId || !referredUserId) return 0;
  const bonusOpens = Math.max(0, await getConfigInt(REFERRAL_BONUS_OPENS_CONFIG_KEY, 10));
  if (bonusOpens <= 0) return 0;
  try {
    const note = `referred-user-${referredUserId}`;
    const [row, created] = await models.UserBonusOpens.findOrCreate({
      where: {
        UserId: referrerUserId,
        Source: 'referral_invite',
        Note: note,
      },
      defaults: {
        UserId: referrerUserId,
        Source: 'referral_invite',
        OpensGranted: bonusOpens,
        Note: note,
        CreatedAt: new Date(),
      },
    });
    return created ? Number(row.OpensGranted || 0) : 0;
  } catch (err) {
    console.warn('Failed to grant referral bonus:', err?.message || err);
    return 0;
  }
}

async function getUserMonthlyOpenUsage(userId, now = new Date()) {
  if (!models.JobDetailsOpens || !userId) return 0;
  const { start, end } = getMonthBoundsUtc(now);
  try {
    const opens = await models.JobDetailsOpens.count({
      where: {
        UserId: userId,
        CreatedAt: {
          [Sequelize.Op.gte]: start,
          [Sequelize.Op.lt]: end,
        },
      },
    });
    return Math.max(0, opens);
  } catch (err) {
    console.warn('Failed to count monthly JobDetailsOpens:', err?.message || err);
    return 0;
  }
}

async function getUserEntitlement(userId, now = new Date()) {
  const [activeSubscription, freeLimitRaw, bonusTotal, plans] = await Promise.all([
    getActiveSubscriptionForUser(userId, now),
    getConfigInt(FREE_JOB_OPENS_MONTHLY_LIMIT_CONFIG_KEY, 100),
    getUserBonusOpensTotal(userId),
    getActivePlans(),
  ]);
  const freeMonthlyLimit = Math.max(0, freeLimitRaw);
  const subscriptionPlan = activeSubscription
    ? plans.find((plan) => Number(plan.Id) === Number(activeSubscription.PlanId)) || null
    : null;
  const monthlyLimit = subscriptionPlan
    ? Math.max(0, Number(subscriptionPlan.JobOpenMonthlyLimit || 0))
    : freeMonthlyLimit;
  const usedThisMonth = await getUserMonthlyOpenUsage(userId, now);
  const totalAllowance = monthlyLimit + Math.max(0, bonusTotal);
  const remainingOpens = Math.max(0, totalAllowance - usedThisMonth);
  return {
    activeSubscription,
    subscriptionPlan,
    freeMonthlyLimit,
    bonusOpensTotal: Math.max(0, bonusTotal),
    usedThisMonth,
    monthlyLimit,
    totalAllowance,
    remainingOpens,
  };
}

async function canUseAiToolsForUser(userId, now = new Date()) {
  const entitlement = await getUserEntitlement(userId, now);
  if (Number(entitlement?.remainingOpens || 0) > 0) return true;
  const activeSub = entitlement?.activeSubscription || null;
  if (!activeSub) return false;
  const plan = await getPlanById(activeSub.PlanId);
  return Boolean(plan?.IncludesAiTools);
}

async function buildMonetizationStatus(userId, now = new Date()) {
  const [entitlement, activePlans] = await Promise.all([getUserEntitlement(userId, now), getActivePlans()]);
  const planSummary = toPlanSummary(entitlement.subscriptionPlan);
  const plans = activePlans
    .filter((plan) => Boolean(plan?.IsActive))
    .sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0))
    .map((plan) => toPlanSummary(plan));
  return {
    activePlan: planSummary,
    subscriptionEndsAt: entitlement.activeSubscription?.EndsAt || null,
    usedThisMonth: entitlement.usedThisMonth,
    monthlyLimit: entitlement.monthlyLimit,
    bonusOpensTotal: entitlement.bonusOpensTotal,
    totalAllowance: entitlement.totalAllowance,
    remainingOpens: entitlement.remainingOpens,
    canUseAiTools: Boolean(planSummary?.includesAiTools) || Number(entitlement?.remainingOpens || 0) > 0,
    freeMonthlyLimit: entitlement.freeMonthlyLimit,
    plans,
  };
}

function parseStartPayload(ctx) {
  const rawText = String(ctx.message?.text || '').trim();
  const commandMatch = rawText.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  if (!commandMatch) return '';
  return String(commandMatch[1] || '').trim();
}

function parseStartReferralChatId(startPayload) {
  const payload = String(startPayload || '').trim();
  if (!/^\d+$/.test(payload)) return null;
  const chatId = Number.parseInt(payload, 10);
  return Number.isSafeInteger(chatId) && chatId > 0 ? chatId : null;
}

function parseStartPositionId(startPayload) {
  const payload = String(startPayload || '').trim();
  const match = payload.match(/^apply_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (!match) return null;
  return String(match[1]).toLowerCase();
}

function buildPlanInvoicePayload(plan) {
  return JSON.stringify({
    type: 'monthly_plan',
    planId: Number(plan.Id),
    code: String(plan.Code || '').toLowerCase(),
    version: 1,
  });
}

function normalizeChatId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  return s;
}

async function getMissingRequiredChannelsForUser(telegram, telegramUserId) {
  if (!telegram || !telegramUserId || !models.RequiredChannels) return [];
  const channels = await models.RequiredChannels.findAll({
    where: { IsActive: true },
    order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
  });
  if (!channels || channels.length === 0) return [];

  const okStatuses = new Set(['member', 'administrator', 'creator']);
  const missing = [];
  for (const ch of channels) {
    const chatId = normalizeChatId(ch.ChannelId);
    if (!chatId) {
      missing.push(ch);
      continue;
    }
    try {
      // Bot must be able to call getChatMember for this channel (usually bot added as channel admin).
      const member = await telegram.getChatMember(chatId, telegramUserId);
      if (!okStatuses.has(member?.status)) {
        missing.push(ch);
        continue;
      }
    } catch (err) {
      // If Telegram API check fails, require subscription to avoid bypasses.
      console.warn('getChatMember check error:', ch.ChannelId, err?.message || err);
      missing.push(ch);
    }
  }
  return missing;
}

async function ensureRequiredChannelUserRecords(telegramUserId) {
  if (!telegramUserId || !models.RequiredChannels || !models.RequiredChannelUsers) return;
  const channels = await models.RequiredChannels.findAll({
    where: { IsActive: true },
    order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
  });
  if (!channels || channels.length === 0) return;
  for (const ch of channels) {
    try {
      await models.RequiredChannelUsers.findOrCreate({
        where: { ChannelId: String(ch.ChannelId), UserId: String(telegramUserId) },
        defaults: {
          ChannelId: String(ch.ChannelId),
          UserId: String(telegramUserId),
          DateTime: new Date(),
        },
      });
    } catch (e) {
      if (e?.name !== 'SequelizeUniqueConstraintError') {
        console.warn('RequiredChannelUsers upsert error:', e?.message || e);
      }
    }
  }
}

function serializeRequiredChannels(channels) {
  const list = Array.isArray(channels) ? channels : [];
  return list.map((ch) => ({
    channelId: String(ch.ChannelId || ''),
    joinUrl: String(ch.JoinUrl || ''),
  }));
}

async function getRequiredChannelsState(telegramUserId) {
  if (!runtimeBotTelegram) {
    return { ok: false, reason: 'unavailable', channels: [] };
  }
  const missing = await getMissingRequiredChannelsForUser(runtimeBotTelegram, telegramUserId);
  return { ok: missing.length === 0, reason: null, channels: missing };
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
  if (!config.geminiApiKey && !config.anthropicApiKey) {
    console.warn('Both GEMINI_API_KEY and ANTHROPIC_API_KEY are missing; AI resume features will fail.');
  } else if (!config.geminiApiKey) {
    console.warn('GEMINI_API_KEY is missing; some AI features will fallback to Anthropic only.');
  } else if (!config.anthropicApiKey) {
    console.warn('ANTHROPIC_API_KEY is missing; /cvscore will fallback to Gemini.');
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

async function reviewResumeWithAI({ resumeText }) {
  const sourceText = String(resumeText || '').trim();
  if (!sourceText) throw new Error('Resume text is empty');
  if (config.anthropicApiKey) {
    return reviewResumeWithAnthropic({ resumeText: sourceText });
  }
  if (!genAI) throw new Error('Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is configured');
  const prompt = `You are a senior HR expert and ATS resume reviewer.
Task:
1) Review the candidate resume text and provide concise expert feedback.
2) Return a new improved resume text that is clean, flat, structured, and ATS-friendly.

Return strict JSON only (no markdown fences) with this exact schema:
{
  "score": number,
  "summary": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "rewrittenResume": "string"
}

Rules:
- score must be integer 0..100
- strengths: 3-6 bullet points
- improvements: 3-6 bullet points
- rewrittenResume must be plain text resume with clear sections and simple bullets
- Use ONLY facts present in source resume. Do not invent companies, dates, titles, metrics, education, certificates, or skills.
- Keep rewrittenResume ATS-friendly: no tables, no columns, no icons, no links formatting.
- Preserve the same language as source resume.

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
  const scoreRaw = Number.parseInt(String(parsed?.score ?? ''), 10);
  const score = Number.isFinite(scoreRaw) ? Math.min(100, Math.max(0, scoreRaw)) : null;
  const summary = String(parsed?.summary || '').trim();
  const strengths = Array.isArray(parsed?.strengths)
    ? parsed.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const improvements = Array.isArray(parsed?.improvements)
    ? parsed.improvements.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const rewrittenResume = String(parsed?.rewrittenResume || '').trim();
  if (score == null) throw new Error('AI review score is invalid');
  if (!summary) throw new Error('AI review summary is missing');
  if (!rewrittenResume) throw new Error('AI rewritten resume is empty');
  return {
    score,
    summary,
    strengths,
    improvements,
    rewrittenResume,
  };
}

async function reviewResumeWithAnthropic({ resumeText }) {
  const sourceText = String(resumeText || '').trim();
  if (!sourceText) throw new Error('Resume text is empty');
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const systemPrompt = `You are a senior HR expert and ATS resume reviewer.
Task:
1) Review the candidate resume text and provide concise expert feedback.
2) Return a new improved resume text that is clean, flat, structured, and ATS-friendly.

Return strict JSON only (no markdown fences) with this exact schema:
{
  "score": number,
  "summary": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "rewrittenResume": "string"
}

Rules:
- score must be integer 0..100
- strengths: 3-6 bullet points
- improvements: 3-6 bullet points
- rewrittenResume must be plain text resume with clear sections and simple bullets
- Use ONLY facts present in source resume. Do not invent companies, dates, titles, metrics, education, certificates, or skills.
- Keep rewrittenResume ATS-friendly: no tables, no columns, no icons, no links formatting.
- Preserve the same language as source resume.`;

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
  const scoreRaw = Number.parseInt(String(parsed?.score ?? ''), 10);
  const score = Number.isFinite(scoreRaw) ? Math.min(100, Math.max(0, scoreRaw)) : null;
  const summary = String(parsed?.summary || '').trim();
  const strengths = Array.isArray(parsed?.strengths)
    ? parsed.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const improvements = Array.isArray(parsed?.improvements)
    ? parsed.improvements.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const rewrittenResume = String(parsed?.rewrittenResume || '').trim();
  if (score == null) throw new Error('Anthropic review score is invalid');
  if (!summary) throw new Error('Anthropic review summary is missing');
  if (!rewrittenResume) throw new Error('Anthropic rewritten resume is empty');
  return {
    score,
    summary,
    strengths,
    improvements,
    rewrittenResume,
  };
}

async function sendLongTelegramText(telegram, chatId, text, chunkSize = 3500) {
  const value = String(text || '').trim();
  if (!value) return;
  if (value.length <= chunkSize) {
    await telegram.sendMessage(chatId, value);
    return;
  }
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + chunkSize, value.length);
    if (end < value.length) {
      const slice = value.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
      if (lastBreak > Math.floor(chunkSize * 0.5)) {
        end = start + lastBreak + 1;
      }
    }
    const part = value.slice(start, end).trim();
    if (part) await telegram.sendMessage(chatId, part);
    start = end;
  }
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

function extractFirstJsonArray(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('```')) {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) return fenceMatch[1].trim();
  }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return text;
}

function normalizeSkillIds(raw) {
  const items = Array.isArray(raw) ? raw : [];
  return Array.from(
    new Set(
      items
        .map((item) => Number.parseInt(String(item), 10))
        .filter((item) => Number.isSafeInteger(item) && item > 0)
    )
  );
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

async function fetchScreenlySkillsCatalog() {
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

async function extractResumeSkillIdsWithAI(resumeText, skillsCatalog) {
  if (!genAI) return [];
  const text = String(resumeText || '').trim();
  if (!text) return [];
  if (!Array.isArray(skillsCatalog) || skillsCatalog.length === 0) return [];

  const allowedSkills = skillsCatalog
    .map((skill) => `${skill.id}: ${skill.name}`)
    .join('\n');
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
  return normalizeSkillIds(parsed)
    .filter((id) => allowedIds.has(id))
    .slice(0, 3);
}

function runResumeEnrichmentInBackground({ userId, resumeUrl, includeSkills = false }) {
  setTimeout(async () => {
    try {
      console.info('[resume-enrichment] started', { userId, includeSkills });
      const user = await models.Users.findByPk(userId);
      if (!user) return;
      const resumeText = await extractResumeTextFromUrl(resumeUrl);
      const contactsPromise = extractResumeContactsWithAI(resumeText);
      const skillsPromise = includeSkills
        ? fetchScreenlySkillsCatalog()
            .then((skillsCatalog) => extractResumeSkillIdsWithAI(resumeText, skillsCatalog))
            .catch((skillsErr) => {
              console.warn('Resume skills enrichment failed:', skillsErr?.message || skillsErr);
              return [];
            })
        : Promise.resolve([]);
      const [resumeContacts, resumeSkillIds] = await Promise.all([contactsPromise, skillsPromise]);
      const updates = {};
      if (resumeContacts) updates.ResumeContactsJson = JSON.stringify(resumeContacts);
      if (includeSkills && Array.isArray(resumeSkillIds)) updates.skills = resumeSkillIds;
      if (Object.keys(updates).length > 0) {
        await user.update(updates);
        console.info('[resume-enrichment] saved', {
          userId,
          hasContacts: Boolean(updates.ResumeContactsJson),
          skillsCount: Array.isArray(updates.skills) ? updates.skills.length : 0,
        });
      } else {
        console.warn('[resume-enrichment] no parsed data to save', { userId });
      }
    } catch (parseErr) {
      console.warn('Background resume enrichment failed:', parseErr?.message || parseErr);
    }
  }, 0);
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

function toSkillIdsOrNullOrUndefined(value) {
  if (value == null || value === '') return null;
  if (!Array.isArray(value)) return undefined;
  return normalizeSkillIds(value);
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

/** Deletes user-related rows then User for the given Telegram chat id. */
async function removeUserDataByTelegramChatId(telegramChatId) {
  return sequelize.transaction(async (transaction) => {
    const user = await models.Users.findOne({
      where: { TelegramChatId: telegramChatId },
      transaction,
    });
    if (!user) {
      return {
        ok: true,
        found: false,
        applicationsDeleted: 0,
        referralsDeleted: 0,
        telegramPaymentsDeleted: 0,
        userSubscriptionsDeleted: 0,
        userBonusOpensDeleted: 0,
        requiredChannelUsersDeleted: 0,
        searchClicksDeleted: 0,
        jobDetailsOpensDeleted: 0,
        userApplicationsDeleted: 0,
      };
    }
    const applicationsDeleted = await models.Applications.destroy({
      where: { UserId: user.Id },
      transaction,
    });
    const referralsDeleted = models.Referrals
      ? await models.Referrals.destroy({
        where: {
          [Sequelize.Op.or]: [
            { ReferrerUserId: user.Id },
            { ReferredUserId: user.Id },
          ],
        },
        transaction,
      })
      : 0;
    const userSubscriptionsDeleted = models.UserSubscriptions
      ? await models.UserSubscriptions.destroy({
        where: { UserId: user.Id },
        transaction,
      })
      : 0;
    const telegramPaymentsDeleted = models.TelegramPayments
      ? await models.TelegramPayments.destroy({
        where: { UserId: user.Id },
        transaction,
      })
      : 0;
    const userBonusOpensDeleted = models.UserBonusOpens
      ? await models.UserBonusOpens.destroy({
        where: { UserId: user.Id },
        transaction,
      })
      : 0;
    const requiredChannelUsersDeleted = models.RequiredChannelUsers
      ? await models.RequiredChannelUsers.destroy({
        where: { UserId: user.TelegramChatId },
        transaction,
      })
      : 0;
    const searchClicksDeleted = models.SearchClicks
      ? await models.SearchClicks.destroy({
        where: { UserId: user.Id },
        transaction,
      })
      : 0;
    const jobDetailsOpensDeleted = models.JobDetailsOpens
      ? await models.JobDetailsOpens.destroy({
        where: { UserId: user.Id },
        transaction,
      })
      : 0;
    const userApplicationsDeleted = models.UserApplications
      ? await models.UserApplications.destroy({
        where: { UserId: user.Id },
        transaction,
      })
      : 0;
    await user.destroy({ transaction });
    return {
      ok: true,
      found: true,
      applicationsDeleted,
      referralsDeleted,
      telegramPaymentsDeleted,
      userSubscriptionsDeleted,
      userBonusOpensDeleted,
      requiredChannelUsersDeleted,
      searchClicksDeleted,
      jobDetailsOpensDeleted,
      userApplicationsDeleted,
    };
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

function extractMiniAppInitData(req) {
  const fromHeader = req.headers['x-init-data'];
  if (fromHeader) return String(fromHeader);
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth && /^tma\s+/i.test(String(auth))) {
    return String(auth).replace(/^tma\s+/i, '').trim();
  }
  return '';
}

async function miniAppAuth(req, res, next) {
  const initData = extractMiniAppInitData(req);

  if (!initData && process.env.LOG_MINIAPP_AUTH === '1') {
    console.warn('[miniAppAuth] missing init data', {
      path: req.path,
      ua: req.get('user-agent'),
      hasXInitData: Boolean(req.headers['x-init-data']),
      hasAuthorizationTma: Boolean(
        (req.headers.authorization && /^tma\s+/i.test(req.headers.authorization)) ||
          (req.headers.Authorization && /^tma\s+/i.test(req.headers.Authorization))
      ),
    });
  }

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
  const seekerJobsUrl = appBaseUrl ? `${appBaseUrl}/app/seeker-jobs` : '';
  const pricingTmaUrl = appBaseUrl ? `${appBaseUrl}/app/pricing` : '';
  const applicationsUrl = appBaseUrl ? `${appBaseUrl}/app/applications` : '';
  const profileUrl = appBaseUrl ? `${appBaseUrl}/app/profile` : '';
  const companiesUrl = appBaseUrl ? `${appBaseUrl}/app/companies` : '';
  const adminUrl = appBaseUrl ? `${appBaseUrl}/app/admin` : '';
  const adminCompaniesUrl = appBaseUrl ? `${appBaseUrl}/app/admin/companies` : '';
  const adminPositionsUrl = appBaseUrl ? `${appBaseUrl}/app/admin/positions` : '';
  const adminNotificationsUrl = appBaseUrl ? `${appBaseUrl}/app/admin/notifications` : '';
  const stat2Url = appBaseUrl ? `${appBaseUrl}/app/stat2` : '';
  const cvScoreUrl = appBaseUrl ? `${appBaseUrl}/app/cvscore` : '';
  const canUseSeekerJobsWebApp = isValidTelegramWebAppUrl(seekerJobsUrl);
  const canUseApplicationsWebApp = isValidTelegramWebAppUrl(applicationsUrl);
  const canUseProfileWebApp = isValidTelegramWebAppUrl(profileUrl);
  const canUseCompaniesWebApp = isValidTelegramWebAppUrl(companiesUrl);
  const canUsePricingWebApp = isValidTelegramWebAppUrl(pricingTmaUrl);
  const canUseAdminWebApp = isValidTelegramWebAppUrl(adminUrl);
  const canUseAdminCompaniesWebApp = isValidTelegramWebAppUrl(adminCompaniesUrl);
  const canUseAdminPositionsWebApp = isValidTelegramWebAppUrl(adminPositionsUrl);
  const canUseAdminNotificationsWebApp = isValidTelegramWebAppUrl(adminNotificationsUrl);
  const canUseStat2WebApp = isValidTelegramWebAppUrl(stat2Url);
  const canUseCvScoreWebApp = isValidTelegramWebAppUrl(cvScoreUrl);
  const startAvatarPath = join(__dirname, '..', 'avatar.png');
  const notSubscribedImagePath = join(__dirname, '..', 'not_subscribed.png');
  const subscribedImagePath = join(__dirname, '..', 'subscribed.png');
  const startKeyboard = {
    inline_keyboard: [
      [
        canUseSeekerJobsWebApp
          ? { text: 'Открыть вакансии', web_app: { url: seekerJobsUrl } }
          : { text: 'Открыть вакансии', callback_data: 'start_open_jobsearch' },
      ],
    ],
  };
  const START_REQUIRED_CHANNEL_CONFIRM_CALLBACK = 'start_confirm_required_channels';

  const sendStartIntro = async (ctx) => {
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
  };

  const buildStartRequiredChannelsKeyboard = (channels) => {
    const serialized = serializeRequiredChannels(channels);
    const firstJoinUrl = String(serialized[0]?.joinUrl || '').trim();
    const channelButtons = firstJoinUrl ? [[{ text: '✈️ Подписаться на канал', url: firstJoinUrl }]] : [];
    return {
      inline_keyboard: [
        ...channelButtons,
        [{ text: '✅ Я подписался', callback_data: START_REQUIRED_CHANNEL_CONFIRM_CALLBACK }],
      ],
    };
  };

  const sendStartRequiredChannelsGate = async (ctx, channels) => {
    const lines = [
      '<b>Подпишись на канал, для старта</b>',
      '',
      '',
      'Мы фильтруем <b>10 000+ вакансий в день</b> — это требует серьёзных ресурсов. Подписка на канал помогает нам покрывать часть расходов, чтобы сервис оставался максимально доступным для вас.',
    ].filter(Boolean);
    const replyMarkup = buildStartRequiredChannelsKeyboard(channels);
    if (existsSync(notSubscribedImagePath)) {
      await ctx.replyWithPhoto(
        { source: notSubscribedImagePath },
        {
          caption: lines.join('\n'),
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        }
      );
      return;
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: replyMarkup });
  };

  const enforceStartRequiredChannelsGate = async (ctx) => {
    const telegramUserId = Number(ctx.from?.id || ctx.chat?.id || 0);
    if (!telegramUserId) return true;
    const channelsState = await getRequiredChannelsState(telegramUserId);
    if (channelsState.ok) {
      await ensureRequiredChannelUserRecords(telegramUserId);
      return true;
    }
    await sendStartRequiredChannelsGate(ctx, channelsState.channels);
    return false;
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

  const formatPlanButtonLabel = (plan) => {
    const limit = Number(plan?.JobOpenMonthlyLimit || 0);
    const priceLabel = formatPlanPrice(plan?.PriceInStars, plan?.PriceUsd);
    return `${plan?.Name || 'Тариф'} · ${limit} открытий/мес · ${priceLabel}`;
  };

  const sendPlansIntro = async (ctx) => {
    const pricingButton = canUsePricingWebApp
      ? { text: 'Pricing', web_app: { url: pricingTmaUrl } }
      : { text: 'Pricing', callback_data: 'plan_pricing' };
    await ctx.reply(
      'Выберите формат оплаты через Telegram Stars. Нажмите Pricing, чтобы посмотреть доступные тарифы и описание.',
      {
        reply_markup: {
          inline_keyboard: [[pricingButton]],
        },
      }
    );
  };

  const sendPlanMenu = async (ctx) => {
    const plans = (await getActivePlans()).filter((plan) => Boolean(plan?.IsActive));
    if (plans.length === 0) {
      await ctx.reply('Платные тарифы временно недоступны.');
      return;
    }
    const sortedPlans = plans.sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0));
    const detailsText = sortedPlans
      .map((plan) => {
        const monthlyOpens = Number(plan.JobOpenMonthlyLimit || 0);
        const durationDays = Number(plan.DurationDays || 30);
        const aiText = plan.IncludesAiTools
          ? 'AI CV + Cover Letter включены'
          : 'AI CV + Cover Letter не включены';
        return `• ${plan.Name}: ${monthlyOpens} открытий/мес, ${durationDays} дней, ${formatPlanPrice(plan.PriceInStars, plan.PriceUsd)}, ${aiText}`;
      })
      .join('\n');
    const buttons = plans
      .sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0))
      .map((plan) => [{ text: formatPlanButtonLabel(plan), callback_data: `plan_buy_${String(plan.Code || '').toLowerCase()}` }]);
    await ctx.reply(`Pricing plans:\n${detailsText}\n\nВыберите подписку для оплаты в Telegram Stars:`, {
      reply_markup: { inline_keyboard: buttons },
    });
  };

  const resolveBotUsername = async (ctx) => {
    const fromCtx = String(ctx?.botInfo?.username || '').trim();
    if (fromCtx) return fromCtx;
    try {
      const me = await ctx.telegram.getMe();
      return String(me?.username || '').trim();
    } catch {
      return '';
    }
  };

  const sendReferralScreen = async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Команда доступна только в личном чате с ботом.');
      return;
    }
    const { user } = await ensureUserByTelegramId(
      ctx.chat?.id ?? ctx.from?.id,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? null,
      ctx.from?.last_name ?? null
    );
    if (!user) {
      await ctx.reply('Не удалось определить пользователя.');
      return;
    }
    const bonusOpens = Math.max(0, await getConfigInt(REFERRAL_BONUS_OPENS_CONFIG_KEY, 10));
    const invitedCount = models.Referrals
      ? await models.Referrals.count({ where: { ReferrerUserId: user.Id } })
      : 0;
    const botUsername = await resolveBotUsername(ctx);
    const referralLink = botUsername
      ? `https://t.me/${botUsername}?start=${encodeURIComponent(String(user.TelegramChatId || ''))}`
      : '';
    const shareUrl = referralLink
      ? `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Привет! Попробуй бот для поиска удаленной работы:')}`
      : '';
    const lines = [
      `Пригласите друга и получите +${bonusOpens} открытий вакансий.`,
      `Уже приглашено: ${invitedCount}`,
      '',
      referralLink || 'Реферальная ссылка временно недоступна.',
    ];
    const inlineKeyboard = shareUrl
      ? [[{ text: 'Поделиться ссылкой', url: shareUrl }]]
      : [];
    await ctx.reply(lines.join('\n'), {
      disable_web_page_preview: true,
      ...(inlineKeyboard.length > 0 ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
    });
  };

  const processReferralOnStart = async (ctx, invitedUser, startPayload) => {
    if (!invitedUser || !models.Referrals) return;
    const referrerTelegramChatId = parseStartReferralChatId(startPayload);
    if (!referrerTelegramChatId) return;
    if (Number(invitedUser.TelegramChatId) === Number(referrerTelegramChatId)) return;
    try {
      const referrer = await models.Users.findOne({ where: { TelegramChatId: referrerTelegramChatId } });
      if (!referrer || Number(referrer.Id) === Number(invitedUser.Id)) return;

      const [row, created] = await models.Referrals.findOrCreate({
        where: {
          ReferrerUserId: referrer.Id,
          ReferredUserId: invitedUser.Id,
        },
        defaults: {
          ReferrerUserId: referrer.Id,
          ReferredUserId: invitedUser.Id,
          ReferredAt: new Date(),
        },
      });
      if (!created || !row) return;

      const granted = await grantReferralBonusToReferrer(referrer.Id, invitedUser.Id);
      if (granted > 0) {
        await ctx.telegram.sendMessage(
          Number(referrer.TelegramChatId),
          `🎉 Ваш друг запустил бота по вашей ссылке. Начислено +${granted} открытий вакансий.`
        ).catch(() => { });
      }
    } catch (err) {
      console.warn('processReferralOnStart failed:', err?.message || err);
    }
  };

  const sendPlanInvoice = async (ctx, planCode) => {
    const plan = await getPlanByCode(planCode);
    if (!plan || Number(plan.PriceInStars || 0) < 1) {
      await ctx.reply('Этот тариф недоступен для оплаты.');
      return;
    }
    const payload = buildPlanInvoicePayload(plan);
    const monthlyOpens = Number(plan.JobOpenMonthlyLimit || 0);
    const hasAiTools = Boolean(plan.IncludesAiTools);
    const priceLabel = formatPlanPrice(plan.PriceInStars, plan.PriceUsd);
    const title = `${plan.Name} — ${monthlyOpens} открытий/мес — ${priceLabel}`;
    const description =
      `${plan.Name}: ${monthlyOpens} открытий вакансий в месяц на ${Number(plan.DurationDays || 30)} дней. ` +
      `${hasAiTools ? 'Включает инструменты AI CV и Cover Letter. ' : 'Инструменты AI CV и Cover Letter не включены. '}` +
      `Цена: ${priceLabel}. Оплата через Telegram Stars.`;
    try {
      await ctx.telegram.sendInvoice(ctx.chat.id, {
        title,
        description,
        payload,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: `${plan.Name} (${Number(plan.DurationDays || 30)} дней)`, amount: Number(plan.PriceInStars || 0) }],
      });
    } catch (err) {
      const msg = err?.response?.body?.description ?? err?.message ?? String(err);
      console.error('sendInvoice plan error:', msg);
      await ctx.reply(`Не удалось выставить счёт. Попробуйте позже.${msg ? ` (${msg})` : ''}`);
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

  const startPositionApplyScenario = async (ctx, positionId) => {
    const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat;
    if (chat?.type !== 'private') {
      await ctx.reply('Этот сценарий доступен только в личном чате с ботом.');
      return;
    }
    if (!models.Positions) {
      await ctx.reply('Сервис вакансий временно недоступен. Попробуйте позже.');
      return;
    }
    const position = await models.Positions.findByPk(positionId);
    if (!position || position.IsArchived) {
      await ctx.reply('Вакансия не найдена или уже архивирована.');
      return;
    }
    const website = String(position.CompanyWebsite || '').trim();
    const externalApplyUrl = String(position.ExternalApplyURL || '').trim();
    const companyName = String(position.CompanyName || '').trim();
    const externalApplyButtonText = companyName
      ? `Откликнуться на сайте ${companyName}`
      : 'Откликнуться на сайте работодателя';
    const openOtherJobsButton = canUseSeekerJobsWebApp
      ? { text: 'Открыть другие вакансии на 100% удалёнку', web_app: { url: seekerJobsUrl } }
      : { text: 'Открыть другие вакансии на 100% удалёнку', callback_data: 'start_open_jobsearch' };
    const lines = [
      `Вакансия: ${position.Title}`,
      `Компания: ${position.CompanyName}`,
      ...(website ? [`Сайт компании: ${website}`] : []),
      '',
      String(position.Description || '').trim(),
    ];
    if (externalApplyUrl) {
      await ctx.reply(lines.join('\n'), {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: externalApplyButtonText, url: externalApplyUrl }],
            [openOtherJobsButton],
          ],
        },
      });
      return;
    }
    lines.push('', '<b>Чтобы откликнуться, отправьте резюме файлом (PDF или изображение).</b>');
    hireAgentStateByChatId.set(chat.id, { step: 'awaiting_cv_for_position', positionId: position.Id });
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
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
    const payload = parseStartPayload(ctx);
    const positionIdFromStart = parseStartPositionId(payload);
    const canProceedToVacancies = await enforceStartRequiredChannelsGate(ctx);
    if (!canProceedToVacancies) return;
    if (positionIdFromStart) {
      await startPositionApplyScenario(ctx, positionIdFromStart);
      return;
    }
    if (payload === 'jobsearch') {
      await openJobSearchFromBot(ctx);
      return;
    }
    if (payload.startsWith('buy_')) {
      const requestedCode = payload.replace(/^buy_/, '').trim().toLowerCase();
      if (requestedCode) {
        await sendPlanInvoice(ctx, requestedCode);
        return;
      }
    }
    if (payload === 'referrals') {
      await sendReferralScreen(ctx);
      return;
    }
    const { user: invitedUser } = await ensureUserByTelegramId(
      ctx.chat?.id ?? ctx.from?.id,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? null,
      ctx.from?.last_name ?? null
    );
    await processReferralOnStart(ctx, invitedUser, payload);
    await sendStartIntro(ctx);
  });

  bot.action(START_REQUIRED_CHANNEL_CONFIRM_CALLBACK, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    const telegramUserId = Number(ctx.from?.id || ctx.chat?.id || 0);
    if (!telegramUserId) {
      await ctx.reply('Не удалось определить пользователя. Откройте /start еще раз.');
      return;
    }
    const channelsState = await getRequiredChannelsState(telegramUserId);
    if (!channelsState.ok) {
      await sendStartRequiredChannelsGate(ctx, channelsState.channels);
      return;
    }
    await ensureRequiredChannelUserRecords(telegramUserId);
    let grantedBonus = 0;
    try {
      const { user } = await ensureUserByTelegramId(
        telegramUserId,
        ctx.from?.username ?? null,
        ctx.from?.first_name ?? null,
        ctx.from?.last_name ?? null
      );
      grantedBonus = await ensureChannelSubscribeBonus(user?.Id);
    } catch (err) {
      console.warn('Failed to grant start subscription bonus:', err?.message || err);
    }
    const successLines = [
      'Спасибо! Подписка подтверждена.',
      grantedBonus > 0 ? `Начислено +${grantedBonus} открытий вакансий.` : 'Доступ к вакансиям открыт.',
    ];
    if (existsSync(subscribedImagePath)) {
      await ctx.replyWithPhoto({ source: subscribedImagePath }, { caption: successLines.join('\n') });
    } else {
      await ctx.reply(successLines.join('\n'));
    }
    await sendStartIntro(ctx);
  });

  const openJobSearchFromBot = async (ctx) => {
    if (canUseSeekerJobsWebApp) {
      await ctx.reply(
        'Ищите удаленные вакансии, отмечайте релевантные роли и открывайте детали прямо в мини-приложении.',
        {
          reply_markup: {
            inline_keyboard: [[{ text: 'Open job search', web_app: { url: seekerJobsUrl } }]],
          },
        }
      );
      return;
    }
    await ctx.reply('Job search page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  };

  bot.command('jobsearch', async (ctx) => {
    await openJobSearchFromBot(ctx);
  });

  bot.action('start_open_jobsearch', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    await openJobSearchFromBot(ctx);
  });

  bot.command('plans', async (ctx) => {
    await sendPlansIntro(ctx);
  });

  bot.action('plan_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    await sendPlanMenu(ctx);
  });

  bot.action('plan_pricing', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    await sendPlanMenu(ctx);
  });

  bot.action(/^plan_buy_(.+)$/i, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    const code = String(ctx.match?.[1] || '').trim().toLowerCase();
    if (!code) {
      await ctx.reply('Не удалось определить тариф для оплаты.');
      return;
    }
    await sendPlanInvoice(ctx, code);
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

  bot.command('cvscore', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Эта команда доступна только в личном чате с ботом.');
      return;
    }
    const chatId = ctx.chat.id;
    hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv_review' });
    await ctx.reply(
      'Отправьте ваше резюме файлом (PDF/TXT).\n' +
      'Я оценю CV как HR-эксперт, дам комментарии и верну улучшенную ATS-friendly версию.'
    );
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
    const isHireAgentCvFlow = st?.step === 'awaiting_cv';
    const isPositionCvFlow = st?.step === 'awaiting_cv_for_position';
    const isCvReviewFlow = st?.step === 'awaiting_cv_review';
    if (!isHireAgentCvFlow && !isPositionCvFlow && !isCvReviewFlow) return next();
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
      await user.update({ ResumeURL: resumeUrl });
      runResumeEnrichmentInBackground({ userId: user.Id, resumeUrl, includeSkills: true });
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
      if (isCvReviewFlow) {
        const mime = String(resumeSource.mimeType || '').toLowerCase();
        const canExtractText =
          mime.includes('pdf') ||
          mime.includes('text/') ||
          String(resumeSource.fileName || '').toLowerCase().endsWith('.pdf') ||
          String(resumeSource.fileName || '').toLowerCase().endsWith('.txt');
        if (!canExtractText) {
          hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv_review' });
          await ctx.reply('Для CV score сейчас поддерживаются PDF/TXT файлы. Пожалуйста, отправьте резюме в PDF.');
          return;
        }
        await ctx.reply('Провожу HR-анализ и улучшаю структуру резюме…');
        const review = await runWithTyping(ctx.telegram, chatId, async () => {
          const resumeText = await extractResumeTextFromUrl(resumeUrl);
          return reviewResumeWithAI({ resumeText });
        });
        const strengthsText =
          review.strengths.length > 0
            ? review.strengths.map((item) => `- ${item}`).join('\n')
            : '- Сильные стороны не определены.';
        const improvementsText =
          review.improvements.length > 0
            ? review.improvements.map((item) => `- ${item}`).join('\n')
            : '- Рекомендации не определены.';
        const feedbackMessage = [
          `CV score: ${review.score}/100`,
          '',
          `Summary: ${review.summary}`,
          '',
          'Сильные стороны:',
          strengthsText,
          '',
          'Что улучшить:',
          improvementsText,
        ].join('\n');
        await sendLongTelegramText(ctx.telegram, chatId, feedbackMessage);
        const cvScoreResult = {
          name: `${ctx.from?.first_name || ''} ${ctx.from?.last_name || ''}`.trim() || 'Candidate',
          title: 'Resume Review',
          ats_score: review.score,
          grade:
            review.score >= 90 ? 'A+'
              : review.score >= 80 ? 'A'
                : review.score >= 70 ? 'B'
                  : review.score >= 60 ? 'C'
                    : review.score >= 50 ? 'D'
                      : 'F',
          summary: review.summary,
          categories: [
            {
              name: 'ATS & Keywords',
              score: review.score,
              max: 100,
              feedback: review.improvements[0] || 'Improve keyword relevance and role-specific terms.',
            },
            {
              name: 'Structure & Clarity',
              score: review.score,
              max: 100,
              feedback: review.improvements[1] || 'Keep sections concise with measurable outcomes.',
            },
          ],
          strengths: review.strengths,
          critical_fixes: review.improvements,
          roast: review.summary,
        };
        cvScoreResultByUserId.set(String(chatId), cvScoreResult);
        if (canUseCvScoreWebApp) {
          await ctx.reply('Открыть полный отчет CV Score:', {
            reply_markup: {
              inline_keyboard: [[{ text: '📊 Open Full Report', web_app: { url: `${cvScoreUrl}?uid=${chatId}` } }]],
            },
          });
        }
        const enhancedResumePdf = await markdownToPdfBuffer(review.rewrittenResume);
        await ctx.replyWithDocument(
          {
            source: enhancedResumePdf,
            filename: `enhanced-resume-${chatId}-${Date.now()}.pdf`,
          },
          {
            caption: 'Готово! Ниже улучшенная ATS-friendly версия вашего резюме в PDF.',
          }
        );
        hireAgentStateByChatId.set(chatId, { step: 'idle' });
      } else if (isPositionCvFlow) {
        const positionId = String(st?.positionId || '').trim();
        if (positionId && models.UserApplications) {
          await models.UserApplications.create({
            UserId: user.Id,
            PositionId: positionId,
            DateTime: Sequelize.literal('GETUTCDATE()'),
          });
        }
        hireAgentStateByChatId.set(chatId, { step: 'idle' });
        if (canUseSeekerJobsWebApp) {
          await ctx.reply(
            'Резюме принято. Спасибо за отклик! Пока мы обрабатываем вашу заявку, вы можете посмотреть другие доступные вакансии.',
            {
              reply_markup: {
                inline_keyboard: [[{ text: 'Открыть поиск вакансий', web_app: { url: seekerJobsUrl } }]],
              },
            }
          );
        } else {
          await ctx.reply(
            'Резюме принято. Спасибо за отклик! Пока мы обрабатываем вашу заявку, вы можете посмотреть другие доступные вакансии.'
          );
        }
      } else if (hireAgentSimulationVisible) {
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
      if (isCvReviewFlow) {
        await ctx.reply('Не удалось обработать резюме для CV score. Попробуйте еще раз через минуту.');
        hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv_review' });
      } else {
        await ctx.reply(
          'Не удалось сохранить резюме. Проверьте настройки Azure Storage (AZURE_STORAGE_CONNECTION_STRING) и попробуйте снова.'
        );
        hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv' });
      }
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
    const canProceedToCompanies = await enforceStartRequiredChannelsGate(ctx);
    if (!canProceedToCompanies) return;
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

  bot.command('news', async (ctx) => {
    await ctx.reply(
      'Получайте последние новости про удалённую жизнь, релокацию и общение с единомышленниками.\n\n' +
      'Сообщество Digital nomads. Work from anywhere:',
      {
      reply_markup: {
        inline_keyboard: [[{ text: 'Ознакомиться', url: DIGITAL_NOMADS_CHANNEL_URL }]],
      },
      }
    );
  });

  bot.command('referrals', async (ctx) => {
    await sendReferralScreen(ctx);
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

  const openAdminPositions = async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Admin positions page is available only in private chat.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size > 0 && (!ctx.from?.id || !adminIds.has(ctx.from.id))) {
      await ctx.reply('Unauthorized.');
      return;
    }
    if (canUseAdminPositionsWebApp) {
      await ctx.reply('Open admin positions:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Admin Positions', web_app: { url: adminPositionsUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Admin positions page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  };

  bot.command('admin_positions', async (ctx) => {
    await openAdminPositions(ctx);
  });

  bot.hears(/^\/admin-positions(?:@\w+)?$/, async (ctx) => {
    await openAdminPositions(ctx);
  });

  const openAdminNotifications = async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Admin notifications page is available only in private chat.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size > 0 && (!ctx.from?.id || !adminIds.has(ctx.from.id))) {
      await ctx.reply('Unauthorized.');
      return;
    }
    if (canUseAdminNotificationsWebApp) {
      await ctx.reply('Open admin notifications:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Admin Notifications', web_app: { url: adminNotificationsUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Admin notifications page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  };

  bot.command('admin_notifications', async (ctx) => {
    await openAdminNotifications(ctx);
  });

  bot.hears(/^\/admin-notifications(?:@\w+)?$/, async (ctx) => {
    await openAdminNotifications(ctx);
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

  const ensurePrivateAdminForHiddenCommand = async (ctx, commandName = 'This command') => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply(`${commandName} only works in a private chat with the bot.`);
      return false;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) {
      await ctx.reply('This command is disabled. Set BOT_ADMIN_TELEGRAM_IDS in the server environment.');
      return false;
    }
    const fromId = ctx.from?.id;
    if (!fromId || !adminIds.has(fromId)) {
      await ctx.reply('Unauthorized.');
      return false;
    }
    return true;
  };

  const parsePeriodDays = (raw, fallback = 7) => {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(365, parsed);
  };

  bot.command('stat2', async (ctx) => {
    const ok = await ensurePrivateAdminForHiddenCommand(ctx, 'This command');
    if (!ok) return;
    const text = String(ctx.message?.text || '').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const periodDays = parsePeriodDays(parts[1], 7);
    const stat2PageUrl = stat2Url ? `${stat2Url}?period=${encodeURIComponent(periodDays)}` : '';
    if (!stat2PageUrl) {
      await ctx.reply('Stat2 page URL is not configured.');
      return;
    }
    if (canUseStat2WebApp) {
      await ctx.reply('Open Stat2 dashboard:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Open Stat2', web_app: { url: stat2PageUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Open Stat2 dashboard:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Open Stat2', url: stat2PageUrl }]],
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

  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message?.successful_payment;
    if (!payment) return;
    const telegramPaymentChargeId = String(payment.telegram_payment_charge_id || '').trim();
    if (!telegramPaymentChargeId) {
      console.error('successful_payment without telegram_payment_charge_id');
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(String(payment.invoice_payload || '{}'));
    } catch {
      console.error('successful_payment invalid invoice_payload:', payment.invoice_payload);
      return;
    }
    if (String(payload.type || '') !== 'monthly_plan') {
      console.warn('successful_payment unknown payload type:', payload);
      return;
    }
    const planCode = String(payload.code || '').trim().toLowerCase();
    const plan = await getPlanByCode(planCode);
    if (!plan) {
      await ctx.reply('Оплата получена, но тариф не найден. Напишите в поддержку.');
      return;
    }

    try {
      const existing = models.TelegramPayments
        ? await models.TelegramPayments.findOne({ where: { TelegramPaymentChargeId: telegramPaymentChargeId } })
        : null;
      if (existing) {
        await ctx.reply('Оплата уже была зачислена ранее. Подписка активна.');
        return;
      }

      const { user } = await ensureUserByTelegramId(
        ctx.chat?.id,
        ctx.from?.username ?? null,
        ctx.from?.first_name ?? null,
        ctx.from?.last_name ?? null
      );
      if (!user) {
        await ctx.reply('Не удалось определить пользователя для зачисления подписки.');
        return;
      }

      const paidAt = new Date();
      let telegramPaymentRow = null;
      if (models.TelegramPayments) {
        telegramPaymentRow = await models.TelegramPayments.create({
          UserId: user.Id,
          PlanId: Number(plan.Id),
          TelegramPaymentChargeId: telegramPaymentChargeId,
          ProviderPaymentChargeId: payment.provider_payment_charge_id || null,
          InvoicePayload: String(payment.invoice_payload || ''),
          StarsAmount: Number(payment.total_amount || 0),
          Currency: String(payment.currency || 'XTR'),
          Status: 'completed',
          PaidAt: paidAt,
        });
      }

      if (!models.UserSubscriptions) {
        await ctx.reply('Оплата получена, но таблица подписок недоступна. Напишите в поддержку.');
        return;
      }

      const currentActive = await getActiveSubscriptionForUser(user.Id, paidAt);
      const startsAt = currentActive ? new Date(currentActive.EndsAt) : paidAt;
      const endsAt = new Date(startsAt.getTime() + Math.max(1, Number(plan.DurationDays || 30)) * 24 * 60 * 60 * 1000);
      await models.UserSubscriptions.create({
        UserId: user.Id,
        PlanId: Number(plan.Id),
        TelegramPaymentId: telegramPaymentRow?.Id ?? null,
        StartsAt: startsAt,
        EndsAt: endsAt,
        Status: 'active',
        CreatedAt: paidAt,
      });

      const until = endsAt.toISOString().slice(0, 10);
      await ctx.reply(`✅ Оплата получена. Подписка ${plan.Name} активна до ${until}.`);
    } catch (err) {
      console.error('successful_payment processing failed:', err);
      await ctx.reply('Оплата получена, но автозачисление не завершилось. Напишите в поддержку.');
    }
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });
}

function isSeekerJobsDeeplinkRequest(req) {
  const rawStart = String(req.query.startapp || req.query.startApp || '').trim();
  return rawStart.startsWith('seekerjobs__');
}

async function main() {
  process.stdout.write('App: main() started\n');
  const port = process.env.PORT || 3000;

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) => res.status(200).send('OK'));
  /**
   * Serve deeplink jobs HTML on /app for seekerjobs__ deep links (no HTTP redirect).
   * Redirects can drop the URL fragment (#tgWebAppData=...) that Telegram uses for WebApp auth,
   * which breaks miniAppAuth (empty initData) on the next document.
   */
  const serveSeekerJobsForDeeplink = (req, res, next) => {
    if (!isSeekerJobsDeeplinkRequest(req)) return next();
    return res.sendFile(join(__dirname, '..', 'public', 'app', 'seeker-jobs-deeplink.html'));
  };
  app.get('/app', serveSeekerJobsForDeeplink);
  app.get('/app/', serveSeekerJobsForDeeplink);
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
  app.get('/app/seeker-jobs', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'seeker-jobs.html'));
  });
  app.get('/app/seeker-jobs-deeplink', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'seeker-jobs-deeplink.html'));
  });
  app.get('/app/pricing', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'pricing.html'));
  });
  app.get('/app/admin/companies', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'admin-companies.html'));
  });
  app.get('/app/admin/positions', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'admin-positions.html'));
  });
  app.get('/app/admin/notifications', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'admin-notifications.html'));
  });
  app.get('/app/admin', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'admin.html'));
  });
  app.get('/app/stat', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'stats.html'));
  });
  app.get('/app/stat2', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'stat2.html'));
  });
  app.get('/app/cvscore', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'cvscore.html'));
  });

  let runtimeBotUsername = '';
  app.get('/api/app/bot-info', (_req, res) => res.json({ botUsername: runtimeBotUsername }));
  app.get('/api/cvscore-result', (req, res) => {
    const uidRaw = String(req.query.uid || '').trim();
    if (!uidRaw) return res.status(400).json({ error: 'Missing uid' });
    const result = cvScoreResultByUserId.get(uidRaw);
    if (!result) return res.status(404).json({ error: 'No result found. Please send your CV first.' });
    return res.json(result);
  });

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

  app.get('/api/app/admin/stat2', adminMiniAppAuth, async (req, res) => {
    try {
      const periodRaw = String(req.query.period || '7').trim();
      const period = /^\d+$/.test(periodRaw)
        ? Math.min(365, Math.max(1, Number.parseInt(periodRaw, 10)))
        : 7;
      const now = Date.now();
      const since = new Date(now - period * 24 * 60 * 60 * 1000);
      const toUtcDateKey = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toISOString().slice(0, 10);
      };
      const byDay = new Map();
      for (let i = period - 1; i >= 0; i -= 1) {
        const day = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        byDay.set(day, {
          date: day,
          usersJoined: 0,
          usersJoinedByInvite: 0,
          payments: 0,
          requiredChannelUsers: 0,
        });
      }
      const usersJoinedRowsPromise = models.Users
        ? models.Users.findAll({
          attributes: ['DateJoined'],
          where: { DateJoined: { [Sequelize.Op.gte]: since } },
          raw: true,
        })
        : Promise.resolve([]);
      const invitedRowsPromise = models.Referrals
        ? models.Referrals.findAll({
          attributes: ['ReferredAt', 'ReferredUserId'],
          where: { ReferredAt: { [Sequelize.Op.gte]: since } },
          raw: true,
        })
        : Promise.resolve([]);
      const paymentsRowsPromise = models.TelegramPayments
        ? models.TelegramPayments.findAll({
          attributes: ['PaidAt'],
          where: { PaidAt: { [Sequelize.Op.gte]: since } },
          raw: true,
        })
        : Promise.resolve([]);
      const requiredRowsPromise = models.RequiredChannelUsers
        ? models.RequiredChannelUsers.findAll({
          attributes: ['DateTime', 'UserId'],
          where: { DateTime: { [Sequelize.Op.gte]: since } },
          raw: true,
        })
        : Promise.resolve([]);
      const [usersJoinedRows, invitedRows, paymentsRows, requiredRows] = await Promise.all([
        usersJoinedRowsPromise,
        invitedRowsPromise,
        paymentsRowsPromise,
        requiredRowsPromise,
      ]);
      for (const row of usersJoinedRows) {
        const key = toUtcDateKey(row?.DateJoined);
        if (key && byDay.has(key)) byDay.get(key).usersJoined += 1;
      }
      for (const row of invitedRows) {
        const key = toUtcDateKey(row?.ReferredAt);
        if (key && byDay.has(key)) byDay.get(key).usersJoinedByInvite += 1;
      }
      for (const row of paymentsRows) {
        const key = toUtcDateKey(row?.PaidAt);
        if (key && byDay.has(key)) byDay.get(key).payments += 1;
      }
      const requiredUserPerDaySet = new Set();
      for (const row of requiredRows) {
        const key = toUtcDateKey(row?.DateTime);
        const userId = Number.parseInt(String(row?.UserId || ''), 10);
        if (!key || !byDay.has(key) || !Number.isSafeInteger(userId)) continue;
        const dedupeKey = `${key}:${userId}`;
        if (requiredUserPerDaySet.has(dedupeKey)) continue;
        requiredUserPerDaySet.add(dedupeKey);
        byDay.get(key).requiredChannelUsers += 1;
      }
      const series = Array.from(byDay.values());
      const totals = series.reduce((acc, row) => {
        acc.usersJoined += row.usersJoined;
        acc.usersJoinedByInvite += row.usersJoinedByInvite;
        acc.payments += row.payments;
        acc.requiredChannelUsers += row.requiredChannelUsers;
        return acc;
      }, {
        usersJoined: 0,
        usersJoinedByInvite: 0,
        payments: 0,
        requiredChannelUsers: 0,
      });
      return res.json({ success: true, period, since: since.toISOString(), totals, series });
    } catch (err) {
      console.error('GET /api/app/admin/stat2:', err);
      return res.status(500).json({ error: 'Failed to load stat2 data' });
    }
  });

  app.get('/api/admin/skills', async (_req, res) => {
    try {
      const skills = await fetchScreenlySkillsCatalog();
      return res.json({ success: true, count: skills.length, skills });
    } catch (err) {
      console.error('GET /api/admin/skills:', err);
      return res.status(500).json({ error: 'Failed to load skills' });
    }
  });

  app.get('/api/admin/positions', async (req, res) => {
    try {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const skillIds = String(req.query.skillIds || req.query.skillId || '').trim();
      const showOnlyHighlyRelevantRaw = String(req.query.showOnlyHighlyRelevant || '').trim().toLowerCase();
      const showOnlyHighlyRelevant =
        showOnlyHighlyRelevantRaw === 'true' ||
        showOnlyHighlyRelevantRaw === '1' ||
        showOnlyHighlyRelevantRaw === 'yes';
      const mapApplyTypeToken = (rawToken) => {
        const value = String(rawToken || '').trim().toLowerCase();
        if (!value) return '';
        if (value === 'linkedin') return 'linkedin';
        if (value === 'indeed') return 'indeed';
        if (value === 'telegram' || value === 'telegram channels') return 'telegram';
        if (value === 'external' || value === 'company sites') return 'external';
        return '';
      };
      const parseApplyTypes = (...inputs) => {
        const unique = new Set();
        for (const input of inputs) {
          const rawValues = Array.isArray(input) ? input : [input];
          const chunks = rawValues
            .flatMap((value) => String(value || '').split(','))
            .map((item) => mapApplyTypeToken(item))
            .filter(Boolean);
          for (const chunk of chunks) unique.add(chunk);
        }
        return [...unique];
      };
      const normalizeSourceToken = (rawToken) => {
        const value = String(rawToken || '').trim().toLowerCase();
        if (!value) return '';
        if (value === 'linkedin') return 'Linkedin';
        if (value === 'indeed') return 'Indeed';
        if (value === 'hirehi') return 'hirehi';
        return '';
      };
      const parseSource = (input) => {
        const rawValues = Array.isArray(input) ? input : [input];
        for (const rawValue of rawValues) {
          const tokens = String(rawValue || '')
            .split(',')
            .map((item) => normalizeSourceToken(item))
            .filter(Boolean);
          if (tokens.length) return tokens[0];
        }
        return '';
      };
      const applyTypes = parseApplyTypes(
        req.query.applyType,
        req.query.applyTypes,
        req.query.sourceIds
      );
      const source = parseSource(req.query.source);
      const pageRaw = Number.parseInt(String(req.query.page || '1'), 10);
      const pageSizeRaw = Number.parseInt(String(req.query.pageSize || '100'), 10);
      const page = Number.isSafeInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
      const pageSize = Number.isSafeInteger(pageSizeRaw) && pageSizeRaw > 0
        ? Math.min(200, pageSizeRaw)
        : 100;
      if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
      const upstreamParams = new URLSearchParams();
      upstreamParams.set('from', from);
      upstreamParams.set('to', to);
      if (skillIds) upstreamParams.set('skillIds', skillIds);
      if (showOnlyHighlyRelevant) upstreamParams.set('showOnlyHighlyRelevant', 'true');
      if (source) upstreamParams.set('source', source);
      for (const applyType of applyTypes) {
        // Upstream supports repeated applyType params and CSV; prefer repeated params.
        upstreamParams.append('applyType', applyType);
      }
      upstreamParams.set('page', String(page));
      upstreamParams.set('pageSize', String(pageSize));
      const url = `https://screenly.work/api/global-remote-positions?${upstreamParams.toString()}`;
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

  app.get('/api/app/admin/users/:id/resume-text', adminMiniAppAuth, async (req, res) => {
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

  app.post('/api/tailored-resume/upload', miniAppAuth, async (req, res) => {
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

  app.post('/api/cover-letter', miniAppAuth, async (req, res) => {
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

  app.get('/api/app/monetization/status', miniAppAuth, async (req, res) => {
    try {
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      const channelsState = await getRequiredChannelsState(req.miniAppUser.id);
      const monetization = await buildMonetizationStatus(user.Id);
      return res.json({
        ok: true,
        requiredChannelsSatisfied: channelsState.ok,
        requiredChannels: serializeRequiredChannels(channelsState.channels),
        monetization,
      });
    } catch (err) {
      console.error('GET /api/app/monetization/status:', err);
      return res.status(500).json({ error: 'Failed to load monetization status' });
    }
  });

  app.get('/api/app/monetization/pay-link', miniAppAuth, async (req, res) => {
    try {
      const requestedCode = String(req.query.plan || '').trim().toLowerCase();
      const plan = requestedCode ? await getPlanByCode(requestedCode) : null;
      const safeCode = String(plan?.Code || requestedCode || 'silver').toLowerCase();
      const botUsername = String(runtimeBotUsername || '').trim();
      if (!botUsername) {
        return res.status(503).json({ error: 'Bot username is unavailable' });
      }
      const deepLink = `https://t.me/${botUsername}?start=${encodeURIComponent(`buy_${safeCode}`)}`;
      return res.json({ ok: true, deepLink, planCode: safeCode });
    } catch (err) {
      console.error('GET /api/app/monetization/pay-link:', err);
      return res.status(500).json({ error: 'Failed to build payment link' });
    }
  });

  app.post('/api/app/analytics/search-click', miniAppAuth, async (req, res) => {
    try {
      const searchUrl = String(req.body?.searchUrl ?? '').trim();
      if (!searchUrl) return res.status(400).json({ error: 'searchUrl is required' });
      if (searchUrl.length > 8192) return res.status(400).json({ error: 'searchUrl is too long' });
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      if (!user) return res.status(404).json({ error: 'User not found' });
      await models.SearchClicks.create({ UserId: user.Id, SearchUrl: searchUrl });
      return res.json({ ok: true });
    } catch (err) {
      console.error('POST /api/app/analytics/search-click:', err);
      return res.status(500).json({ error: 'Failed to record search click' });
    }
  });

  app.post('/api/app/analytics/job-details-open', miniAppAuth, async (req, res) => {
    try {
      const jobId = Number.parseInt(String(req.body?.jobId ?? ''), 10);
      if (!Number.isSafeInteger(jobId) || jobId <= 0) {
        return res.status(400).json({ error: 'jobId is required and must be a positive integer' });
      }
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Required channels are mandatory for all users (free/silver/gold).
      const channelsState = await getRequiredChannelsState(req.miniAppUser.id);
      if (channelsState.reason === 'unavailable') {
        return res.status(503).json({ error: 'Subscription check is temporarily unavailable' });
      }
      if (!channelsState.ok) {
        return res.status(403).json({
          error: 'subscribe_required',
          channels: serializeRequiredChannels(channelsState.channels),
          requiredForAllPlans: true,
        });
      }
      await ensureChannelSubscribeBonus(user.Id);

      const entitlement = await getUserEntitlement(user.Id);
      if (entitlement.remainingOpens <= 0) {
        return res.status(402).json({
          error: 'payment_required',
          requiredForAllPlans: true,
          monetization: await buildMonetizationStatus(user.Id),
        });
      }

      await models.JobDetailsOpens.create({ UserId: user.Id, JobId: jobId });
      const updatedEntitlement = await getUserEntitlement(user.Id);
      return res.json({
        ok: true,
        subscribeSatisfied: true,
        requiredForAllPlans: true,
        usedThisMonth: updatedEntitlement.usedThisMonth,
        remainingOpens: updatedEntitlement.remainingOpens,
      });
    } catch (err) {
      console.error('POST /api/app/analytics/job-details-open:', err);
      return res.status(500).json({ error: 'Failed to record job details open' });
    }
  });

  app.post('/api/app/required-channels/verify', miniAppAuth, async (req, res) => {
    try {
      const { user } = await ensureUserByTelegramId(
        req.miniAppUser.id,
        req.miniAppUser.username ?? null,
        req.miniAppUser.first_name ?? req.miniAppUser.firstName ?? null,
        req.miniAppUser.last_name ?? req.miniAppUser.lastName ?? null
      );
      if (!user) return res.status(404).json({ error: 'User not found' });

      const channelsState = await getRequiredChannelsState(req.miniAppUser.id);
      if (channelsState.reason === 'unavailable') {
        return res.status(503).json({ error: 'Subscription check is temporarily unavailable' });
      }

      let grantedBonusOpens = 0;
      if (channelsState.ok) {
        await ensureRequiredChannelUserRecords(req.miniAppUser.id);
        grantedBonusOpens = await ensureChannelSubscribeBonus(user.Id);
      }
      const monetization = await buildMonetizationStatus(user.Id);
      return res.json({
        ok: channelsState.ok,
        channels: serializeRequiredChannels(channelsState.channels),
        requiredForAllPlans: true,
        grantedBonusOpens,
        monetization,
      });
    } catch (err) {
      console.error('POST /api/app/required-channels/verify:', err);
      return res.status(500).json({ error: 'Failed to verify required channels' });
    }
  });

  app.post(
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
      const skillIds = toSkillIdsOrNullOrUndefined(req.body.skills);

      const updates = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => typeof v === 'boolean' || typeof v === 'string' || v === null || typeof v === 'number')
      );
      if (skillIds !== undefined) updates.skills = skillIds;
      if (Object.keys(updates).length > 0) await user.update(updates);

      res.json({
        ok: true,
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

  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const toUuidOrUndefined = (value) => {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return undefined;
    return UUID_V4_RE.test(v) ? v : undefined;
  };

  app.get('/api/app/admin/positions', adminMiniAppAuth, async (_req, res) => {
    try {
      const rows = await models.Positions.findAll({
        order: [['DateCreated', 'DESC']],
        limit: 1000,
      });
      const botUsername = String(runtimeBotUsername || '').trim();
      const withLinks = rows.map((row) => {
        const applyLink = botUsername
          ? `https://t.me/${botUsername}?start=apply_${row.Id}`
          : '';
        return {
          ...row.toJSON(),
          applyLink,
        };
      });
      res.json(withLinks);
    } catch (err) {
      console.error('GET /api/app/admin/positions:', err);
      res.status(500).json({ error: 'Failed to load admin positions' });
    }
  });

  const normalizeNotificationText = (value) => {
    const raw = value == null ? '' : String(value);
    const normalized = raw.replace(/\r\n/g, '\n').trim();
    if (!normalized) return '';
    return normalized.slice(0, 4000);
  };

  const toChatId = (value) => {
    const s = String(value ?? '').trim();
    if (!/^-?\d+$/.test(s)) return null;
    const n = Number.parseInt(s, 10);
    if (!Number.isSafeInteger(n) || n === 0) return null;
    return n;
  };

  const serializeAdminNotificationRun = (row) => {
    if (!row) return null;
    const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
    return {
      id: String(plain.Id || ''),
      initiatorChatId: String(plain.InitiatorChatId || ''),
      text: String(plain.Text || ''),
      total: Number(plain.Total || 0),
      processed: Number(plain.Processed || 0),
      sent: Number(plain.Sent || 0),
      failed: Number(plain.Failed || 0),
      status: String(plain.Status || ''),
      stopRequestedAt: plain.StopRequestedAt || null,
      startedAt: plain.StartedAt || null,
      stoppedAt: plain.StoppedAt || null,
      finishedAt: plain.FinishedAt || null,
      createdAt: plain.CreatedAt || null,
      updatedAt: plain.UpdatedAt || null,
    };
  };

  const serializeAdminNotification = (row) => {
    const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
    const receiverType = String(plain.ReceiverType || '');
    return {
      id: String(plain.Id || ''),
      runId: plain.RunId ? String(plain.RunId) : null,
      initiatorChatId: String(plain.InitiatorChatId || ''),
      text: String(plain.Text || ''),
      receiverType,
      receiverChatId: plain.ReceiverChatId == null ? null : String(plain.ReceiverChatId),
      receiverLabel:
        receiverType === 'all'
          ? plain.ReceiverChatId == null
            ? 'All users'
            : `All users (${String(plain.ReceiverChatId)})`
          : plain.ReceiverChatId == null
            ? 'Unknown'
            : String(plain.ReceiverChatId),
      status: String(plain.Status || ''),
      error: plain.Error || null,
      sentAt: plain.SentAt || null,
      createdAt: plain.CreatedAt || null,
      updatedAt: plain.UpdatedAt || null,
    };
  };

  const findCurrentAdminNotificationRun = async () => {
    if (!models.AdminNotificationRuns) return null;
    return models.AdminNotificationRuns.findOne({
      where: { Status: { [Sequelize.Op.in]: ['running', 'stopping'] } },
      order: [['StartedAt', 'DESC'], ['CreatedAt', 'DESC']],
    });
  };

  const processAdminNotificationRun = async (runId) => {
    if (!models.AdminNotificationRuns || !models.AdminNotifications || !runtimeBotTelegram) return;
    try {
      let run = await models.AdminNotificationRuns.findByPk(runId);
      if (!run) return;
      const queuedRows = await models.AdminNotifications.findAll({
        where: { RunId: runId, Status: 'queued' },
        order: [['CreatedAt', 'ASC']],
      });
      for (const row of queuedRows) {
        if (adminNotificationRunControl.stopRequestedRunIds.has(runId)) break;
        const receiverChatId = toChatId(row.ReceiverChatId);
        if (!receiverChatId) {
          await row.update({
            Status: 'failed',
            Error: 'Invalid receiver chat id',
            UpdatedAt: new Date(),
          });
          run = await run.reload();
          await run.update({
            Processed: Number(run.Processed || 0) + 1,
            Failed: Number(run.Failed || 0) + 1,
            UpdatedAt: new Date(),
          });
          continue;
        }
        await row.update({ Status: 'sending', UpdatedAt: new Date() });
        let isSent = false;
        let errorText = null;
        try {
          await runtimeBotTelegram.sendMessage(receiverChatId, String(row.Text || ''));
          isSent = true;
        } catch (err) {
          errorText = String(err?.response?.description || err?.message || err || 'Failed to send').slice(0, 500);
        }
        const now = new Date();
        await row.update({
          Status: isSent ? 'sent' : 'failed',
          Error: isSent ? null : errorText,
          SentAt: isSent ? now : null,
          UpdatedAt: now,
        });
        run = await run.reload();
        await run.update({
          Processed: Number(run.Processed || 0) + 1,
          Sent: Number(run.Sent || 0) + (isSent ? 1 : 0),
          Failed: Number(run.Failed || 0) + (isSent ? 0 : 1),
          UpdatedAt: now,
        });
      }

      run = await run.reload();
      const stopRequested = adminNotificationRunControl.stopRequestedRunIds.has(runId);
      if (stopRequested) {
        await models.AdminNotifications.update(
          { Status: 'stopped', UpdatedAt: new Date() },
          { where: { RunId: runId, Status: 'queued' } }
        );
        const stoppedCount = await models.AdminNotifications.count({ where: { RunId: runId, Status: 'stopped' } });
        await run.update({
          Processed: Number(run.Total || 0),
          Failed: Number(run.Failed || 0) + Math.max(0, stoppedCount),
          Status: 'stopped',
          StoppedAt: new Date(),
          FinishedAt: new Date(),
          UpdatedAt: new Date(),
        });
      } else {
        await run.update({
          Status: 'completed',
          FinishedAt: new Date(),
          UpdatedAt: new Date(),
        });
      }
    } catch (err) {
      console.error('processAdminNotificationRun error:', err);
      if (models.AdminNotificationRuns) {
        try {
          await models.AdminNotificationRuns.update(
            { Status: 'failed', FinishedAt: new Date(), UpdatedAt: new Date() },
            { where: { Id: runId } }
          );
        } catch {
          // no-op
        }
      }
    } finally {
      adminNotificationRunControl.stopRequestedRunIds.delete(runId);
      if (adminNotificationRunControl.activeRunId === runId) {
        adminNotificationRunControl.activeRunId = null;
      }
    }
  };

  app.get('/api/app/admin/users/search', adminMiniAppAuth, async (req, res) => {
    try {
      const query = String(req.query.q || '').trim();
      if (!query) return res.json([]);
      const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));
      const isDigits = /^\d+$/.test(query);
      const rows = await models.Users.findAll({
        where: {
          [Sequelize.Op.or]: [
            { TelegramUserName: { [Sequelize.Op.like]: `%${query}%` } },
            { FirstName: { [Sequelize.Op.like]: `%${query}%` } },
            { LastName: { [Sequelize.Op.like]: `%${query}%` } },
            ...(isDigits ? [{ TelegramChatId: Number.parseInt(query, 10) }] : []),
          ],
        },
        order: [['DateJoined', 'DESC'], ['Id', 'DESC']],
        limit,
      });
      return res.json(
        rows.map((u) => ({
          id: u.Id,
          telegramChatId: String(u.TelegramChatId || ''),
          telegramUserName: u.TelegramUserName || null,
          firstName: u.FirstName || null,
          lastName: u.LastName || null,
        }))
      );
    } catch (err) {
      console.error('GET /api/app/admin/users/search:', err);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  });

  app.post('/api/app/admin/notifications/send', adminMiniAppAuth, async (req, res) => {
    try {
      if (!models.AdminNotifications || !models.AdminNotificationRuns) {
        return res.status(503).json({ error: 'Admin notifications are unavailable' });
      }
      const mode = String(req.body.mode || '').trim().toLowerCase();
      const text = normalizeNotificationText(req.body.text);
      const initiatorChatId = Number(req.miniAppUser?.id || 0);
      if (!text) return res.status(400).json({ error: 'Text is required' });
      if (!runtimeBotTelegram) return res.status(503).json({ error: 'Telegram bot is unavailable' });

      if (mode === 'single') {
        const receiverChatId = toChatId(req.body.receiverChatId);
        if (!receiverChatId) return res.status(400).json({ error: 'receiverChatId is required for single mode' });
        const id = randomUUID();
        const row = await models.AdminNotifications.create({
          Id: id,
          RunId: null,
          InitiatorChatId: initiatorChatId,
          Text: text,
          ReceiverType: 'single',
          ReceiverChatId: receiverChatId,
          Status: 'sending',
          CreatedAt: new Date(),
          UpdatedAt: new Date(),
        });
        try {
          await runtimeBotTelegram.sendMessage(receiverChatId, text);
          await row.update({ Status: 'sent', SentAt: new Date(), UpdatedAt: new Date(), Error: null });
        } catch (err) {
          await row.update({
            Status: 'failed',
            Error: String(err?.response?.description || err?.message || err || 'Failed to send').slice(0, 500),
            UpdatedAt: new Date(),
          });
        }
        const reloaded = await models.AdminNotifications.findByPk(id);
        return res.json({ ok: true, notification: serializeAdminNotification(reloaded) });
      }

      if (mode !== 'all') {
        return res.status(400).json({ error: 'mode must be "single" or "all"' });
      }

      const currentRun = await findCurrentAdminNotificationRun();
      if (currentRun) {
        return res.status(409).json({ error: 'Another bulk send is in progress', run: serializeAdminNotificationRun(currentRun) });
      }

      const users = await models.Users.findAll({
        where: { TelegramChatId: { [Sequelize.Op.ne]: null } },
        attributes: ['TelegramChatId'],
        order: [['DateJoined', 'DESC'], ['Id', 'DESC']],
      });
      const seen = new Set();
      const recipients = [];
      for (const user of users) {
        const chatId = toChatId(user.TelegramChatId);
        if (!chatId) continue;
        if (chatId < 0) continue;
        if (seen.has(chatId)) continue;
        seen.add(chatId);
        recipients.push(chatId);
      }
      if (recipients.length === 0) {
        return res.status(400).json({ error: 'No eligible recipients found' });
      }

      const runId = randomUUID();
      const now = new Date();
      const run = await models.AdminNotificationRuns.create({
        Id: runId,
        InitiatorChatId: initiatorChatId,
        Text: text,
        Total: recipients.length,
        Processed: 0,
        Sent: 0,
        Failed: 0,
        Status: 'running',
        StartedAt: now,
        CreatedAt: now,
        UpdatedAt: now,
      });
      await models.AdminNotifications.bulkCreate(
        recipients.map((chatId) => ({
          Id: randomUUID(),
          RunId: runId,
          InitiatorChatId: initiatorChatId,
          Text: text,
          ReceiverType: 'all',
          ReceiverChatId: chatId,
          Status: 'queued',
          CreatedAt: now,
          UpdatedAt: now,
        }))
      );
      adminNotificationRunControl.activeRunId = runId;
      processAdminNotificationRun(runId).catch((err) => {
        console.error('processAdminNotificationRun launch error:', err);
      });
      return res.status(202).json({ ok: true, run: serializeAdminNotificationRun(run) });
    } catch (err) {
      console.error('POST /api/app/admin/notifications/send:', err);
      return res.status(500).json({ error: 'Failed to send notifications' });
    }
  });

  app.post('/api/app/admin/notifications/:runId/stop', adminMiniAppAuth, async (req, res) => {
    try {
      const runId = String(req.params.runId || '').trim();
      if (!runId) return res.status(400).json({ error: 'Invalid runId' });
      const run = await models.AdminNotificationRuns?.findByPk(runId);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      if (!['running', 'stopping'].includes(String(run.Status || ''))) {
        return res.status(400).json({ error: 'Run is not active' });
      }
      adminNotificationRunControl.stopRequestedRunIds.add(runId);
      await run.update({
        Status: 'stopping',
        StopRequestedAt: run.StopRequestedAt || new Date(),
        UpdatedAt: new Date(),
      });
      return res.json({ ok: true, run: serializeAdminNotificationRun(run) });
    } catch (err) {
      console.error('POST /api/app/admin/notifications/:runId/stop:', err);
      return res.status(500).json({ error: 'Failed to stop run' });
    }
  });

  app.get('/api/app/admin/notifications/runs/current', adminMiniAppAuth, async (_req, res) => {
    try {
      const run = await findCurrentAdminNotificationRun();
      return res.json({ ok: true, run: serializeAdminNotificationRun(run) });
    } catch (err) {
      console.error('GET /api/app/admin/notifications/runs/current:', err);
      return res.status(500).json({ error: 'Failed to load current run' });
    }
  });

  app.get('/api/app/admin/notifications/history', adminMiniAppAuth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.AdminNotifications.findAll({
        order: [['CreatedAt', 'DESC'], ['Id', 'DESC']],
        limit,
        offset,
      });
      const total = await models.AdminNotifications.count();
      return res.json({ ok: true, total, rows: rows.map(serializeAdminNotification) });
    } catch (err) {
      console.error('GET /api/app/admin/notifications/history:', err);
      return res.status(500).json({ error: 'Failed to load notification history' });
    }
  });

  app.get('/api/app/admin/users', adminMiniAppAuth, async (req, res) => {
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

  app.post('/api/app/admin/positions', adminMiniAppAuth, async (req, res) => {
    try {
      const title = toStringOrUndefined(req.body.title, 255);
      const description = req.body.description == null ? '' : String(req.body.description).trim();
      const companyName = toStringOrUndefined(req.body.companyName, 255);
      const companyWebsite = req.body.companyWebsite == null ? null : toValidUrlOrUndefined(req.body.companyWebsite);
      const externalApplyUrl = req.body.externalApplyUrl == null ? null : toValidUrlOrUndefined(req.body.externalApplyUrl);
      const isArchived = toBoolOrUndefined(req.body.isArchived);
      if (!title || !description || !companyName) {
        return res.status(400).json({ error: 'title, description, companyName are required' });
      }
      if (req.body.companyWebsite != null && !companyWebsite) {
        return res.status(400).json({ error: 'companyWebsite must be a valid URL' });
      }
      if (req.body.externalApplyUrl != null && !externalApplyUrl) {
        return res.status(400).json({ error: 'externalApplyUrl must be a valid URL' });
      }
      const row = await models.Positions.create({
        Title: title,
        Description: description,
        CompanyName: companyName,
        CompanyWebsite: companyWebsite,
        ExternalApplyURL: externalApplyUrl,
        DateCreated: Sequelize.literal('GETUTCDATE()'),
        IsArchived: isArchived ?? false,
      });
      res.status(201).json(row);
    } catch (err) {
      console.error('POST /api/app/admin/positions:', err);
      res.status(500).json({ error: 'Failed to create position' });
    }
  });

  app.patch('/api/app/admin/positions/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = toUuidOrUndefined(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.Positions.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Position not found' });

      const updates = {};
      if (Object.prototype.hasOwnProperty.call(req.body, 'title')) {
        const title = toStringOrUndefined(req.body.title, 255);
        if (!title) return res.status(400).json({ error: 'title must be a non-empty string' });
        updates.Title = title;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
        const description = req.body.description == null ? '' : String(req.body.description).trim();
        if (!description) return res.status(400).json({ error: 'description must be a non-empty string' });
        updates.Description = description;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'companyName')) {
        const companyName = toStringOrUndefined(req.body.companyName, 255);
        if (!companyName) return res.status(400).json({ error: 'companyName must be a non-empty string' });
        updates.CompanyName = companyName;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'companyWebsite')) {
        if (req.body.companyWebsite == null || String(req.body.companyWebsite).trim() === '') {
          updates.CompanyWebsite = null;
        } else {
          const companyWebsite = toValidUrlOrUndefined(req.body.companyWebsite);
          if (!companyWebsite) return res.status(400).json({ error: 'companyWebsite must be a valid URL' });
          updates.CompanyWebsite = companyWebsite;
        }
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'externalApplyUrl')) {
        if (req.body.externalApplyUrl == null || String(req.body.externalApplyUrl).trim() === '') {
          updates.ExternalApplyURL = null;
        } else {
          const externalApplyUrl = toValidUrlOrUndefined(req.body.externalApplyUrl);
          if (!externalApplyUrl) return res.status(400).json({ error: 'externalApplyUrl must be a valid URL' });
          updates.ExternalApplyURL = externalApplyUrl;
        }
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'isArchived')) {
        const isArchived = toBoolOrUndefined(req.body.isArchived);
        if (isArchived === undefined) return res.status(400).json({ error: 'isArchived must be boolean' });
        updates.IsArchived = isArchived;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      await row.update(updates);
      return res.json(row);
    } catch (err) {
      console.error('PATCH /api/app/admin/positions/:id:', err);
      return res.status(500).json({ error: 'Failed to update position' });
    }
  });

  app.delete('/api/app/admin/positions/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = toUuidOrUndefined(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid id' });
      const deleted = await models.Positions.destroy({ where: { Id: id } });
      if (!deleted) return res.status(404).json({ error: 'Position not found' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/app/admin/positions/:id:', err);
      return res.status(500).json({ error: 'Failed to delete position' });
    }
  });

  app.get('/api/app/admin/users/:id', adminMiniAppAuth, async (req, res) => {
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
    runtimeBotTelegram = bot.telegram;
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
      { command: 'start', description: 'Вакансии на удалёнку' },
      { command: 'cvscore', description: 'Проверка и улучшение резюме' },
      { command: 'companies', description: 'Компании с удалёнкой' },
      { command: 'referrals', description: 'Реферальная программа' },
      { command: 'news', description: 'Новости про релокацию, удалёнку и ИИ' },
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
