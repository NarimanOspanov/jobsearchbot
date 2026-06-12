const ANYHIRES_BASE = 'https://anyhires.com';
const PROBE_TIMEOUT_MS = 15000;

function localIsoDateUtc(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultDateWindow() {
  const now = new Date();
  const to = localIsoDateUtc(now);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - 7);
  return { from: localIsoDateUtc(fromDate), to };
}

/**
 * @param {string} name
 * @param {string} url
 */
async function probeAnyhiresEndpoint(name, url) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - startedAt;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    let totalRows = null;
    let count = null;
    let skillsCount = null;
    let error = null;

    if (response.ok && contentType.includes('application/json')) {
      const payload = await response.json();
      const totalRowsNum = Number(payload?.totalRows);
      const countNum = Number(payload?.count);
      if (Number.isFinite(totalRowsNum) && totalRowsNum >= 0) totalRows = totalRowsNum;
      if (Number.isFinite(countNum) && countNum >= 0) count = countNum;
      if (Array.isArray(payload?.skills)) skillsCount = payload.skills.length;
      else if (Array.isArray(payload)) skillsCount = payload.length;
    } else if (!response.ok) {
      const text = await response.text().catch(() => '');
      error = text.slice(0, 300) || `HTTP ${response.status}`;
    }

    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      latencyMs,
      totalRows,
      count,
      skillsCount,
      error,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const message =
      err?.name === 'AbortError'
        ? `Timeout after ${PROBE_TIMEOUT_MS}ms`
        : err?.message || String(err);
    return {
      name,
      url,
      ok: false,
      status: null,
      latencyMs,
      totalRows: null,
      count: null,
      skillsCount: null,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Lightweight upstream probes used by seeker jobs and agent clients. */
export async function checkAnyhiresHealth() {
  const { from, to } = defaultDateWindow();
  const listParams = new URLSearchParams({
    from,
    to,
    page: '1',
    pageSize: '1',
  });

  const probes = await Promise.all([
    probeAnyhiresEndpoint(
      'global-remote-positions',
      `${ANYHIRES_BASE}/api/global-remote-positions?${listParams.toString()}`
    ),
    probeAnyhiresEndpoint(
      'remote-positions',
      `${ANYHIRES_BASE}/api/remote-positions?${listParams.toString()}`
    ),
    probeAnyhiresEndpoint('all-skills', `${ANYHIRES_BASE}/api/all-skills`),
  ]);

  return {
    ok: probes.every((probe) => probe.ok),
    checkedAt: new Date().toISOString(),
    upstream: ANYHIRES_BASE,
    window: { from, to },
    probes,
  };
}
