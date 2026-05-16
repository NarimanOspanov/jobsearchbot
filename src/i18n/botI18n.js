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

/** Bump when BOT_MENU_COMMANDS change — triggers one-time refresh on live bot process. */
export const BOT_MENU_VERSION = 2;

const MENU_API_DELAY_MS = 40;
let appliedMenuVersion = 0;
let menuRefreshInFlight = null;

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

/**
 * Push global menus and refresh per-chat overrides (no bot process restart).
 * @param {import('telegraf').Telegram} telegram
 * @param {{ users?: Array<{ telegramChatId: number | string, language?: string | null }> }} [options]
 */
export async function refreshBotMenus(telegram, options = {}) {
  if (!telegram) return { global: false, synced: 0, cleared: 0 };
  await registerBotMenuCommands(telegram);

  const users = Array.isArray(options.users) ? options.users : [];
  let synced = 0;
  let cleared = 0;

  for (const user of users) {
    const chatId = Number(user.telegramChatId);
    if (!Number.isSafeInteger(chatId)) continue;
    const dbLang = String(user.language || '').trim().toLowerCase();
    try {
      if (dbLang === 'ru' || dbLang === 'en') {
        await syncUserMenuCommands(telegram, chatId, dbLang);
        synced += 1;
      } else {
        await telegram.deleteMyCommands({ scope: { type: 'chat', chat_id: chatId } });
        cleared += 1;
      }
    } catch (err) {
      console.warn('refreshBotMenus user failed:', { chatId, error: err?.message || err });
    }
    await delay(MENU_API_DELAY_MS);
  }

  appliedMenuVersion = BOT_MENU_VERSION;
  return { global: true, synced, cleared };
}

/** Idempotent: refresh menus once per process when BOT_MENU_VERSION increases. */
export function ensureBotMenusApplied(telegram, users = []) {
  if (!telegram || appliedMenuVersion >= BOT_MENU_VERSION) {
    return Promise.resolve({ skipped: true });
  }
  if (menuRefreshInFlight) return menuRefreshInFlight;
  menuRefreshInFlight = refreshBotMenus(telegram, { users }).finally(() => {
    menuRefreshInFlight = null;
  });
  return menuRefreshInFlight;
}
