import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgentUserIdForAppliedStatus,
  applyAppliedAtForAppliedStatus,
  isAppliedApplicationStatus,
  resolveApplyingAgentUserId,
} from '../src/services/applicationAgentAttribution.js';

function mockReq({ actorUserId, isBotAdmin = false, agentUserId = null } = {}) {
  return {
    actorUser: { Id: actorUserId },
    isBotAdmin,
    query: agentUserId != null ? { agentUserId: String(agentUserId) } : {},
    body: agentUserId != null ? { agentUserId } : {},
  };
}

test('isAppliedApplicationStatus matches applied case-insensitively', () => {
  assert.equal(isAppliedApplicationStatus('applied'), true);
  assert.equal(isAppliedApplicationStatus(' Applied '), true);
  assert.equal(isAppliedApplicationStatus('new'), false);
});

test('resolveApplyingAgentUserId returns actor for career agent applying for client', async () => {
  const agentId = await resolveApplyingAgentUserId(mockReq({ actorUserId: 10 }), 20);
  assert.equal(agentId, 10);
});

test('resolveApplyingAgentUserId returns null when client applies for themselves', async () => {
  const agentId = await resolveApplyingAgentUserId(mockReq({ actorUserId: 20 }), 20);
  assert.equal(agentId, null);
});

test('resolveApplyingAgentUserId honors admin impersonation from body', async () => {
  const agentId = await resolveApplyingAgentUserId(
    mockReq({ actorUserId: 1, isBotAdmin: true, agentUserId: 42 }),
    20
  );
  assert.equal(agentId, 42);
});

test('applyAgentUserIdForAppliedStatus sets AgentUserId when status becomes applied', async () => {
  const updates = { Status: 'applied' };
  await applyAgentUserIdForAppliedStatus(
    updates,
    mockReq({ actorUserId: 10 }),
    { UserId: 20, Status: 'new', AgentUserId: null }
  );
  assert.equal(updates.AgentUserId, 10);
});

test('applyAgentUserIdForAppliedStatus backfills AgentUserId on already-applied rows', async () => {
  const updates = { Notes: 'proof uploaded' };
  await applyAgentUserIdForAppliedStatus(
    updates,
    mockReq({ actorUserId: 10 }),
    { UserId: 20, Status: 'applied', AgentUserId: null }
  );
  assert.equal(updates.AgentUserId, 10);
});

test('applyAgentUserIdForAppliedStatus does not overwrite existing AgentUserId', async () => {
  const updates = { Status: 'applied' };
  await applyAgentUserIdForAppliedStatus(
    updates,
    mockReq({ actorUserId: 99 }),
    { UserId: 20, Status: 'applied', AgentUserId: 10 }
  );
  assert.equal(updates.AgentUserId, undefined);
});

test('applyAgentUserIdForAppliedStatus ignores non-applied status updates', async () => {
  const updates = { Status: 'new' };
  await applyAgentUserIdForAppliedStatus(
    updates,
    mockReq({ actorUserId: 10 }),
    { UserId: 20, Status: 'new', AgentUserId: null }
  );
  assert.equal(updates.AgentUserId, undefined);
});

test('applyAppliedAtForAppliedStatus sets AppliedAt on first transition to applied', () => {
  const now = new Date('2026-06-08T12:00:00.000Z');
  const updates = { Status: 'applied' };
  applyAppliedAtForAppliedStatus(
    updates,
    { Status: 'new', AppliedAt: new Date('2026-06-01T00:00:00.000Z') },
    now
  );
  assert.equal(updates.AppliedAt, now);
});

test('applyAppliedAtForAppliedStatus keeps AppliedAt when already applied', () => {
  const updates = { Status: 'applied', Notes: 'updated' };
  applyAppliedAtForAppliedStatus(
    updates,
    { Status: 'applied', AppliedAt: new Date('2026-06-01T00:00:00.000Z') }
  );
  assert.equal(updates.AppliedAt, undefined);
});

test('applyAppliedAtForAppliedStatus respects explicit AppliedAt from client', () => {
  const explicit = new Date('2026-05-15T09:30:00.000Z');
  const updates = { Status: 'applied', AppliedAt: explicit };
  applyAppliedAtForAppliedStatus(updates, { Status: 'new' });
  assert.equal(updates.AppliedAt, explicit);
});

test('applyAppliedAtForAppliedStatus ignores non-applied status updates', () => {
  const updates = { Status: 'skipped' };
  applyAppliedAtForAppliedStatus(updates, { Status: 'new' });
  assert.equal(updates.AppliedAt, undefined);
});
