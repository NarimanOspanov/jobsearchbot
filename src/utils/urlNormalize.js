const TRACKING_QUERY_PARAMS = new Set([
  'srsltid',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
]);

function isGoogleRedirectUrl(parsed) {
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  return host === 'google.com' && parsed.pathname === '/url';
}

function unwrapGoogleRedirectUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) return value;

  for (let i = 0; i < 5; i += 1) {
    try {
      const parsed = new URL(value);
      if (!isGoogleRedirectUrl(parsed)) break;
      const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (!target) break;
      value = target;
    } catch {
      break;
    }
  }

  if (value.includes('%')) {
    try {
      const decoded = decodeURIComponent(value);
      if (/^https?:\/\//i.test(decoded)) value = decoded;
    } catch {
      // keep original value
    }
  }

  return value;
}

function isTrackingQueryParam(name) {
  const lower = String(name || '').toLowerCase();
  return TRACKING_QUERY_PARAMS.has(lower) || lower.startsWith('utm_');
}

function stripTrailingSlash(url) {
  try {
    let result = new URL(url).toString();
    result = result.replace(/^(https?:\/\/[^/?#]+)\/+(?=[?#]|$)/, '$1');
    result = result.replace(/([^/?#])\/+(?=[?#]|$)/, '$1');
    return result;
  } catch {
    return url.replace(/\/$/, '');
  }
}

/**
 * Normalize a careers-page URL: unwrap Google redirect wrappers, decode nested
 * links, and drop common tracking query params.
 */
export function normalizeCareerUrl(url) {
  let value = unwrapGoogleRedirectUrl(url);
  if (!value) return '';

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return stripTrailingSlash(value);
    }

    for (const key of [...parsed.searchParams.keys()]) {
      if (isTrackingQueryParam(key)) parsed.searchParams.delete(key);
    }

    return stripTrailingSlash(parsed.toString());
  } catch {
    return stripTrailingSlash(value);
  }
}
