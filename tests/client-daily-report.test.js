import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClientDailyReportMessage,
  isClientDailyReportTestOnlyMode,
  isClientDailyReportTestTarget,
  parseDailyReportPeriod,
} from '../src/services/clientDailyReportService.js';

test('formatClientDailyReportMessage renders English greeting with name', () => {
  const message = formatClientDailyReportMessage({
    firstName: 'Nikita',
    language: 'en',
    appliedCount: 25,
    rows: [
      { vacancyTitle: 'Senior Fullstack Developer', companyName: 'Acme' },
      { vacancyTitle: 'Backend Engineer', companyName: 'Globex' },
    ],
  });
  assert.match(message, /Hey, Nikita!/);
  assert.match(message, /Today we applied to 25 positions/);
  assert.match(message, /Top applications:/);
  assert.match(message, /Senior Fullstack Developer — Acme/);
  assert.doesNotMatch(message, /Check report with details here/);
});

test('formatClientDailyReportMessage renders Russian copy without name', () => {
  const message = formatClientDailyReportMessage({
    firstName: '',
    language: 'ru',
    appliedCount: 1,
    rows: [{ vacancyTitle: 'Frontend Developer', companyName: 'Ромашка' }],
  });
  assert.match(message, /Привет!/);
  assert.match(message, /Сегодня мы откликнулись/);
  assert.match(message, /Топ откликов:/);
  assert.match(message, /Frontend Developer — Ромашка/);
});

test('parseDailyReportPeriod maps UI period values', () => {
  assert.equal(parseDailyReportPeriod('24h').period, '24h');
  assert.equal(parseDailyReportPeriod('7d').period, '7d');
  assert.equal(parseDailyReportPeriod('30d').period, '30d');
  assert.equal(parseDailyReportPeriod('all').allTime, true);
  assert.equal(parseDailyReportPeriod('all').since, null);
});

test('delivery mode helpers are consistent with config', () => {
  const mode = isClientDailyReportTestOnlyMode();
  if (!mode) {
    assert.equal(mode, false);
    return;
  }
  const targetProbe = 5934959951;
  const match = isClientDailyReportTestTarget(targetProbe);
  const mismatch = isClientDailyReportTestTarget(targetProbe + 1);
  if (match) {
    assert.equal(mismatch, false);
  } else {
    assert.equal(match, false);
  }
});
