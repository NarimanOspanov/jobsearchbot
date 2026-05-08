// cvScore.js — Drop-in replacement for the old cvscore menu item
// Uses Claude claude-sonnet-4-20250514 via Anthropic API to score uploaded CVs
// Results are shown in the Telegram Mini App (TMA) at /app/cvscore

import { Markup } from 'telegraf';
import pdf from 'pdf-parse/lib/pdf-parse.js';

// ─── Config ────────────────────────────────────────────────────────────────
const TMA_URL = process.env.TMA_BASE_URL + '/app/cvscore.html'; // e.g. https://yourdomain.com/app/cvscore.html
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

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
      messages: [{ role: 'user', content: `Here is the CV to analyze:\n\n${cvText}` }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${err}`);
  }

  const data = await response.json();
  const raw = data.content.find(b => b.type === 'text')?.text || '';

  // Strip any accidental markdown fences
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─── Localized UI strings for the Telegram preview message ──────────────────

const L10N = {
  ru: { done: 'Анализ готов', tap: 'Нажмите ниже, чтобы открыть полный отчёт 👇', report: '📊 Открыть полный отчёт' },
  kk: { done: 'Талдау дайын', tap: 'Толық есепті ашу үшін төменге басыңыз 👇', report: '📊 Толық есепті ашу' },
  de: { done: 'Analyse fertig', tap: 'Tippe unten für den vollständigen Bericht 👇', report: '📊 Vollständigen Bericht öffnen' },
  es: { done: 'Análisis listo', tap: 'Toca abajo para ver el informe completo 👇', report: '📊 Ver informe completo' },
  fr: { done: 'Analyse terminée', tap: 'Appuyez ci-dessous pour voir le rapport complet 👇', report: '📊 Ouvrir le rapport complet' },
  pt: { done: 'Análise concluída', tap: 'Toque abaixo para ver o relatório completo 👇', report: '📊 Abrir relatório completo' },
  ar: { done: 'اكتمل التحليل', tap: 'انقر أدناه لفتح التقرير الكامل 👇', report: '📊 فتح التقرير الكامل' },
  zh: { done: '分析完成', tap: '点击下方查看完整报告 👇', report: '📊 查看完整报告' },
  uk: { done: 'Аналіз готовий', tap: 'Натисніть нижче, щоб відкрити повний звіт 👇', report: '📊 Відкрити повний звіт' },
};
const L10N_DEFAULT = { done: 'Analysis complete', tap: 'Tap below to see the full report 👇', report: '📊 Open Full Report' };

function l10n(language) {
  const lang = String(language || '').trim().toLowerCase().slice(0, 2);
  return L10N[lang] || L10N_DEFAULT;
}

// ─── Session store: userId → latest result (in-memory, fine for small bots) ─
const resultCache = new Map();

export function getCVScoreResult(userId) {
  return resultCache.get(String(userId)) || null;
}

// ─── Bot handler registration ────────────────────────────────────────────────

/**
 * Call this in your main bot setup:
 *   import { registerCVScore } from './cvScore.js';
 *   registerCVScore(bot);
 */
export function registerCVScore(bot) {

  // Entry point: user taps "📄 CV Score" from menu
  bot.hears('📄 CV Score', async (ctx) => {
    await ctx.reply(
      '📎 *Send me your CV* as a PDF or paste the text directly.\n\nI\'ll score it with Claude AI and show you a full ATS analysis.',
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['🔙 Back to Menu']]).resize()
      }
    );
    ctx.session.cvScoreMode = true;
  });

  // Also register as a command
  bot.command('cvscore', async (ctx) => {
    await ctx.reply(
      '📎 *Send me your CV* as a PDF or paste the text directly.',
      { parse_mode: 'Markdown' }
    );
    ctx.session.cvScoreMode = true;
  });

  // Handle PDF document upload
  bot.on('document', async (ctx) => {
    if (!ctx.session?.cvScoreMode) return;

    const doc = ctx.message.document;
    if (doc.mime_type !== 'application/pdf') {
      return ctx.reply('⚠️ Please send a PDF file.');
    }

    const processingMsg = await ctx.reply('⏳ Analyzing your CV with Claude AI...');

    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(fileLink.href);
      const buffer = Buffer.from(await res.arrayBuffer());
      const text = await extractTextFromPDF(buffer);

      if (!text || text.trim().length < 100) {
        return ctx.reply('⚠️ Could not extract text from this PDF. Try a text-based PDF or paste your CV as text.');
      }

      await processAndRespond(ctx, text, processingMsg.message_id);
    } catch (err) {
      console.error('CV Score PDF error:', err);
      await ctx.telegram.editMessageText(
        ctx.chat.id, processingMsg.message_id, undefined,
        '❌ Failed to analyze CV. Please try again.'
      );
    }
  });

  // Handle plain text CV paste
  bot.on('text', async (ctx, next) => {
    if (!ctx.session?.cvScoreMode) return next();
    const text = ctx.message.text;
    if (text === '🔙 Back to Menu') {
      ctx.session.cvScoreMode = false;
      return next();
    }
    if (text.length < 200) {
      return ctx.reply('That looks too short for a CV. Please paste your full CV text or upload a PDF.');
    }

    const processingMsg = await ctx.reply('⏳ Analyzing your CV with Claude AI...');
    await processAndRespond(ctx, text, processingMsg.message_id);
  });
}

// ─── Core: call Claude, cache result, send TMA button ───────────────────────

async function processAndRespond(ctx, cvText, processingMsgId) {
  try {
    const result = await scoreCV(cvText);
    const userId = ctx.from.id;

    // Store result so TMA can fetch it
    resultCache.set(String(userId), result);

    const t = l10n(result.language);
    // Edit the "analyzing..." message
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsgId, undefined,
      `✅ *${t.done}!*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp(t.report, `${TMA_URL}?uid=${userId}`)]
        ])
      }
    );

    ctx.session.cvScoreMode = false;
  } catch (err) {
    console.error('CV Score analysis error:', err);
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsgId, undefined,
      '❌ Something went wrong analyzing your CV. Please try again.'
    );
  }
}
