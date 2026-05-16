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
export const BOT_MENU_VERSION = 4;

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

/** Register global command menus (Telegram client language + default fallback). */
export async function registerBotMenuCommands(telegram) {
  if (!telegram) return;
  await telegram.setMyCommands(getMenuCommands('en'));
  await telegram.setMyCommands(getMenuCommands('ru'), { language_code: 'ru' });
  await telegram.setMyCommands(getMenuCommands('en'), { language_code: 'en' });
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

