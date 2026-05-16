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

/** Bump when BOT_MENU_COMMANDS change — triggers one-time refresh on live bot process. */
export const BOT_MENU_VERSION = 3;

let appliedMenuVersion = 0;
let menuRefreshInFlight = null;

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

/** Push global menus to Telegram (no per-user DB language). */
export async function refreshBotMenus(telegram) {
  if (!telegram) return { global: false };
  await registerBotMenuCommands(telegram);
  appliedMenuVersion = BOT_MENU_VERSION;
  return { global: true };
}

/** Idempotent: refresh menus once per process when BOT_MENU_VERSION increases. */
export function ensureBotMenusApplied(telegram) {
  if (!telegram || appliedMenuVersion >= BOT_MENU_VERSION) {
    return Promise.resolve({ skipped: true });
  }
  if (menuRefreshInFlight) return menuRefreshInFlight;
  menuRefreshInFlight = refreshBotMenus(telegram).finally(() => {
    menuRefreshInFlight = null;
  });
  return menuRefreshInFlight;
}
