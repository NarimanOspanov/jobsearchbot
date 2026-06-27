import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHhApplicationBackfillUpdates,
  buildHhApplicationCheckPayload,
  buildHhImportMetaJson,
  isRejectedApplicationStatus,
  metaHhVacancyId,
  normalizeHhVacancyId,
  parseApplyPriorityJsonFromBody,
  parseApplyPriorityJsonField,
  parseHhSearchUrlsInput,
  validateHhApplicationCheckQuery,
  validateHhArtifactFile,
  validateHhImportApplicationBody,
  validateHhTailoredCvFile,
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

test('validateHhArtifactFile accepts supported image types and rejects others', () => {
  assert.equal(validateHhArtifactFile(null).ok, true);
  assert.equal(validateHhArtifactFile({ buffer: Buffer.alloc(0) }).ok, true);

  const png = validateHhArtifactFile({
    buffer: Buffer.from('abc'),
    mimeType: 'image/png',
    fileName: 'shot.png',
  });
  assert.equal(png.ok, true);
  assert.equal(png.artifact.mimeType, 'image/png');

  assert.equal(
    validateHhArtifactFile({ buffer: Buffer.from('abc'), mimeType: 'application/pdf' }).ok,
    false
  );
});

test('validateHhTailoredCvFile accepts PDF and image types', () => {
  assert.equal(validateHhTailoredCvFile(null).ok, true);
  assert.equal(
    validateHhTailoredCvFile({ buffer: Buffer.from('abc'), mimeType: 'application/pdf' }).ok,
    true
  );
  assert.equal(
    validateHhTailoredCvFile({ buffer: Buffer.from('abc'), mimeType: 'text/plain' }).ok,
    false
  );
});

test('parseApplyPriorityJsonFromBody accepts object or JSON string', () => {
  assert.deepEqual(parseApplyPriorityJsonFromBody(null), { ok: true, applyPriorityJson: null });
  assert.deepEqual(parseApplyPriorityJsonFromBody({ rank: 1 }), {
    ok: true,
    applyPriorityJson: '{"rank":1}',
  });
  assert.deepEqual(parseApplyPriorityJsonFromBody('{"rank":1}'), {
    ok: true,
    applyPriorityJson: '{"rank":1}',
  });
  assert.equal(parseApplyPriorityJsonFromBody('not-json').ok, false);
});

test('parseHhSearchUrlsInput validates and deduplicates HH search URLs', () => {
  assert.deepEqual(parseHhSearchUrlsInput(null), { ok: true, hhSearchUrls: [] });
  assert.equal(parseHhSearchUrlsInput('bad').ok, false);
  assert.deepEqual(
    parseHhSearchUrlsInput([
      'https://hh.ru/search/vacancy?text=node',
      'https://hh.ru/search/vacancy?text=node',
      'https://example.com/jobs',
    ]),
    {
      ok: true,
      hhSearchUrls: ['https://hh.ru/search/vacancy?text=node', 'https://example.com/jobs'],
    }
  );
  assert.equal(parseHhSearchUrlsInput(['not-a-url']).ok, false);
});

test('isRejectedApplicationStatus matches rejected case-insensitively', () => {
  assert.equal(isRejectedApplicationStatus('rejected'), true);
  assert.equal(isRejectedApplicationStatus('Rejected'), true);
  assert.equal(isRejectedApplicationStatus('applied'), false);
  assert.equal(isRejectedApplicationStatus(''), false);
});

test('buildHhApplicationCheckPayload returns status and clears applied fields when not applied', () => {
  const emptyAppliedFields = {
    applicationId: null,
    appliedAt: null,
    vacancyTitle: null,
    companyName: null,
    applyPriorityJson: null,
  };

  assert.deepEqual(buildHhApplicationCheckPayload(null), {
    status: null,
    ...emptyAppliedFields,
  });
  assert.deepEqual(
    buildHhApplicationCheckPayload({
      Id: 42,
      Status: 'rejected',
      AppliedAt: new Date('2026-06-01T00:00:00.000Z'),
      VacancyTitle: 'Engineer',
      CompanyName: 'Acme',
    }),
    {
      status: 'rejected',
      ...emptyAppliedFields,
    }
  );
  assert.deepEqual(
    buildHhApplicationCheckPayload({
      Id: 7,
      Status: 'applied',
      AppliedAt: null,
      VacancyTitle: 'PM',
      CompanyName: null,
      ApplyPriorityJson: '{"rank":1,"score":9.2}',
    }),
    {
      status: 'applied',
      applicationId: 7,
      appliedAt: null,
      vacancyTitle: 'PM',
      companyName: null,
      applyPriorityJson: { rank: 1, score: 9.2 },
    }
  );
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

test('buildHhApplicationBackfillUpdates overwrites rejected status on re-import', () => {
  const updates = buildHhApplicationBackfillUpdates(
    {
      Status: 'rejected',
      MetaJson: JSON.stringify({ hhVacancyId: '55' }),
    },
    {
      hhVacancyId: '55',
      vacancyTitle: 'Engineer',
      status: 'applied',
    }
  );
  assert.equal(updates.Status, 'applied');
});
