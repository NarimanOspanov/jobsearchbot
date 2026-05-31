/** @type {Map<number, { step: string }>} */
export const hireAgentStateByChatId = new Map();

/** @type {Map<number, { positionId: string, publisherUserId?: number, publishedInChatId?: number }>} */
export const positionApplyChannelBypassByChatId = new Map();

/** @type {Map<number, { positionId: string, publisherUserId: number, publishedInChatId: number }>} */
export const positionApplyAttributionByChatId = new Map();

function normalizePositionKey(positionId) {
  return String(positionId || '').trim().toLowerCase();
}

export function setPositionApplyAttribution(chatId, data) {
  const id = Number(chatId);
  const positionId = normalizePositionKey(data?.positionId);
  const publisherUserId = Number(data?.publisherUserId);
  const publishedInChatId = Number(data?.publishedInChatId);
  if (!id || !positionId) return;
  if (!Number.isSafeInteger(publisherUserId) || publisherUserId <= 0) return;
  if (!Number.isSafeInteger(publishedInChatId) || publishedInChatId === 0) return;
  positionApplyAttributionByChatId.set(id, {
    positionId,
    publisherUserId,
    publishedInChatId,
  });
}

/**
 * Read tracked link attribution without removing it.
 * @returns {{ positionId: string, publisherUserId: number, publishedInChatId: number } | null}
 */
export function getPositionApplyAttribution(chatId, positionId) {
  const id = Number(chatId);
  const key = normalizePositionKey(positionId);
  if (!id || !key) return null;

  const row = positionApplyAttributionByChatId.get(id);
  if (row && row.positionId === key) return row;

  const bypass = positionApplyChannelBypassByChatId.get(id);
  if (
    bypass &&
    normalizePositionKey(bypass.positionId) === key &&
    Number.isSafeInteger(Number(bypass.publisherUserId)) &&
    Number(bypass.publisherUserId) > 0 &&
    Number.isSafeInteger(Number(bypass.publishedInChatId)) &&
    Number(bypass.publishedInChatId) !== 0
  ) {
    return {
      positionId: key,
      publisherUserId: Number(bypass.publisherUserId),
      publishedInChatId: Number(bypass.publishedInChatId),
    };
  }

  return null;
}

/**
 * @param {object} [hireAgentState]
 * @returns {{ positionId: string, publisherUserId: number, publishedInChatId: number } | null}
 */
export function resolvePositionApplyAttribution(chatId, positionId, hireAgentState = null) {
  const key = normalizePositionKey(positionId);
  if (!key) return null;

  const stPos = normalizePositionKey(hireAgentState?.positionId);
  const stPublisher = Number(hireAgentState?.publisherUserId);
  const stResource = Number(hireAgentState?.publishedInChatId);
  if (
    (!stPos || stPos === key) &&
    Number.isSafeInteger(stPublisher) &&
    stPublisher > 0 &&
    Number.isSafeInteger(stResource) &&
    stResource !== 0
  ) {
    return {
      positionId: key,
      publisherUserId: stPublisher,
      publishedInChatId: stResource,
    };
  }

  return getPositionApplyAttribution(chatId, positionId);
}

/**
 * @returns {{ positionId: string, publisherUserId: number, publishedInChatId: number } | null}
 */
export function takePositionApplyAttribution(chatId, positionId) {
  const row = getPositionApplyAttribution(chatId, positionId);
  if (!row) return null;
  clearPositionApplyAttributionStores(chatId);
  return row;
}

export function clearPositionApplyAttributionStores(chatId) {
  const id = Number(chatId);
  if (!id) return;
  positionApplyAttributionByChatId.delete(id);
}

/** @type {Set<number>} */
/** @type {Map<string, object>} */
export const cvScoreResultByUserId = new Map();

export const adminNotificationRunControl = {
  activeRunId: null,
  stopRequestedRunIds: new Set(),
};

export const runtimeBot = {
  username: '',
  telegram: null,
};

export const screeningCronHealthState = {
  intervalMs: 60_000,
  startupDelayMs: 30_000,
  running: false,
  runCount: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastResult: null,
  lastError: null,
};
