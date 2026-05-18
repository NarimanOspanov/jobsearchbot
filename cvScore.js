// cvScore.js — CV scoring and tailoring via Telegram bot
// Session state machine:
//   cvScoreMode = false                → inactive
//   cvScoreMode = 'awaiting_cv_roast'  → roast chosen, waiting for CV
//   cvScoreMode = 'awaiting_cv_tailor' → tailor chosen, waiting for CV
//   cvScoreMode = 'awaiting_job_desc'  → tailor: CV received, waiting for job description

import { Markup } from 'telegraf';
import pdf from 'pdf-parse/lib/pdf-parse.js';

// ─── Config ────────────────────────────────────────────────────────────────
const TMA_URL = process.env.TMA_BASE_URL + '/app/cvscore.html';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const TAILORED_CV_API_URL = 'https://tailered-cv.onrender.com/generate-simple';
const MODEL = 'claude-sonnet-4-20250514';

const BTN_BACK = '🔙 Назад в меню';
const CB_ROAST = 'cvscore_roast';
const CB_TAILOR = 'cvscore_tailor';

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

const L10N_DEFAULT = {
  intro:
    '📄 *CV Tools*\n\n' +
    'I can help in two ways:\n\n' +
    '🔥 *Roast my CV* — analyze it against ATS (the algorithms companies use to filter CVs before a human ever sees them), give an honest score and specific actionable fixes.\n\n' +
    '✨ *Tailor my CV* — adapt your CV to a specific job description and return a ready-to-send PDF.\n\n' +
    'What would you like to do? 👇',
  btn_roast: '🌟 Just improve my CV',
  btn_tailor: '💼 Based on job requirements',
  ask_cv: '📎 Send your CV as a PDF or paste the text directly.',
  ask_job_desc: '📋 Paste the *job description* you want to tailor your CV for:',
  processing_roast: '⏳ Analyzing your CV with Claude AI…',
  processing_tailor: '⏳ Tailoring your CV to the job description…',
  done: 'Analysis complete',
  report: '📊 Open Full Report',
  pdf_only: '⚠️ Please send a PDF file.',
  pdf_error: '⚠️ Could not extract text from this PDF. Try a text-based PDF or paste your CV as text.',
  too_short_cv: 'That looks too short for a CV. Please paste your full CV text or upload a PDF.',
  too_short_job: 'That looks too short. Please paste the full job description.',
  error_cv: '❌ Failed to read CV. Please try again.',
  error_roast: '❌ Something went wrong analyzing your CV. Please try again.',
  error_tailor: '❌ Failed to generate tailored CV. Please try again.',
};

const L10N = {
  ru: {
    intro:
      '📄 *Работа с резюме*\n\n' +
      'Могу помочь двумя способами:\n\n' +
      '🔥 *Оценить резюме* — проанализирую по системе ATS (алгоритмы, которые компании используют для автоматической фильтрации резюме до живого рекрутера), дам честную оценку и конкретные советы.\n\n' +
      '✨ *Адаптировать резюме* — подстрою под конкретную вакансию и верну готовый PDF.\n\n' +
      'Что хочешь сделать? 👇',
    btn_roast: '🌟 Просто улучшить резюме',
    btn_tailor: '💼 На основе требований вакансии',
    ask_cv: '📎 Отправь своё резюме в формате PDF или вставь текст напрямую.',
    ask_job_desc: '📋 Вставь *описание вакансии*, под которую адаптируем резюме:',
    processing_roast: '⏳ Анализирую резюме с Claude AI…',
    processing_tailor: '⏳ Адаптирую резюме под вакансию…',
    done: 'Анализ готов',
    report: '📊 Открыть полный отчёт',
    pdf_only: '⚠️ Пожалуйста, отправь PDF файл.',
    pdf_error: '⚠️ Не удалось извлечь текст из PDF. Попробуй PDF с текстом или вставь резюме текстом.',
    too_short_cv: 'Слишком коротко для резюме. Вставь полный текст или загрузи PDF.',
    too_short_job: 'Слишком коротко. Вставь полное описание вакансии.',
    error_cv: '❌ Не удалось прочитать резюме. Попробуй ещё раз.',
    error_roast: '❌ Ошибка при анализе резюме. Попробуй ещё раз.',
    error_tailor: '❌ Не удалось сгенерировать адаптированное резюме. Попробуй ещё раз.',
  },
  kk: { done: 'Талдау дайын', report: '📊 Толық есепті ашу' },
  de: { done: 'Analyse fertig', report: '📊 Vollständigen Bericht öffnen' },
  es: { done: 'Análisis listo', report: '📊 Ver informe completo' },
  fr: { done: 'Analyse terminée', report: '📊 Ouvrir le rapport complet' },
  pt: { done: 'Análise concluída', report: '📊 Abrir relatório completo' },
  ar: { done: 'اكتمل التحليل', report: '📊 فتح التقرير الكامل' },
  zh: { done: '分析完成', report: '📊 查看完整报告' },
  uk: { done: 'Аналіз готовий', report: '📊 Відкрити повний звіт' },
};

// Merge language-specific overrides on top of the default
function l10n(language) {
  const lang = String(language || '').trim().toLowerCase().slice(0, 2);
  return { ...L10N_DEFAULT, ...(L10N[lang] || {}) };
}

