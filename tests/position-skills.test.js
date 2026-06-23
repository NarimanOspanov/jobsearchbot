import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergePositionSkillsIntoUser,
  normalizePositionSkillIds,
  serializePositionSkillsForDb,
} from '../src/services/userService.js';

test('normalizePositionSkillIds accepts arrays and JSON strings', () => {
  assert.deepEqual(normalizePositionSkillIds([3, 1, 3, 0]), [3, 1]);
  assert.deepEqual(normalizePositionSkillIds('[42, 7]'), [42, 7]);
  assert.deepEqual(normalizePositionSkillIds(''), []);
});

test('mergePositionSkillsIntoUser adds position skills without removing existing', async () => {
  const updates = [];
  const user = {
    skills: [10],
    async update(patch) {
      updates.push(patch);
      Object.assign(this, patch);
    },
  };
  await mergePositionSkillsIntoUser(user, { Skills: [20, 10] });
  assert.deepEqual(updates, [{ skills: [10, 20] }]);
});

test('serializePositionSkillsForDb stores JSON array text', () => {
  assert.equal(serializePositionSkillsForDb([4, 15]), '[4,15]');
  assert.equal(serializePositionSkillsForDb([]), null);
});

test('mergePositionSkillsIntoUser is a no-op when position has no skills', async () => {
  let updated = false;
  const user = {
    skills: [10],
    async update() {
      updated = true;
    },
  };
  await mergePositionSkillsIntoUser(user, { Skills: [] });
  assert.equal(updated, false);
});
