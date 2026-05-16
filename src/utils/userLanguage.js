export const SUPPORTED_USER_LANGUAGES = /** @type {const} */ (['ru', 'en']);
export const DEFAULT_USER_LANGUAGE = 'en';

export function normalizeUserLanguage(raw) {
  return String(raw || '').trim().toLowerCase() === 'ru' ? 'ru' : 'en';
}

/** Map Telegram `User.language_code` (e.g. ru, en-US) to supported bot locale. */
export function normalizeTelegramLanguageCode(raw) {
  const code = String(raw || '').trim().toLowerCase();
  if (!code) return null;
  if (code === 'ru' || code.startsWith('ru-')) return 'ru';
  return 'en';
}

/** Bot language from Telegram app only (ignore Users.Language). */
export function resolveBotLanguage(telegramLanguageCode) {
  return normalizeTelegramLanguageCode(telegramLanguageCode) || DEFAULT_USER_LANGUAGE;
}
