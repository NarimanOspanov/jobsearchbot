/** Build Telegram mini app deeplinks and open native share picker for jobs. */
(function (global) {
  function encodeBase64UrlUtf8(str) {
    const bytes = new TextEncoder().encode(String(str || ''));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  /**
   * @param {Record<string, string | number | null | undefined>} params
   * @returns {string}
   */
  function buildStartappPayload(params) {
    const parts = [];
    for (const [key, value] of Object.entries(params || {})) {
      const v = String(value ?? '').trim();
      if (v) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
    const query = parts.join('&');
    if (!query) return '';
    if (!query.includes('&')) return query;
    return encodeBase64UrlUtf8(query);
  }

  function normalizeBotUsername(botUsername) {
    return String(botUsername || '').trim().replace(/^@/, '');
  }

  function normalizeMiniAppShortName(miniAppShortName) {
    const shortName = String(miniAppShortName || 'app').trim();
    return shortName || 'app';
  }

  /**
   * @param {{ botUsername: string, miniAppShortName?: string, jobId: string | number, from?: string, to?: string, skillIds?: string }} options
   */
  function buildSeekerJobShareLink(options) {
    const bot = normalizeBotUsername(options?.botUsername);
    const shortName = normalizeMiniAppShortName(options?.miniAppShortName);
    const payload = buildStartappPayload({
      jobId: options?.jobId,
      from: options?.from,
      to: options?.to,
      skillIds: options?.skillIds,
    });
    if (!bot || !payload) return '';
    return `https://t.me/${bot}/${shortName}?startapp=seekerjobs__${payload}`;
  }

  /**
   * @param {{ botUsername: string, miniAppShortName?: string, seekerId: string | number, jobId: string | number }} options
   */
  function buildAgentJobShareLink(options) {
    const bot = normalizeBotUsername(options?.botUsername);
    const shortName = normalizeMiniAppShortName(options?.miniAppShortName);
    const payload = buildStartappPayload({
      seekerId: options?.seekerId,
      jobId: options?.jobId,
    });
    if (!bot || !payload) return '';
    return `https://t.me/${bot}/${shortName}?startapp=agentclients__${payload}`;
  }

  /**
   * @param {string} shareUrl
   * @param {string} text
   */
  function buildTelegramShareUrl(shareUrl, text) {
    return `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`;
  }

  /**
   * @param {{ tg?: object, shareUrl: string, text: string }} options
   */
  function shareJob(options) {
    const shareUrl = String(options?.shareUrl || '').trim();
    const text = String(options?.text || '').trim();
    if (!shareUrl) return;
    const telegramShareUrl = buildTelegramShareUrl(shareUrl, text);
    const tgApp = options?.tg || global.Telegram?.WebApp;
    if (tgApp?.openTelegramLink) {
      tgApp.openTelegramLink(telegramShareUrl);
      return;
    }
    global.open(telegramShareUrl, '_blank', 'noopener,noreferrer');
  }

  global.TmaJobShare = {
    encodeBase64UrlUtf8,
    buildStartappPayload,
    buildSeekerJobShareLink,
    buildAgentJobShareLink,
    buildTelegramShareUrl,
    shareJob,
  };
})(window);
