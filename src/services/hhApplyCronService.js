import { Sequelize } from 'sequelize';
import { models, sequelize } from '../db.js';
import { clientHasResumeForAgentAccess, findAssignmentForClient } from './agentAccessService.js';
import { getSeekerResumeTextForTailoring } from './tailoredCvService.js';

const RESUME_TEXT_CONCURRENCY = 4;

export function normalizeHhVacancyId(raw) {
  const value = String(raw ?? '').trim();
  return value || null;
}

export function parseApplicationMetaJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function metaHhVacancyId(meta) {
  return normalizeHhVacancyId(parseApplicationMetaJson(meta)?.hhVacancyId);
}

export function buildHhImportMetaJson({ hhVacancyId, applyUrl = null, hhSearchUrl = null, existingMeta = null }) {
  const base = parseApplicationMetaJson(existingMeta) || {};
  const next = {
    ...base,
    hhVacancyId: normalizeHhVacancyId(hhVacancyId),
    source: 'headhunter',
  };
  const url = String(applyUrl || '').trim();
  if (url) next.applyUrl = url;
  const searchUrl = String(hhSearchUrl || '').trim();
  if (searchUrl) next.hhSearchUrl = searchUrl;
  return next;
}

export function validateHhImportApplicationBody(body) {
  const userId = Number.parseInt(String(body?.userId ?? ''), 10);
  const hhVacancyId = normalizeHhVacancyId(body?.hhVacancyId);
  const vacancyTitle = String(body?.vacancyTitle || '').trim();
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { ok: false, status: 400, error: 'userId is required and must be a positive integer' };
  }
  if (!hhVacancyId) {
    return { ok: false, status: 400, error: 'hhVacancyId is required' };
  }
  if (!vacancyTitle) {
    return { ok: false, status: 400, error: 'vacancyTitle is required' };
  }
  return { ok: true, userId, hhVacancyId, vacancyTitle };
}

function parseAppliedAtFromBody(value) {
  if (value == null || value === '') return new Date();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function stringOrNull(value, maxLen) {
  if (value == null || value === '') return null;
  return String(value).trim().slice(0, maxLen) || null;
}

export function buildHhApplicationBackfillUpdates(existing, payload) {
  const updates = {};
  if (!String(existing.VacancyTitle || '').trim() && payload.vacancyTitle) {
    updates.VacancyTitle = payload.vacancyTitle.slice(0, 255);
  }
  if (!String(existing.CompanyName || '').trim() && payload.companyName) {
    updates.CompanyName = payload.companyName;
  }
  if (!String(existing.Source || '').trim()) {
    updates.Source = 'headhunter';
  }
  if (!String(existing.ApplyType || '').trim()) {
    updates.ApplyType = 'hh';
  }
  if (!String(existing.Notes || '').trim() && payload.notes) {
    updates.Notes = payload.notes;
  }
  if (!String(existing.TailoredCVURL || '').trim() && payload.tailoredCvUrl) {
    updates.TailoredCVURL = payload.tailoredCvUrl;
  }
  if (!String(existing.CoverLetter || '').trim() && payload.coverLetter) {
    updates.CoverLetter = payload.coverLetter;
  }
  if (!String(existing.CoverLetterUrl || '').trim() && payload.coverLetterUrl) {
    updates.CoverLetterUrl = payload.coverLetterUrl;
  }
  if (payload.status && !String(existing.Status || '').trim()) {
    updates.Status = payload.status;
  }
  if (!existing.AppliedAt && payload.appliedAt) {
    updates.AppliedAt = payload.appliedAt;
  }
  if (!Number(existing.AgentUserId) && payload.agentUserId) {
    updates.AgentUserId = payload.agentUserId;
  }

  const existingMeta = parseApplicationMetaJson(existing.MetaJson);
  const mergedMeta = buildHhImportMetaJson({
    hhVacancyId: payload.hhVacancyId,
    applyUrl: payload.applyUrl,
    hhSearchUrl: payload.hhSearchUrl,
    existingMeta,
  });
  const existingVacancyId = metaHhVacancyId(existingMeta);
  const mergedJson = JSON.stringify(mergedMeta);
  if (!existingVacancyId || mergedJson !== JSON.stringify(existingMeta || {})) {
    updates.MetaJson = mergedJson;
  }

  return updates;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function findHhApplicationByVacancyId(userId, hhVacancyId) {
  const normalizedId = normalizeHhVacancyId(hhVacancyId);
  if (!normalizedId) return null;
  const rows = await models.Applications.findAll({
    where: { UserId: Number(userId) },
    order: [['AppliedAt', 'DESC'], ['Id', 'DESC']],
    limit: 500,
  });
  return rows.find((row) => metaHhVacancyId(row.MetaJson) === normalizedId) || null;
}

export async function loadEligibleHhApplyClientRows(limit = 200) {
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(String(limit), 10) || 200));
  const rows = await sequelize.query(
    `SELECT
       u.Id AS userId,
       u.FirstName AS firstName,
       u.LastName AS lastName,
       u.Comment AS preferences,
       u.ResumeURL AS resumeUrl,
       u.HhCookies AS hhCookies,
       ac.AgentUserId AS agentUserId
     FROM dbo.AgentClients AS ac
     INNER JOIN dbo.Users AS u ON u.Id = ac.ClientUserId
     WHERE u.HhEnabled = 1
       AND ISNULL(u.IsBlocked, 0) = 0
       AND u.ResumeURL IS NOT NULL
       AND LTRIM(RTRIM(u.ResumeURL)) <> ''
     ORDER BY u.Id ASC`,
    { type: Sequelize.QueryTypes.SELECT }
  );
  return rows.slice(0, safeLimit);
}

