import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgentUserIdForAppliedStatus,
  resolveApplyingAgentUserId,
} from '../src/services/applicationAgentAttribution.js';
import {
  clientHasResumeForAgentAccess,
  isGlobalEasyApplyAgentUserId,
  parseGlobalEasyApplyAgentTelegramChatIds,
  resolveAgentWorkflowModeFromFlags,
} from '../src/services/agentAccessService.js';

function mockReq({ actorUserId, isBotAdmin = false, agentUserId = null } = {}) {
  return {
    actorUser: { Id: actorUserId },
    isBotAdmin,
    query: agentUserId != null ? { agentUserId: String(agentUserId) } : {},
    body: agentUserId != null ? { agentUserId } : {},
  };
}

test('resolveAgentWorkflowModeFromFlags prioritizes admin then easy_apply then external', () => {
  assert.equal(
    resolveAgentWorkflowModeFromFlags({ isBotAdmin: true, isGlobalEasyApply: true, hasAssignments: true }),
    'admin'
  );
  assert.equal(
    resolveAgentWorkflowModeFromFlags({ isBotAdmin: false, isGlobalEasyApply: true, hasAssignments: false }),
    'easy_apply'
  );
  assert.equal(
    resolveAgentWorkflowModeFromFlags({ isBotAdmin: false, isGlobalEasyApply: false, hasAssignments: true }),
    'external'
  );
  assert.equal(
    resolveAgentWorkflowModeFromFlags({ isBotAdmin: false, isGlobalEasyApply: false, hasAssignments: false }),
    'none'
  );
});

test('isGlobalEasyApplyAgentUserId matches any configured specialist id', () => {
  assert.equal(isGlobalEasyApplyAgentUserId(42, [42, 99]), true);
  assert.equal(isGlobalEasyApplyAgentUserId(99, [42, 99]), true);
  assert.equal(isGlobalEasyApplyAgentUserId(41, [42, 99]), false);
  assert.equal(isGlobalEasyApplyAgentUserId(42, []), false);
});

test('parseGlobalEasyApplyAgentTelegramChatIds parses comma-separated env-style values', () => {
  assert.deepEqual(parseGlobalEasyApplyAgentTelegramChatIds('42, 99 ,101'), [42, 99, 101]);
  assert.deepEqual(parseGlobalEasyApplyAgentTelegramChatIds('42,42,99'), [42, 99]);
  assert.deepEqual(parseGlobalEasyApplyAgentTelegramChatIds(''), []);
});

test('clientHasResumeForAgentAccess requires non-empty ResumeURL', () => {
  assert.equal(clientHasResumeForAgentAccess({ ResumeURL: 'https://example.com/cv.pdf' }), true);
  assert.equal(clientHasResumeForAgentAccess({ ResumeURL: '   ' }), false);
  assert.equal(clientHasResumeForAgentAccess({ ResumeURL: null }), false);
});

test('resolveApplyingAgentUserId credits global Easy Apply specialist when they mark applied', async () => {
  const specialistId = 99;
  const clientId = 20;
  const agentId = await resolveApplyingAgentUserId(mockReq({ actorUserId: specialistId }), clientId);
  assert.equal(agentId, specialistId);

  const updates = { Status: 'applied' };
  await applyAgentUserIdForAppliedStatus(
    updates,
    mockReq({ actorUserId: specialistId }),
    { UserId: clientId, Status: 'new', AgentUserId: null }
  );
  assert.equal(updates.AgentUserId, specialistId);
});
