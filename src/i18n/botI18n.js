import {
  normalizeUserLanguage,
  resolveBotLanguage,
  SUPPORTED_USER_LANGUAGES,
} from '../utils/userLanguage.js';
import { BOT_LOCALES, BOT_MENU_COMMANDS } from './botLocales.js';

export { BOT_MENU_COMMANDS };
export const SUPPORTED_BOT_LANGUAGES = SUPPORTED_USER_LANGUAGES;

/** @typedef {import('./botLocales.js').BotLang} BotLang */

export const DEFAULT_BOT_LANGUAGE = 'en';

/** Bump when BOT_MENU_COMMANDS change (run `/refreshmenus` or `npm run menus:refresh`). */
export const BOT_MENU_VERSION = 5;

/** Bump when main reply keyboard labels/layout change. */
export const MAIN_REPLY_KEYBOARD_VERSION = 2;

const MAIN_MENU_KEYBOARD_KEYS = {
  jobsearch: 'keyboard_job_search',
  cvscore: 'keyboard_cv_enhance',
  news: 'keyboard_news',
  profile: 'keyboard_settings',
};

/** @type {Map<number, number>} */
const mainReplyKeyboardSyncedVersionByChatId = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} text @param {string} key */
export function textMatchesAnyLang(text, key) {
  return SUPPORTED_BOT_LANGUAGES.some((locale) => t(locale, key) === text);
}

/**
 * @param {string | null | undefined} lang
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 */
export function t(lang, key, params = {}) {
  const locale = normalizeUserLanguage(lang);
  const bundle = BOT_LOCALES[locale] || BOT_LOCALES.en;
  let text = bundle[key] ?? BOT_LOCALES.en[key] ?? key;
  for (const [paramKey, value] of Object.entries(params)) {
    text = text.replaceAll(`{${paramKey}}`, String(value));
  }
  return text;
}

/** @param {import('telegraf').Context} ctx */
export function langFromCtx(ctx) {
  if (ctx.state?.lang) return normalizeUserLanguage(ctx.state.lang);
  return resolveBotLanguage(ctx.from?.language_code);
}

/** @param {import('telegraf').Context} ctx */
export function tr(ctx, key, params = {}) {
  return t(langFromCtx(ctx), key, params);
}

/** @param {BotLang} lang */
export function getMenuCommands(lang) {
  const locale = normalizeUserLanguage(lang);
  return BOT_MENU_COMMANDS[locale] || BOT_MENU_COMMANDS.en;
}

/** @type {Map<number, number>} */
const menuSyncedVersionByChatId = new Map();

/** Register global command menus (Telegram client language + default fallback). */
export async function registerBotMenuCommands(telegram) {
  if (!telegram) return;
  await telegram.setMyCommands(getMenuCommands('en'));
  await telegram.setMyCommands(getMenuCommands('ru'), { language_code: 'ru' });
  await telegram.setMyCommands(getMenuCommands('en'), { language_code: 'en' });
}

/**
 * Drop stale per-chat command overrides so the global menu (BOT_MENU_VERSION) is visible.
 * Called lazily on user activity — no broadcast needed.
 * @param {import('telegraf').Telegram} telegram
 * @param {number} chatId
 */
export async function ensureUserBotMenuCurrent(telegram, chatId) {
  if (!telegram || !Number.isSafeInteger(chatId)) return;
  if (menuSyncedVersionByChatId.get(chatId) === BOT_MENU_VERSION) return;
  try {
    await telegram.deleteMyCommands({ scope: { type: 'chat', chat_id: chatId } });
  } catch (err) {
    console.warn('deleteMyCommands (chat scope) failed:', {
      chatId,
      error: err?.message || err,
    });
  }
  menuSyncedVersionByChatId.set(chatId, BOT_MENU_VERSION);
}

/**
 * Push global menus and clear per-chat overrides (left from older profile/language sync).
 * @param {import('telegraf').Telegram} telegram
 * @param {{ chatIds?: Array<number | string> }} [options]
 */
export async function refreshBotMenus(telegram, options = {}) {
  if (!telegram) return { global: false, cleared: 0 };
  await registerBotMenuCommands(telegram);

  const chatIds = Array.isArray(options.chatIds) ? options.chatIds : [];
  let cleared = 0;
  for (const rawChatId of chatIds) {
    const chatId = Number(rawChatId);
    if (!Number.isSafeInteger(chatId)) continue;
    try {
      await telegram.deleteMyCommands({ scope: { type: 'chat', chat_id: chatId } });
      cleared += 1;
    } catch (err) {
      console.warn('deleteMyCommands (chat scope) failed:', {
        chatId,
        error: err?.message || err,
      });
    }
    await delay(40);
  }

  return { global: true, cleared };
}

