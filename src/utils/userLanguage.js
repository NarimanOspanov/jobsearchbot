export const SUPPORTED_USER_LANGUAGES = /** @type {const} */ (['ru', 'en']);
export const DEFAULT_USER_LANGUAGE = 'ru';

export function normalizeUserLanguage(raw) {
  return String(raw || '').trim().toLowerCase() === 'en' ? 'en' : 'ru';
}

/** Map Telegram `User.language_code` (e.g. ru, en-US) to supported bot locale. */
export function normalizeTelegramLanguageCode(raw) {
  const code = String(raw || '').trim().toLowerCase();
  if (!code) return null;
  if (code === 'en' || code.startsWith('en-')) return 'en';
  return 'ru';
}

/**
 * Bot reply language: explicit Users.Language wins; otherwise Telegram app language; else ru.
 * @param {string | null | undefined} dbLanguage Users.Language column
 * @param {string | null | undefined} telegramLanguageCode ctx.from.language_code
 */
export function resolveBotLanguage(dbLanguage, telegramLanguageCode) {
  const db = String(dbLanguage || '').trim().toLowerCase();
  if (db === 'en' || db === 'ru') return db;
  return normalizeTelegramLanguageCode(telegramLanguageCode) || DEFAULT_USER_LANGUAGE;
}
