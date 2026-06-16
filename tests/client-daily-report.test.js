import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClientDailyReportMessage,
  isClientDailyReportTestOnlyMode,
  isClientDailyReportTestTarget,
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
  assert.match(message, /Hi, Nikita!/);
  assert.match(message, /applied to 25 positions/);
  assert.match(message, /Applied jobs:/);
  assert.match(message, /Senior Fullstack Developer — Acme/);
});

test('formatClientDailyReportMessage renders Russian copy without name', () => {
  const message = formatClientDailyReportMessage({
    firstName: '',
    language: 'ru',
    appliedCount: 1,
    rows: [{ vacancyTitle: 'Frontend Developer', companyName: 'Ромашка' }],
  });
  assert.match(message, /Привет!/);
  assert.match(message, /За последний день/);
  assert.match(message, /Список откликов:/);
  assert.match(message, /Frontend Developer — Ромашка/);
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
