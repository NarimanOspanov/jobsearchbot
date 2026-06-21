import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHhApplicationBackfillUpdates,
  buildHhImportMetaJson,
  metaHhVacancyId,
  normalizeHhVacancyId,
  validateHhImportApplicationBody,
} from '../src/services/hhApplyCronService.js';

test('normalizeHhVacancyId trims and rejects empty values', () => {
  assert.equal(normalizeHhVacancyId(' 12345 '), '12345');
  assert.equal(normalizeHhVacancyId(''), null);
  assert.equal(normalizeHhVacancyId(null), null);
});

test('buildHhImportMetaJson sets headhunter fields', () => {
  const meta = buildHhImportMetaJson({
    hhVacancyId: '998877',
    applyUrl: 'https://hh.ru/vacancy/998877',
    hhSearchUrl: 'https://hh.ru/search/vacancy?text=node',
  });
  assert.equal(meta.hhVacancyId, '998877');
  assert.equal(meta.source, 'headhunter');
  assert.equal(meta.applyUrl, 'https://hh.ru/vacancy/998877');
  assert.equal(meta.hhSearchUrl, 'https://hh.ru/search/vacancy?text=node');
});

test('metaHhVacancyId reads hhVacancyId from MetaJson string', () => {
  assert.equal(metaHhVacancyId(JSON.stringify({ hhVacancyId: '42' })), '42');
  assert.equal(metaHhVacancyId(null), null);
});

test('validateHhImportApplicationBody requires userId, hhVacancyId, vacancyTitle', () => {
  assert.equal(validateHhImportApplicationBody({}).ok, false);
  assert.equal(
    validateHhImportApplicationBody({ userId: 3, hhVacancyId: '1', vacancyTitle: 'Engineer' }).ok,
    true
  );
});

test('buildHhApplicationBackfillUpdates fills empty fields without overwriting populated ones', () => {
  const updates = buildHhApplicationBackfillUpdates(
    {
      VacancyTitle: 'Existing title',
      CompanyName: 'Existing Co',
      Source: 'headhunter',
      ApplyType: 'hh',
      MetaJson: JSON.stringify({ hhVacancyId: '55' }),
    },
    {
      hhVacancyId: '55',
      vacancyTitle: 'New title',
      companyName: 'New Co',
      applyUrl: 'https://hh.ru/vacancy/55',
      status: 'applied',
      agentUserId: 10,
    }
  );
  assert.equal(updates.VacancyTitle, undefined);
  assert.equal(updates.CompanyName, undefined);
  assert.equal(updates.Source, undefined);
  assert.equal(updates.ApplyType, undefined);
  assert.equal(updates.MetaJson, JSON.stringify({ hhVacancyId: '55', source: 'headhunter', applyUrl: 'https://hh.ru/vacancy/55' }));
});
