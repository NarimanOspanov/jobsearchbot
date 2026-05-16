/** @type {Map<number, { step: string }>} */
export const hireAgentStateByChatId = new Map();

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

/** @type {Set<number>} */
export const menuSyncedChatIds = new Set();
