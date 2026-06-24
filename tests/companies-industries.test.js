import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyIndustryName,
  industryDisplayName,
  mapIndustryRow,
} from '../src/services/companiesService.js';
import {
  normalizeIndustryTranslationRow,
  normalizeCompanyIndustryAssignmentRow,
  normalizeCompanyIndustryAssignments,
} from '../src/services/aiService.js';

test('slugifyIndustryName normalizes industry labels', () => {
  assert.equal(slugifyIndustryName('  FinTech '), 'fintech');
  assert.equal(slugifyIndustryName('Игры / GameDev'), 'игры-gamedev');
});

test('industryDisplayName uses NameEng for English locale', () => {
  const row = { Name: 'Финтех', NameEng: 'FinTech' };
  assert.equal(industryDisplayName(row, 'en'), 'FinTech');
  assert.equal(industryDisplayName(row, 'ru'), 'Финтех');
});

test('industryDisplayName falls back to Name when NameEng missing', () => {
  const row = { Name: 'Финтех', NameEng: null };
  assert.equal(industryDisplayName(row, 'en'), 'Финтех');
});

test('mapIndustryRow returns localized display name', () => {
  const mapped = mapIndustryRow({ Id: 1, Name: 'Игры', NameEng: 'Games', Slug: 'games', SortOrder: 10 }, 'en');
  assert.equal(mapped.name, 'Games');
  assert.equal(mapped.nameEng, 'Games');
  assert.equal(mapped.id, 1);
});

test('normalizeIndustryTranslationRow validates id and nameEng', () => {
  assert.deepEqual(normalizeIndustryTranslationRow({ id: 3, nameEng: 'FinTech' }), { id: 3, nameEng: 'FinTech' });
  assert.equal(normalizeIndustryTranslationRow({ id: 0, nameEng: 'X' }), null);
  assert.equal(normalizeIndustryTranslationRow({ id: 1, nameEng: '' }), null);
});

test('normalizeCompanyIndustryAssignments filters invalid ids', () => {
  const allowedCompanyIds = new Set([10, 11]);
  const allowedIndustryIds = new Set([1, 2, 3]);
  const parsed = [
    { companyId: 10, industryIds: [1, 99, 2, 2] },
    { companyId: 11, industryIds: [3, 4] },
    { companyId: 12, industryIds: [1] },
    { companyId: 'bad', industryIds: [1] },
  ];
  const result = normalizeCompanyIndustryAssignments(parsed, { allowedCompanyIds, allowedIndustryIds });
  assert.deepEqual(result, [
    { companyId: 10, industryIds: [1, 2] },
    { companyId: 11, industryIds: [3] },
  ]);
});

test('normalizeCompanyIndustryAssignmentRow caps industries at three', () => {
  const allowedCompanyIds = new Set([5]);
  const allowedIndustryIds = new Set([1, 2, 3, 4]);
  const row = normalizeCompanyIndustryAssignmentRow(
    { companyId: 5, industryIds: [1, 2, 3, 4] },
    { allowedCompanyIds, allowedIndustryIds }
  );
  assert.equal(row.industryIds.length, 3);
});
