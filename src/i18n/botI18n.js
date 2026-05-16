import {
  normalizeUserLanguage,
  resolveBotLanguage,
  SUPPORTED_USER_LANGUAGES,
} from '../utils/userLanguage.js';
import { BOT_LOCALES, BOT_MENU_COMMANDS } from './botLocales.js';

export { BOT_MENU_COMMANDS };
export const SUPPORTED_BOT_LANGUAGES = SUPPORTED_USER_LANGUAGES;

/** @typedef {import('./botLocales.js').BotLang} BotLang */

export const DEFAULT_BOT_LANGUAGE = 'ru';

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
  const bundle = BOT_LOCALES[locale] || BOT_LOCALES.ru;
  let text = bundle[key] ?? BOT_LOCALES.ru[key] ?? key;
  for (const [paramKey, value] of Object.entries(params)) {
    text = text.replaceAll(`{${paramKey}}`, String(value));
  }
  return text;
}

/** @param {import('telegraf').Context} ctx */
export function langFromCtx(ctx) {
  if (ctx.state?.lang) return normalizeUserLanguage(ctx.state.lang);
  return resolveBotLanguage(ctx.state?.userLanguage, ctx.from?.language_code);
}

/** @param {import('telegraf').Context} ctx */
export function tr(ctx, key, params = {}) {
  return t(langFromCtx(ctx), key, params);
}

/** @param {BotLang} lang */
export function getMenuCommands(lang) {
  const locale = normalizeUserLanguage(lang);
  return BOT_MENU_COMMANDS[locale] || BOT_MENU_COMMANDS.ru;
}

/** Register global command menus (Telegram client language + default fallback). */
export async function registerBotMenuCommands(telegram) {
  if (!telegram) return;
  await telegram.setMyCommands(getMenuCommands('ru'));
  await telegram.setMyCommands(getMenuCommands('ru'), { language_code: 'ru' });
  await telegram.setMyCommands(getMenuCommands('en'), { language_code: 'en' });
}

/** Per-user menu in a private chat — follows Users.Language from profile. */
export async function syncUserMenuCommands(telegram, chatId, lang) {
  if (!telegram || chatId == null) return;
  const locale = normalizeUserLanguage(lang);
  await telegram.setMyCommands(getMenuCommands(locale), {
    scope: { type: 'chat', chat_id: Number(chatId) },
  });
}
