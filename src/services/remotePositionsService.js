/**
 * Upstream global-remote-positions API (anyhires.com).
 */

function localIsoDateUtc(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar window covering the last ~24 hours (yesterday + today UTC). */
export function getRemoteJobsDigestDateRange() {
  const now = new Date();
  const to = localIsoDateUtc(now);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - 1);
  const from = localIsoDateUtc(fromDate);
  return { from, to };
}

/**
 * @param {{ from: string, to: string, skillIds?: string }} params
 */
export async function fetchGlobalRemotePositionCount({ from, to, skillIds }) {
  const upstreamParams = new URLSearchParams();
  upstreamParams.set('from', from);
  upstreamParams.set('to', to);
  upstreamParams.set('page', '1');
  upstreamParams.set('pageSize', '1');
  const normalizedSkillIds = String(skillIds || '').trim();
  if (normalizedSkillIds) upstreamParams.set('skillIds', normalizedSkillIds);

  const url = `https://anyhires.com/api/global-remote-positions?${upstreamParams.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    throw new Error(txt || `Upstream positions request failed (${response.status})`);
  }
  const payload = await response.json();
  const totalRows = Number(payload?.totalRows);
  if (Number.isFinite(totalRows) && totalRows >= 0) return totalRows;
  const count = Number(payload?.count);
  if (Number.isFinite(count) && count >= 0) return count;
  const positions = Array.isArray(payload?.positions) ? payload.positions : [];
  return positions.length;
}

/**
 * @param {number[]} skillIds
 */
export async function fetchSkillPositionCounts(skillIds, dateRange) {
  const unique = [...new Set(skillIds.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const counts = new Map();
  await Promise.all(
    unique.map(async (skillId) => {
      const count = await fetchGlobalRemotePositionCount({
        from: dateRange.from,
        to: dateRange.to,
        skillIds: String(skillId),
      });
      counts.set(skillId, count);
    })
  );
  return counts;
}