function userL10n(ctx) {
  return l10n(ctx.from?.language_code);
}

// ─── Session store: userId → latest result (in-memory) ──────────────────────
const resultCache = new Map();

export function getCVScoreResult(userId) {
  return resultCache.get(String(userId)) || null;
}

// ─── Keyboards ───────────────────────────────────────────────────────────────

const backKeyboard = Markup.keyboard([[BTN_BACK]]).resize();

function introKeyboard(t) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t.btn_roast, CB_ROAST)],
    [Markup.button.callback(t.btn_tailor, CB_TAILOR)],
  ]);
}

// ─── Bot handler registration ────────────────────────────────────────────────

export function registerCVScore(bot) {

  async function showIntro(ctx) {
    const t = userL10n(ctx);
    await ctx.reply(t.intro, { parse_mode: 'Markdown', ...introKeyboard(t) });
  }

  // Entry points
  bot.hears('📄 CV Score', async (ctx) => {
    ctx.session.cvScoreMode = false;
    ctx.session.cvText = null;
    await showIntro(ctx);
  });

  bot.command('cvscore', async (ctx) => {
    ctx.session.cvScoreMode = false;
    ctx.session.cvText = null;
    await showIntro(ctx);
  });

  // ── Inline button callbacks ──────────────────────────────────────────────
  bot.action(CB_ROAST, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    ctx.session.cvScoreMode = 'awaiting_cv_roast';
    ctx.session.cvText = null;
    const t = userL10n(ctx);
    await ctx.reply(t.ask_cv, { ...backKeyboard });
  });

  bot.action(CB_TAILOR, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    ctx.session.cvScoreMode = 'awaiting_cv_tailor';
    ctx.session.cvText = null;
    const t = userL10n(ctx);
    await ctx.reply(t.ask_cv, { ...backKeyboard });
  });

  // ── PDF upload ────────────────────────────────────────────────────────────
  bot.on('document', async (ctx) => {
    const mode = ctx.session?.cvScoreMode;
    if (mode !== 'awaiting_cv_roast' && mode !== 'awaiting_cv_tailor') return;

    const t = userL10n(ctx);
    const doc = ctx.message.document;

    if (doc.mime_type !== 'application/pdf') {
      return ctx.reply(t.pdf_only);
    }

    const statusMsg = await ctx.reply('⏳ Reading your CV…');

    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(fileLink.href);
      const buffer = Buffer.from(await res.arrayBuffer());
      const text = await extractTextFromPDF(buffer);

      if (!text || text.trim().length < 100) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, t.pdf_error);
        return;
      }

      ctx.session.cvText = text;

      if (mode === 'awaiting_cv_roast') {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, t.processing_roast);
        await runGeneralFlow(ctx, statusMsg.message_id);
      } else {
        // awaiting_cv_tailor
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        ctx.session.cvScoreMode = 'awaiting_job_desc';
        await ctx.reply(t.ask_job_desc, { parse_mode: 'Markdown', ...backKeyboard });
      }
    } catch (err) {
      console.error('CV Score PDF error:', err);
      await ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined, t.error_cv,
      ).catch(() => {});
    }
  });

  // ── Text input ────────────────────────────────────────────────────────────
  bot.on('text', async (ctx, next) => {
    const mode = ctx.session?.cvScoreMode;
    if (!mode) return next();

    const text = ctx.message.text;
    const t = userL10n(ctx);

    if (text === BTN_BACK) {
      ctx.session.cvScoreMode = false;
      ctx.session.cvText = null;
      return next();
    }

    // ── Waiting for CV text (roast) ──────────────────────────────────────
    if (mode === 'awaiting_cv_roast') {
      if (text.length < 200) {
        return ctx.reply(t.too_short_cv);
      }
      ctx.session.cvText = text;
      const processingMsg = await ctx.reply(t.processing_roast);
      await runGeneralFlow(ctx, processingMsg.message_id);
      return;
    }

    // ── Waiting for CV text (tailor) ─────────────────────────────────────
    if (mode === 'awaiting_cv_tailor') {
      if (text.length < 200) {
        return ctx.reply(t.too_short_cv);
      }
      ctx.session.cvText = text;
      ctx.session.cvScoreMode = 'awaiting_job_desc';
      await ctx.reply(t.ask_job_desc, { parse_mode: 'Markdown', ...backKeyboard });
      return;
    }

    // ── Waiting for job description ──────────────────────────────────────
    if (mode === 'awaiting_job_desc') {
      if (text.length < 50) {
        return ctx.reply(t.too_short_job);
      }
      const processingMsg = await ctx.reply(t.processing_tailor);
      await runJobSpecificFlow(ctx, text, processingMsg.message_id);
      return;
    }
  });
}

// ─── Flow helpers ────────────────────────────────────────────────────────────

async function runGeneralFlow(ctx, processingMsgId) {
  try {
    const result = await scoreCV(ctx.session.cvText);
    const userId = ctx.from.id;
    resultCache.set(String(userId), result);

    // Use CV's detected language for the success message
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
    const t = userL10n(ctx);
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsgId, undefined, t.error_roast,
    ).catch(() => {});
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
    const t = userL10n(ctx);
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsgId, undefined, t.error_tailor,
    ).catch(() => {});
  } finally {
    ctx.session.cvScoreMode = false;
    ctx.session.cvText = null;
  }
}
