import test from 'node:test';
import assert from 'node:assert/strict';
import { slugifyIndustryName } from '../src/services/companiesService.js';

test('slugifyIndustryName normalizes industry labels', () => {
  assert.equal(slugifyIndustryName('  FinTech '), 'fintech');
  assert.equal(slugifyIndustryName('Игры / GameDev'), 'игры-gamedev');
});
