import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentPortalTailorSource,
  shouldBypassMonetizationForAiGeneration,
} from '../src/routes/api/resume.js';

test('isAgentPortalTailorSource recognizes agent and admin portals only', () => {
  assert.equal(isAgentPortalTailorSource('agent-clients'), true);
  assert.equal(isAgentPortalTailorSource('admin'), true);
  assert.equal(isAgentPortalTailorSource('job-search'), false);
  assert.equal(isAgentPortalTailorSource('api-upload'), false);
});

test('shouldBypassMonetizationForAiGeneration bypasses when agent works on a client', async () => {
  assert.equal(
    await shouldBypassMonetizationForAiGeneration({
      actorUserId: 10,
      seekerUserId: 20,
      tailorSource: 'agent-clients',
      isBotAdmin: false,
    }),
    true
  );
});

test('shouldBypassMonetizationForAiGeneration keeps seeker job-search monetization', async () => {
  assert.equal(
    await shouldBypassMonetizationForAiGeneration({
      actorUserId: 10,
      seekerUserId: 10,
      tailorSource: 'job-search',
      isBotAdmin: false,
    }),
    false
  );
});

test('shouldBypassMonetizationForAiGeneration bypasses admin testing own client in agent portal', async () => {
  assert.equal(
    await shouldBypassMonetizationForAiGeneration({
      actorUserId: 10,
      seekerUserId: 10,
      tailorSource: 'agent-clients',
      isBotAdmin: true,
    }),
    true
  );
});
