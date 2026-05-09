// cvScore.js — CV scoring and tailoring via Telegram bot
// Session state machine:
//   cvScoreMode = false            → inactive
//   cvScoreMode = 'awaiting_cv'    → waiting for user to send their CV
//   cvScoreMode = 'awaiting_choice'→ CV received, waiting for user to pick General or Job-specific
//   cvScoreMode = 'awaiting_job_desc' → job-specific chosen, waiting for job description

import { Markup } from 'telegraf';
import pdf from 'pdf-parse/lib/pdf-parse.js';

// ─── Config ────────────────────────────────────────────────────────────────
const TMA_URL = process.env.TMA_BASE_URL + '/app/cvscore.html';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const TAILORED_CV_API_URL = 'https://tailered-cv.onrender.com/generate-simple';
const MODEL = 'claude-sonnet-4-20250514';

const BTN_GENERAL = '🌟 Просто улучшить резюме';
const BTN_JOB = '💼 На основе требований вакансии';
const BTN_BACK = '🔙 Назад в меню';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function extractTextFromPDF(buffer) {
  const data = await pdf(buffer);
  return data.text;
}

async function scoreCV(cvText) {
  const systemPrompt = `You are a senior technical recruiter with 15+ years of experience in tech hiring.

Step 1 — detect language: identify the primary language of the CV text (e.g. Russian, English, Spanish).
Step 2 — use that language for EVERY text value you write: summary, category names, category feedback, strengths, critical_fixes, and roast. Do not write a single word of those fields in any other language.

If the CV is in Russian → every text field must be in Russian.
If the CV is in English → every text field must be in English.
This rule overrides everything else.

Return ONLY valid JSON (no markdown, no preamble):

{
  "language": "<detected language name in English, e.g. Russian>",
  "name": "<candidate full name or Unknown>",
  "title": "<target role inferred from CV>",
  "ats_score": <integer 0-100>,
  "grade": "<A+|A|B|C|D|F>",
  "summary": "<2-3 sentence honest executive summary — written in the CV language>",
  "categories": [
    { "name": "<category name in CV language>", "score": <0-100>, "max": 100, "feedback": "<one sharp sentence in CV language>" },
    { "name": "<category name in CV language>", "score": <0-100>, "max": 100, "feedback": "<one sharp sentence in CV language>" },
    { "name": "<category name in CV language>", "score": <0-100>, "max": 100, "feedback": "<one sharp sentence in CV language>" },
    { "name": "<category name in CV language>", "score": <0-100>, "max": 100, "feedback": "<one sharp sentence in CV language>" },
    { "name": "<category name in CV language>", "score": <0-100>, "max": 100, "feedback": "<one sharp sentence in CV language>" }
  ],
  "strengths": ["<strength in CV language>", "<strength in CV language>", "<strength in CV language>"],
  "critical_fixes": ["<fix in CV language>", "<fix in CV language>", "<fix in CV language>"],
  "roast": "<one savage but fair one-liner naming the single most embarrassing flaw — in CV language>"
}

The 5 category names must cover: ATS & keywords, impact & metrics, structure & clarity, experience relevance, education & certs — translated into the CV language.
ats_score = weighted average of category scores (integer).
grade: 90-100=A+, 80-89=A, 70-79=B, 60-69=C, 50-59=D, <50=F.
Be honest, specific, actionable. Never generic.`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Here is the CV to analyze:\n\n${cvText}` }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${err}`);
  }

  const data = await response.json();
  const raw = data.content.find(b => b.type === 'text')?.text || '';
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function generateTailoredCV(existingCvText, jobRequirements) {
  const response = await fetch(TAILORED_CV_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ existingCvText, jobRequirements }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Tailored CV API error: ${err}`);
  }
  const data = await response.json();
  return data.url;
}

// ─── Localized UI strings ────────────────────────────────────────────────────

const L10N = {
  ru: { done: 'Анализ готов', report: '📊 Открыть полный отчёт' },
  kk: { done: 'Талдау дайын', report: '📊 Толық есепті ашу' },
  de: { done: 'Analyse fertig', report: '📊 Vollständigen Bericht öffnen' },
  es: { done: 'Análisis listo', report: '📊 Ver informe completo' },
  fr: { done: 'Analyse terminée', report: '📊 Ouvrir le rapport complet' },
  pt: { done: 'Análise concluída', report: '📊 Abrir relatório completo' },
  ar: { done: 'اكتمل التحليل', report: '📊 فتح التقرير الكامل' },
  zh: { done: '分析完成', report: '📊 查看完整报告' },
  uk: { done: 'Аналіз готовий', report: '📊 Відкрити повний звіт' },
};
const L10N_DEFAULT = { done: 'Analysis complete', report: '📊 Open Full Report' };

function l10n(language) {
  const lang = String(language || '').trim().toLowerCase().slice(0, 2);
  return L10N[lang] || L10N_DEFAULT;
}

// ─── Session store: userId → latest result (in-memory) ──────────────────────
const resultCache = new Map();

export function getCVScoreResult(userId) {
  return resultCache.get(String(userId)) || null;
}

// ─── Keyboards ───────────────────────────────────────────────────────────────

const choiceKeyboard = Markup.keyboard([
  [BTN_GENERAL, BTN_JOB],
  [BTN_BACK],
]).resize();

const backKeyboard = Markup.keyboard([[BTN_BACK]]).resize();

// ─── Bot handler registration ────────────────────────────────────────────────

export function registerCVScore(bot) {

  // Entry point: user taps "📄 CV Score" from menu
  bot.hears('📄 CV Score', async (ctx) => {
    ctx.session.cvScoreMode = 'awaiting_cv';
    ctx.session.cvText = null;
    await ctx.reply(
      '📎 *Send me your CV* as a PDF or paste the text directly.',
      { parse_mode: 'Markdown', ...backKeyboard },
    );
  });

  bot.command('cvscore', async (ctx) => {
    ctx.session.cvScoreMode = 'awaiting_cv';
    ctx.session.cvText = null;
    await ctx.reply(
      '📎 *Send me your CV* as a PDF or paste the text directly.',
      { parse_mode: 'Markdown', ...backKeyboard },
    );
  });

  // Handle PDF document upload (only when waiting for the CV)
  bot.on('document', async (ctx) => {
    if (ctx.session?.cvScoreMode !== 'awaiting_cv') return;

    const doc = ctx.message.document;
    if (doc.mime_type !== 'application/pdf') {
      return ctx.reply('⚠️ Please send a PDF file.');
    }

    const processingMsg = await ctx.reply('⏳ Reading your CV…');

    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(fileLink.href);
      const buffer = Buffer.from(await res.arrayBuffer());
      const text = await extractTextFromPDF(buffer);

      if (!text || text.trim().length < 100) {
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => {});
        return ctx.reply('⚠️ Could not extract text from this PDF. Try a text-based PDF or paste your CV as text.');
      }

      ctx.session.cvText = text;
      ctx.session.cvScoreMode = 'awaiting_choice';
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => {});
      await showChoicePrompt(ctx);
    } catch (err) {
      console.error('CV Score PDF error:', err);
      await ctx.telegram.editMessageText(
        ctx.chat.id, processingMsg.message_id, undefined,
        '❌ Failed to read CV. Please try again.',
      );
    }
  });

  // Handle all text input
  bot.on('text', async (ctx, next) => {
    const mode = ctx.session?.cvScoreMode;
    if (!mode) return next();

    const text = ctx.message.text;

    if (text === BTN_BACK) {
      ctx.session.cvScoreMode = false;
      ctx.session.cvText = null;
      return next();
    }

    // ── Step 1: waiting for CV text ──────────────────────────────────────────
    if (mode === 'awaiting_cv') {
      if (text.length < 200) {
        return ctx.reply('That looks too short for a CV. Please paste your full CV text or upload a PDF.');
      }
      ctx.session.cvText = text;
      ctx.session.cvScoreMode = 'awaiting_choice';
      return showChoicePrompt(ctx);
    }

    // ── Step 2: waiting for choice ───────────────────────────────────────────
    if (mode === 'awaiting_choice') {
      if (text === BTN_GENERAL) {
        const processingMsg = await ctx.reply('⏳ Analyzing your CV with Claude AI…');
        await runGeneralFlow(ctx, processingMsg.message_id);
        return;
      }
      if (text === BTN_JOB) {
        ctx.session.cvScoreMode = 'awaiting_job_desc';
        return ctx.reply(
          '📋 Paste the *job description* you want to tailor your CV for:',
          { parse_mode: 'Markdown', ...backKeyboard },
        );
      }
      return ctx.reply('Please choose one of the options above.');
    }

    // ── Step 3: waiting for job description ──────────────────────────────────
    if (mode === 'awaiting_job_desc') {
      if (text.length < 50) {
        return ctx.reply('That looks too short. Please paste the full job description.');
      }
      const processingMsg = await ctx.reply('⏳ Tailoring your CV to the job description…');
      await runJobSpecificFlow(ctx, text, processingMsg.message_id);
      return;
    }
  });
}

// ─── Flow helpers ────────────────────────────────────────────────────────────

async function showChoicePrompt(ctx) {
  await ctx.reply(
    '✅ CV received\\! What would you like to do?\n\n' +
    `*${BTN_GENERAL}* — Score your CV and open a full ATS analysis report\\.\n\n` +
    `*${BTN_JOB}* — Tailor your CV to a specific job description\\.`,
    { parse_mode: 'MarkdownV2', ...choiceKeyboard },
  );
}

async function runGeneralFlow(ctx, processingMsgId) {
  try {
    const result = await scoreCV(ctx.session.cvText);
    const userId = ctx.from.id;
    resultCache.set(String(userId), result);

    const t = l10n(result.language);
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsgId, undefined,
      `✅ *${t.done}!*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp(t.report, `${TMA_URL}?uid=${userId}`)],
        ]),
      },
    );
  } catch (err) {
    console.error('CV Score analysis error:', err);
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsgId, undefined,
      '❌ Something went wrong analyzing your CV. Please try again.',
    );
  } finally {
    ctx.session.cvScoreMode = false;
    ctx.session.cvText = null;
  }
}

async function runJobSpecificFlow(ctx, jobDescription, processingMsgId) {
  try {
    const cvUrl = await generateTailoredCV(ctx.session.cvText, jobDescription);
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsgId, undefined,
      `✅ *Your tailored CV is ready\\!*\n\n[⬇️ Download CV](${cvUrl})`,
      { parse_mode: 'MarkdownV2' },
    );
  } catch (err) {
    console.error('Tailored CV error:', err);
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsgId, undefined,
      '❌ Failed to generate tailored CV. Please try again.',
    );
  } finally {
    ctx.session.cvScoreMode = false;
    ctx.session.cvText = null;
  }
}
