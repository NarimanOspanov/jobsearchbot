/** Shared Telegram Mini App locale helpers (default: English). */
(function (global) {
  function telegramLang(tg) {
    const code = String(tg?.initDataUnsafe?.user?.language_code || '').toLowerCase();
    return code === 'ru' || code.startsWith('ru-') ? 'ru' : 'en';
  }

  /** Telegram language, with optional `?lang=ru|en` override (handy for local QA). */
  function resolveLang(tg, searchParams) {
    const fromUrl = String(searchParams?.get?.('lang') || '').trim().toLowerCase();
    if (fromUrl === 'ru' || fromUrl === 'en') return fromUrl;
    return telegramLang(tg);
  }

  function normalizeLang(raw) {
    return String(raw || '').trim().toLowerCase() === 'ru' ? 'ru' : 'en';
  }

  function t(bundle, lang, key, params) {
    const locale = normalizeLang(lang);
    const table = bundle[locale] || bundle.en || {};
    let text = table[key] ?? bundle.en?.[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replaceAll(`{${k}}`, String(v));
      });
    }
    return text;
  }

  global.TmaI18n = { telegramLang, resolveLang, normalizeLang, t };
})(window);
