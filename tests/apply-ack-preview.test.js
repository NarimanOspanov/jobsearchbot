import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstSkillIdFromUser,
  getDateRangeForDays,
  takeFirstPositions,
} from '../src/services/applyAckPreviewService.js';
import {
  buildScreeningAckReplyMarkup,
  buildScreeningAckText,
  SCREENING_SEE_ALL_POSITIONS_CALLBACK,
} from '../src/services/positionApplyScreeningService.js';
import { formatTopJobsTelegramHtml, resolveJobPreviewHref } from '../src/services/telegraphService.js';

test('getDateRangeForDays defaults to 3-day span', () => {
  const range = getDateRangeForDays(3);
  assert.equal(range.days, 3);
  assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(range.to, /^\d{4}-\d{2}-\d{2}$/);
});

test('firstSkillIdFromUser returns first normalized skill id', () => {
  assert.equal(firstSkillIdFromUser({ skills: [42, 99] }), 42);
  assert.equal(firstSkillIdFromUser({ skills: [] }), null);
});

test('takeFirstPositions returns first N jobs from API order', () => {
  const jobs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }];
  assert.deepEqual(takeFirstPositions(jobs, 5).map((j) => j.id), [1, 2, 3, 4, 5]);
});

test('formatTopJobsTelegramHtml renders bulleted clickable job lines', () => {
  const html = formatTopJobsTelegramHtml({
    jobs: [
      { id: 1, title: 'Full-Stack Product Engineer', company: 'The Flex' },
      { id: 2, title: 'Javascript Developer - Remote Work', company: 'BairesDev' },
    ],
    appBaseUrl: 'https://app.example.com',
  });
  assert.match(html, /^- <a href="/);
  assert.ok(html.includes('Full-Stack Product Engineer at The Flex'));
  assert.ok(html.includes('seeker-jobs-deeplink?jobId=1'));
  assert.ok(html.includes('</a>\n\n- <a href='));
});

test('buildScreeningAckText includes job list in acceptance message', () => {
  const text = buildScreeningAckText('en', {
    previewCount: 5,
    jobListHtml: '- <a href="https://x">Role at Co</a>',
  });
  assert.ok(!text.includes('Get access to 100% remote job listings'));
  assert.ok(text.includes('Your application is in review'));
  assert.ok(text.includes('We found 5 strong matches'));
  assert.ok(text.includes('Role at Co'));
});

test('buildScreeningAckReplyMarkup opens TMA when subscribed', () => {
  const markup = buildScreeningAckReplyMarkup(
    'en',
    { seekerJobsUrl: 'https://app.example.com/app/seeker-jobs', canUseSeekerJobsWebApp: true },
    { channelSubscribed: true }
  );
  assert.equal(markup.inline_keyboard[0][0].text, 'See all positions');
  assert.equal(markup.inline_keyboard[0][0].web_app.url, 'https://app.example.com/app/seeker-jobs');
});

test('buildScreeningAckReplyMarkup uses subscribe gate callback when not subscribed', () => {
  const markup = buildScreeningAckReplyMarkup(
    'en',
    { seekerJobsUrl: 'https://app.example.com/app/seeker-jobs', canUseSeekerJobsWebApp: true },
    { channelSubscribed: false }
  );
  assert.equal(markup.inline_keyboard[0][0].text, 'See all positions');
  assert.equal(markup.inline_keyboard[0][0].callback_data, SCREENING_SEE_ALL_POSITIONS_CALLBACK);
});

test('resolveJobPreviewHref prefers applyUrl over deeplink', () => {
  assert.equal(
    resolveJobPreviewHref({ id: 5, applyUrl: 'https://jobs.example.com/5' }, 'https://app.example.com'),
    'https://jobs.example.com/5'
  );
});