/** @param {string | null | undefined} lang */
export function buildMainReplyKeyboard(lang) {
  const locale = normalizeUserLanguage(lang);
  return {
    keyboard: [
      [
        { text: t(locale, MAIN_MENU_KEYBOARD_KEYS.jobsearch) },
        { text: t(locale, MAIN_MENU_KEYBOARD_KEYS.cvscore) },
      ],
      [
        { text: t(locale, MAIN_MENU_KEYBOARD_KEYS.news) },
        { text: t(locale, MAIN_MENU_KEYBOARD_KEYS.profile) },
      ],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * Attach the main reply keyboard to outgoing messages that do not use inline buttons.
 * @param {Record<string, unknown>} [extra]
 * @param {string | null | undefined} lang
 */
export function withMainReplyKeyboard(extra = {}, lang) {
  const markup = extra.reply_markup;
  if (markup && typeof markup === 'object') {
    if (Array.isArray(markup.inline_keyboard) && markup.inline_keyboard.length > 0) return extra;
    if (markup.remove_keyboard === true) return extra;
    if (Array.isArray(markup.keyboard) && markup.keyboard.length > 0) return extra;
  }
  return {
    ...extra,
    reply_markup: buildMainReplyKeyboard(lang),
  };
}

function hasInlineReplyMarkup(extra = {}) {
  const markup = extra.reply_markup;
  return Boolean(
    markup &&
      typeof markup === 'object' &&
      Array.isArray(markup.inline_keyboard) &&
      markup.inline_keyboard.length > 0
  );
}

/** @param {string | null | undefined} text @returns {'jobsearch' | 'cvscore' | 'news' | 'profile' | null} */
export function resolveMainMenuKeyboardAction(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  for (const [action, key] of Object.entries(MAIN_MENU_KEYBOARD_KEYS)) {
    if (textMatchesAnyLang(normalized, key)) return /** @type {'jobsearch' | 'cvscore' | 'news' | 'profile'} */ (action);
  }
  return null;
}

/**
 * Show the persistent main reply keyboard once per MAIN_REPLY_KEYBOARD_VERSION.
 * @param {import('telegraf').Telegram} telegram
 * @param {number} chatId
 * @param {string | null | undefined} lang
 * @param {{ force?: boolean }} [options]
 */
export async function ensureMainReplyKeyboard(telegram, chatId, lang, options = {}) {
  if (!telegram || !Number.isSafeInteger(chatId)) return;
  const force = options.force === true;
  if (!force && mainReplyKeyboardSyncedVersionByChatId.get(chatId) === MAIN_REPLY_KEYBOARD_VERSION) return;
  try {
    await telegram.sendMessage(chatId, '\u2060', {
      reply_markup: buildMainReplyKeyboard(lang),
    });
    mainReplyKeyboardSyncedVersionByChatId.set(chatId, MAIN_REPLY_KEYBOARD_VERSION);
  } catch (err) {
    console.warn('ensureMainReplyKeyboard failed:', { chatId, error: err?.message || err });
  }
}

/**
 * Wrap Telegraf reply helpers so text replies carry the main menu keyboard.
 * Inline-only replies get a follow-up keyboard message (Telegram allows one markup type per message).
 * @param {import('telegraf').Context} ctx
 */
export function patchCtxWithMainReplyKeyboard(ctx) {
  if (ctx.chat?.type !== 'private') return;
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  if (!Number.isSafeInteger(chatId)) return;
  if (!ctx.state) ctx.state = {};

  const wrapReplyMethod = (methodName) => {
    const original = ctx[methodName]?.bind(ctx);
    if (!original || ctx.state?.mainReplyKeyboardPatched?.[methodName]) return;
    if (!ctx.state.mainReplyKeyboardPatched) ctx.state.mainReplyKeyboardPatched = {};
    ctx.state.mainReplyKeyboardPatched[methodName] = true;

    ctx[methodName] = async (...args) => {
      const lang = langFromCtx(ctx);
      const extra = typeof args[1] === 'object' && args[1] !== null ? args[1] : {};
      const usesInline = hasInlineReplyMarkup(extra);
      const result = usesInline
        ? await original(...args)
        : methodName === 'reply'
          ? await original(args[0], withMainReplyKeyboard(extra, lang))
          : await original(args[0], withMainReplyKeyboard(extra, lang));
      if (usesInline) {
        await ensureMainReplyKeyboard(ctx.telegram, chatId, lang);
      }
      return result;
    };
  };

  wrapReplyMethod('reply');
  wrapReplyMethod('replyWithPhoto');
  wrapReplyMethod('replyWithDocument');
  wrapReplyMethod('replyWithVideo');
}

