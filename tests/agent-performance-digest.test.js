import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAgentPerformanceDigestMessage } from '../src/services/agentPerformanceDigestService.js';
import { resolvePerformanceAgentUserId } from '../src/services/agentPerformanceStatsService.js';

function mockPerformanceReq({
  actorUserId,
  isBotAdmin = false,
  isCareerAgent = false,
  isGlobalEasyApplyAgent = false,
  agentUserId = null,
} = {}) {
  return {
    actorUser: { Id: actorUserId },
    isBotAdmin,
    isCareerAgent,
    isGlobalEasyApplyAgent,
    query: agentUserId != null ? { agentUserId: String(agentUserId) } : {},
  };
}

test('formatAgentPerformanceDigestMessage renders 24h / 7d / 30d sections', () => {
  const message = formatAgentPerformanceDigestMessage([
    {
      label: 'Last 24 hours',
      stats: {
        byAgent: [
          { agentName: 'User 1', appliedCount: 23 },
          { agentName: 'User 2', appliedCount: 20 },
          { agentName: 'User 3', appliedCount: 10 },
        ],
      },
    },
    {
      label: 'Last 7 days',
      stats: {
        byAgent: [
          { agentName: 'User 1', appliedCount: 230 },
          { agentName: 'User 2', appliedCount: 200 },
          { agentName: 'User 3', appliedCount: 100 },
        ],
      },
    },
    {
      label: 'Last 30 days',
      stats: {
        byAgent: [
          { agentName: 'User 1', appliedCount: 2300 },
          { agentName: 'User 2', appliedCount: 2002 },
          { agentName: 'User 3', appliedCount: 1003 },
        ],
      },
    },
  ]);

  assert.match(message, /Last 24 hours[\s\S]*User 1 — 23 applications/);
  assert.match(message, /Last 7 days[\s\S]*User 1 — 230 applications/);
  assert.match(message, /Last 30 days[\s\S]*User 1 — 2300 applications/);
});

test('formatAgentPerformanceDigestMessage shows placeholder when empty', () => {
  const message = formatAgentPerformanceDigestMessage([
    { label: 'Last 24 hours', stats: { byAgent: [] } },
  ]);
  assert.match(message, /Last 24 hours[\s\S]*\(no applications\)/);
});

test('resolvePerformanceAgentUserId scopes global Easy Apply agents to own stats', () => {
  assert.equal(
    resolvePerformanceAgentUserId(
      mockPerformanceReq({ actorUserId: 99, isGlobalEasyApplyAgent: true })
    ),
    99
  );
  assert.equal(
    resolvePerformanceAgentUserId(
      mockPerformanceReq({ actorUserId: 10, isCareerAgent: true })
    ),
    10
  );
  assert.equal(
    resolvePerformanceAgentUserId(mockPerformanceReq({ actorUserId: 10 })),
    undefined
  );
});

test('resolvePerformanceAgentUserId lets admins filter by agentUserId', () => {
  assert.equal(
    resolvePerformanceAgentUserId(
      mockPerformanceReq({ actorUserId: 1, isBotAdmin: true, agentUserId: 42 })
    ),
    42
  );
  assert.equal(
    resolvePerformanceAgentUserId(
      mockPerformanceReq({ actorUserId: 1, isBotAdmin: true })
    ),
    null
  );
});
