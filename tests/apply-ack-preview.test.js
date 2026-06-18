import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommaSeparatedStrings } from '../src/config.js';
import { clientHasApplyPrioritySkills } from '../src/services/agentApplyPriorityService.js';
import { selectTopPreviewJobs } from '../src/services/applyAckPreviewService.js';
import {
  buildScreeningAckReplyMarkup,
  SCREENING_SEE_ALL_POSITIONS_CALLBACK,
} from '../src/services/positionApplyScreeningService.js';
import {
  buildTopJobsTelegraphContent,
  createTelegraphPage,
  resolveJobPreviewHref,
  resolveTelegraphAccessTokens,
} from '../src/services/telegraphService.js';

test('buildTopJobsTelegraphContent renders date range and grouped job links', () => {
  const nodes = buildTopJobsTelegraphContent({
    jobs: [
      { id: 1, title: 'Engineer', company: 'Acme', source: 'linkedin', applyType: 'easy_apply' },
      { id: 2, title: 'Designer', company: 'Beta', source: 'company', applyType: 'site' },
    ],
    lang: 'en',
    dateFrom: '2026-06-11',
    dateTo: '2026-06-18',
    appBaseUrl: 'https://app.example.com',
  });

  assert.equal(nodes[0].tag, 'p');
  assert.equal(nodes[0].children[0], '2026-06-11 — 2026-06-18');
  assert.ok(nodes.some((n) => n.tag === 'h4' && n.children[0] === 'LinkedIn'));
  const linkNode = nodes.find(
    (n) => n.tag === 'p' && n.children?.[0]?.tag === 'a' && n.children[0].children[0] === 'Engineer at Acme'
  );
  assert.ok(linkNode);
  assert.equal(
    linkNode.children[0].attrs.href,
    'https://app.example.com/app/seeker-jobs-deeplink?jobId=1'
  );
});

test('resolveJobPreviewHref prefers applyUrl over deeplink', () => {
  assert.equal(
    resolveJobPreviewHref({ id: 5, applyUrl: 'https://jobs.example.com/5' }, 'https://app.example.com'),
    'https://jobs.example.com/5'
  );
});

test('selectTopPreviewJobs filters skip and takes top 10 by applyRank', () => {
  const jobsById = new Map([
    [1, { id: 1, title: 'A' }],
    [2, { id: 2, title: 'B' }],
    [3, { id: 3, title: 'C' }],
    [4, { id: 4, title: 'D' }],
  ]);
  const rankings = [
    { jobId: 3, applyRank: 1, priority: 'apply_first' },
    { jobId: 1, applyRank: 2, priority: 'good' },
    { jobId: 2, applyRank: 3, priority: 'skip' },
    { jobId: 4, applyRank: 4, priority: 'good' },
  ];
  const top = selectTopPreviewJobs(rankings, jobsById, 10);
  assert.deepEqual(top.map((j) => j.id), [3, 1, 4]);
});

test('buildScreeningAckReplyMarkup includes url row only when previewUrl is set', () => {
  const without = buildScreeningAckReplyMarkup('en');
  assert.equal(without.inline_keyboard.length, 1);
  assert.equal(without.inline_keyboard[0][0].callback_data, SCREENING_SEE_ALL_POSITIONS_CALLBACK);
  assert.equal(without.inline_keyboard[0][0].url, undefined);

  const withUrl = buildScreeningAckReplyMarkup('en', { previewUrl: 'https://telegra.ph/top-matches' });
  assert.equal(withUrl.inline_keyboard.length, 2);
  assert.equal(withUrl.inline_keyboard[0][0].url, 'https://telegra.ph/top-matches');
  assert.equal(withUrl.inline_keyboard[1][0].callback_data, SCREENING_SEE_ALL_POSITIONS_CALLBACK);
});

test('clientHasApplyPrioritySkills is false when user has no skills', () => {
  assert.equal(clientHasApplyPrioritySkills({ skills: [] }), false);
  assert.equal(clientHasApplyPrioritySkills({ skills: null }), false);
  assert.equal(clientHasApplyPrioritySkills({ skills: [1, 2] }), true);
});

test('parseCommaSeparatedStrings parses comma-separated Telegraph tokens', () => {
  assert.deepEqual(parseCommaSeparatedStrings('a,b, c'), ['a', 'b', 'c']);
  assert.deepEqual(parseCommaSeparatedStrings('a,a,b'), ['a', 'b']);
  assert.deepEqual(parseCommaSeparatedStrings(''), []);
});

test('resolveTelegraphAccessTokens prefers explicit accessTokens list', () => {
  assert.deepEqual(resolveTelegraphAccessTokens(null, ['one', 'two']), ['one', 'two']);
  assert.deepEqual(resolveTelegraphAccessTokens('solo', ['one', 'two']), ['one', 'two']);
});

test('createTelegraphPage tries next token when first fails', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) {
      return { json: async () => ({ ok: false, error: 'ACCESS_TOKEN_INVALID' }) };
    }
    return {
      json: async () => ({
        ok: true,
        result: { url: 'https://telegra.ph/top-matches-06-18', path: 'top-matches-06-18' },
      }),
    };
  };
  try {
    const page = await createTelegraphPage({
      title: 'Matches',
      contentNodes: [{ tag: 'p', children: ['hello'] }],
      accessTokens: ['bad-token', 'good-token'],
    });
    assert.equal(page.url, 'https://telegra.ph/top-matches-06-18');
    assert.equal(call, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