export async function assertEligibleHhApplyClient(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Invalid user id' };
  }
  const user = await models.Users.findByPk(id);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (!user.HhEnabled) return { ok: false, status: 403, error: 'HeadHunter is disabled for this user' };
  if (user.IsBlocked) return { ok: false, status: 403, error: 'User is blocked' };
  if (!clientHasResumeForAgentAccess(user)) {
    return { ok: false, status: 403, error: 'Client has no resume on file' };
  }
  const assignment = await findAssignmentForClient(id);
  if (!assignment) {
    return { ok: false, status: 403, error: 'Client is not assigned to any agent' };
  }
  return {
    ok: true,
    user,
    agentUserId: Number(assignment.AgentUserId),
  };
}

export async function listHhApplyClients({ limit = 200 } = {}) {
  const baseRows = await loadEligibleHhApplyClientRows(limit);
  if (!baseRows.length) {
    return { success: true, count: 0, skippedResumeText: 0, clients: [] };
  }

  const userIds = baseRows.map((row) => Number(row.userId)).filter((id) => id > 0);
  const searchUrlRows = models.UserHhSearchUrls
    ? await models.UserHhSearchUrls.findAll({
        where: { UserId: userIds },
        order: [['Id', 'ASC']],
      })
    : [];
  const searchUrlsByUserId = new Map();
  for (const row of searchUrlRows) {
    const uid = Number(row.UserId);
    const url = String(row.SearchURL || '').trim();
    if (!uid || !url) continue;
    const bucket = searchUrlsByUserId.get(uid) || [];
    bucket.push(url);
    searchUrlsByUserId.set(uid, bucket);
  }

  const usersById = new Map(
    (await models.Users.findAll({ where: { Id: userIds } })).map((user) => [Number(user.Id), user])
  );

  let skippedResumeText = 0;
  const clients = [];

  const mapped = await mapWithConcurrency(baseRows, RESUME_TEXT_CONCURRENCY, async (row) => {
    const userId = Number(row.userId);
    const user = usersById.get(userId);
    if (!user) return null;
    try {
      const resumeText = await getSeekerResumeTextForTailoring(user);
      if (!String(resumeText || '').trim()) {
        console.warn('listHhApplyClients: empty resume text for user', userId);
        return null;
      }
      return {
        userId,
        agentUserId: Number(row.agentUserId) || null,
        firstName: row.firstName || null,
        lastName: row.lastName || null,
        preferences: row.preferences ?? null,
        resumeUrl: row.resumeUrl || null,
        resumeText: String(resumeText),
        hhCookies: row.hhCookies ?? null,
        hhSearchUrls: searchUrlsByUserId.get(userId) || [],
      };
    } catch (err) {
      console.warn('listHhApplyClients: resume extraction failed for user', userId, err?.message || err);
      return null;
    }
  });

  for (const item of mapped) {
    if (item) clients.push(item);
    else skippedResumeText += 1;
  }

  return {
    success: true,
    count: clients.length,
    skippedResumeText,
    clients,
  };
}

export async function importHhApplication(body) {
  const validated = validateHhImportApplicationBody(body);
  if (!validated.ok) return validated;

  const eligible = await assertEligibleHhApplyClient(validated.userId);
  if (!eligible.ok) return eligible;

  const agentUserIdRaw = Number.parseInt(String(body?.agentUserId ?? ''), 10);
  const agentUserId =
    Number.isSafeInteger(agentUserIdRaw) && agentUserIdRaw > 0 ? agentUserIdRaw : eligible.agentUserId;

  const payload = {
    userId: validated.userId,
    hhVacancyId: validated.hhVacancyId,
    vacancyTitle: validated.vacancyTitle.slice(0, 255),
    companyName: stringOrNull(body?.companyName, 255),
    applyUrl: stringOrNull(body?.applyUrl, 2048),
    hhSearchUrl: stringOrNull(body?.hhSearchUrl, 2048),
    status: stringOrNull(body?.status, 50) || 'applied',
    notes: body?.notes != null ? String(body.notes) : null,
    coverLetter: body?.coverLetter != null ? String(body.coverLetter) : null,
    coverLetterUrl: stringOrNull(body?.coverLetterUrl, 2048),
    tailoredCvUrl: stringOrNull(body?.tailoredCvUrl, 2048),
    appliedAt: parseAppliedAtFromBody(body?.appliedAt),
    agentUserId,
  };

  const existing = await findHhApplicationByVacancyId(validated.userId, validated.hhVacancyId);
  if (existing) {
    const updates = buildHhApplicationBackfillUpdates(existing, payload);
    if (Object.keys(updates).length) {
      await existing.update(updates);
      await existing.reload();
    }
    return {
      success: true,
      applicationId: existing.Id,
      created: false,
      application: existing,
    };
  }

  const metaJson = buildHhImportMetaJson({
    hhVacancyId: payload.hhVacancyId,
    applyUrl: payload.applyUrl,
    hhSearchUrl: payload.hhSearchUrl,
  });

  const row = await models.Applications.create({
    UserId: validated.userId,
    AgentUserId: agentUserId,
    VacancyTitle: payload.vacancyTitle,
    CompanyName: payload.companyName,
    Source: 'headhunter',
    ApplyType: 'hh',
    Status: payload.status,
    AppliedAt: payload.appliedAt,
    Notes: payload.notes,
    MetaJson: JSON.stringify(metaJson),
    TailoredCVURL: payload.tailoredCvUrl,
    CoverLetter: payload.coverLetter,
    CoverLetterUrl: payload.coverLetterUrl,
    ScreenlyJobId: null,
  });

  return {
    success: true,
    applicationId: row.Id,
    created: true,
    application: row,
  };
}
