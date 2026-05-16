export function normalizeUserLanguage(raw) {
  return String(raw || '').trim().toLowerCase() === 'en' ? 'en' : 'ru';
}
