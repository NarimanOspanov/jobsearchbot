import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStartParam,
  parseLegacySeekerJobs,
  decodeSourceMask,
  expandCompactDate,
  filtersToUrlSearchParams,
} from '../src/utils/parseStartParam.js';

function encodeLegacySeekerJobsQuery(query) {
  return btoa(query).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

test('sj2__100.11.260611.260613 decodes compact channel link', () => {
  const result = parseStartParam('sj2__100.11.260611.260613');
  assert.equal(result?.kind, 'search');
  assert.deepEqual(result?.filters, {
    skillIds: [100],
    sourceIds: [1, 2, 4],
    dateFrom: '2026-06-11',
    dateTo: '2026-06-13',
    showOnlyHighlyRelevant: true,
  });
});

test('sj2__0.11.260611.260613 has no skill filter', () => {
  const result = parseStartParam('sj2__0.11.260611.260613');
  assert.equal(result?.kind, 'search');
  assert.deepEqual(result?.filters?.skillIds, []);
  assert.equal(result?.filters?.showOnlyHighlyRelevant, false);
  assert.deepEqual(result?.filters?.sourceIds, [1, 2, 4]);
});

test('legacy seekerjobs base64 payload decodes to same filters', () => {
  const query =
    'from=2026-06-11&to=2026-06-13&skillIds=100&sourceIds=1,2,4&showOnlyHighlyRelevant=true';
  const payload = encodeLegacySeekerJobsQuery(query);
  const result = parseStartParam(`seekerjobs__${payload}`);
  assert.equal(result?.kind, 'search');
  assert.deepEqual(result?.filters, {
    skillIds: [100],
    sourceIds: [1, 2, 4],
    dateFrom: '2026-06-11',
    dateTo: '2026-06-13',
    showOnlyHighlyRelevant: true,
  });
});

test('search__ returns legacy web token', () => {
  const result = parseStartParam('search__SOME_TOKEN');
  assert.deepEqual(result, { kind: 'legacyWeb', encryptedQ: 'SOME_TOKEN' });
});

test('empty or unknown start param returns null', () => {
  assert.equal(parseStartParam(''), null);
  assert.equal(parseStartParam('unknown__abc'), null);
});

test('source bitmask uses bit positions, not raw source ids', () => {
  assert.deepEqual(decodeSourceMask(11), [1, 2, 4]);
  assert.deepEqual(decodeSourceMask(1), [1]);
  assert.deepEqual(decodeSourceMask(4), [3]);
});

test('expandCompactDate expands yyMMdd', () => {
  assert.equal(expandCompactDate('260611'), '2026-06-11');
  assert.equal(expandCompactDate('bad'), null);
});

test('parseLegacySeekerJobs accepts plain query fallback', () => {
  const filters = parseLegacySeekerJobs('from=2026-06-11&to=2026-06-13&skillIds=100');
  assert.equal(filters?.dateFrom, '2026-06-11');
  assert.deepEqual(filters?.skillIds, [100]);
});

test('production sj2 channel link startapp=sj2__23.11.260611.260613', () => {
  const result = parseStartParam('sj2__23.11.260611.260613');
  assert.equal(result?.kind, 'search');
  assert.deepEqual(result?.filters, {
    skillIds: [23],
    sourceIds: [1, 2, 4],
    dateFrom: '2026-06-11',
    dateTo: '2026-06-13',
    showOnlyHighlyRelevant: true,
  });
  const qs = filtersToUrlSearchParams(result.filters);
  assert.equal(qs.get('from'), '2026-06-11');
  assert.equal(qs.get('to'), '2026-06-13');
  assert.equal(qs.get('skillIds'), '23');
  assert.equal(qs.get('sourceIds'), '1,2,4');
  assert.equal(qs.get('applyTypes'), 'telegram,linkedin,indeed');
  assert.equal(qs.get('showOnlyHighlyRelevant'), 'true');
});

test('production legacy seekerjobs base64 channel link (skillIds=111)', () => {
  const startapp =
    'seekerjobs__ZnJvbT0yMDI2LTA2LTExJnRvPTIwMjYtMDYtMTMmc2tpbGxJZHM9MTExJnNvdXJjZUlkcz0xLDIsNCZzaG93T25seUhpZ2hseVJlbGV2YW50PXRydWU';
  const result = parseStartParam(startapp);
  assert.equal(result?.kind, 'search');
  assert.deepEqual(result?.filters, {
    skillIds: [111],
    sourceIds: [1, 2, 4],
    dateFrom: '2026-06-11',
    dateTo: '2026-06-13',
    showOnlyHighlyRelevant: true,
  });
  const qs = filtersToUrlSearchParams(result.filters);
  assert.equal(qs.get('skillIds'), '111');
  assert.equal(qs.get('sourceIds'), '1,2,4');
  assert.equal(qs.get('showOnlyHighlyRelevant'), 'true');
});
