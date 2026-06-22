import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHhApplicationBackfillUpdates,
  buildHhImportMetaJson,
  metaHhVacancyId,
  normalizeHhVacancyId,
  validateHhApplicationCheckQuery,
  validateHhImportApplicationBody,
} from '../src/services/hhApplyCronService.js';

test('normalizeHhVacancyId trims and rejects empty values', () => {
  assert.equal(normalizeHhVacancyId(' 12345 '), '12345');
  assert.equal(normalizeHhVacancyId(''), null);
  assert.equal(normalizeHhVacancyId(null), null);
});

test('buildHhImportMetaJson sets hh fields', () => {
  const meta = buildHhImportMetaJson({
    hhVacancyId: '998877',
    applyUrl: 'https://hh.ru/vacancy/998877',
    hhSearchUrl: 'https://hh.ru/search/vacancy?text=node',
  });
  assert.equal(meta.hhVacancyId, '998877');
  assert.equal(meta.source, 'hh');
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

test('validateHhApplicationCheckQuery requires userId and hhVacancyId', () => {
  assert.equal(validateHhApplicationCheckQuery({}).ok, false);
  assert.equal(validateHhApplicationCheckQuery({ userId: 3 }).ok, false);
  assert.equal(validateHhApplicationCheckQuery({ hhVacancyId: '1' }).ok, false);
  assert.equal(validateHhApplicationCheckQuery({ userId: 0, hhVacancyId: '1' }).ok, false);
  assert.deepEqual(validateHhApplicationCheckQuery({ userId: 3, hhVacancyId: ' 12345 ' }), {
    ok: true,
    userId: 3,
    hhVacancyId: '12345',
  });
  assert.deepEqual(validateHhApplicationCheckQuery({ userId: 3, hhId: '99' }), {
    ok: true,
    userId: 3,
    hhVacancyId: '99',
  });
});

test('buildHhApplicationBackfillUpdates fills empty fields without overwriting populated ones', () => {
  const updates = buildHhApplicationBackfillUpdates(
    {
      VacancyTitle: 'Existing title',
      CompanyName: 'Existing Co',
      Source: 'hh',
      ApplyType: 'hh',
      MetaJson: JSON.stringify({ hhVacancyId: '55' }),
    },
    {
      hhVacancyId: '55',
      vacancyTitle: 'New title',
      companyName: 'New Co',
      applyUrl: 'https://hh.ru/vacancy/55',
      status: 'applied',
    }
  );
  assert.equal(updates.AgentUserId, undefined);
  assert.equal(updates.VacancyTitle, undefined);
  assert.equal(updates.CompanyName, undefined);
  assert.equal(updates.Source, undefined);
  assert.equal(updates.ApplyType, undefined);
  assert.equal(updates.MetaJson, JSON.stringify({ hhVacancyId: '55', source: 'hh', applyUrl: 'https://hh.ru/vacancy/55' }));
});
