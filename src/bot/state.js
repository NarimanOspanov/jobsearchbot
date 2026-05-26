/** @type {Map<number, { step: string }>} */
export const hireAgentStateByChatId = new Map();

/** @type {Map<number, { positionId: string }>} */
export const positionApplyChannelBypassByChatId = new Map();

/** @type {Map<number, { positionId: string, publisherUserId: number, publishedInChatId: number }>} */
export const positionApplyAttributionByChatId = new Map();

export function setPositionApplyAttribution(chatId, data) {
  const id = Number(chatId);
  const positionId = String(data?.positionId || '').trim().toLowerCase();
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
 * @returns {{ positionId: string, publisherUserId: number, publishedInChatId: number } | null}
 */
export function takePositionApplyAttribution(chatId, positionId) {
  const id = Number(chatId);
  const key = String(positionId || '').trim().toLowerCase();
  if (!id || !key) return null;
  const row = positionApplyAttributionByChatId.get(id);
  if (!row || row.positionId !== key) return null;
  positionApplyAttributionByChatId.delete(id);
  return row;
}

/** @type {Set<number>} */
export const legacyKeyboardClearedByChatId = new Set();

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
