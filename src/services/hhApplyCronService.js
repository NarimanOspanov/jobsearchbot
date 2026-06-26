import { Sequelize } from 'sequelize';
import { models, sequelize } from '../db.js';
import { clientHasResumeForAgentAccess, findAssignmentForClient } from './agentAccessService.js';
import { isAppliedApplicationStatus } from './applicationAgentAttribution.js';
import { getSeekerResumeTextForTailoring } from './tailoredCvService.js';
import { resumeStorage } from './resumeStorage.js';
import { isSupportedResumeMimeType, normalizeSkillIds } from './userService.js';

const RESUME_TEXT_CONCURRENCY = 4;
const HH_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;
const HH_TAILORED_CV_MAX_BYTES = 15 * 1024 * 1024;

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
    source: 'hh',
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

export function validateHhArtifactFile(artifact) {
  if (!artifact?.buffer?.length) return { ok: true, artifact: null };
  const mimeType = String(artifact.mimeType || '').trim().toLowerCase();
  const isSupported =
    mimeType.includes('png') ||
    mimeType.includes('jpeg') ||
    mimeType.includes('jpg') ||
    mimeType.includes('webp');
  if (!isSupported) {
    return { ok: false, status: 400, error: 'Unsupported artifact type. Use PNG, JPEG, or WEBP.' };
  }
  if (artifact.buffer.length > HH_ARTIFACT_MAX_BYTES) {
    return { ok: false, status: 400, error: 'Artifact file exceeds the 10 MB limit.' };
  }
  return {
    ok: true,
    artifact: {
      buffer: artifact.buffer,
      mimeType: mimeType || 'image/png',
      fileName: String(artifact.fileName || '').trim() || null,
    },
  };
}

async function persistHhApplicationArtifact({ userId, applicationId, hhVacancyId, artifact }) {
  if (!artifact?.buffer?.length) return null;
  const screenlyJobId = Number.parseInt(String(hhVacancyId), 10) || 0;
  return resumeStorage.uploadApplicationScreenshotBuffer({
    userId,
    screenlyJobId,
    applicationId,
    fileName: artifact.fileName || `hh-artifact-${applicationId}.png`,
    mimeType: artifact.mimeType || 'image/png',
    buffer: artifact.buffer,
  });
}

export function validateHhTailoredCvFile(tailoredCv) {
  if (!tailoredCv?.buffer?.length) return { ok: true, tailoredCv: null };
  const mimeType = String(tailoredCv.mimeType || '').trim().toLowerCase();
  if (!isSupportedResumeMimeType(mimeType)) {
    return { ok: false, status: 400, error: 'Unsupported tailored CV type. Use PDF or image (JPG/PNG/WEBP).' };
  }
  if (tailoredCv.buffer.length > HH_TAILORED_CV_MAX_BYTES) {
    return { ok: false, status: 400, error: 'Tailored CV file exceeds the 15 MB limit.' };
  }
  return {
    ok: true,
    tailoredCv: {
      buffer: tailoredCv.buffer,
      mimeType: mimeType || 'application/pdf',
      fileName: String(tailoredCv.fileName || '').trim() || null,
    },
  };
}

async function persistHhApplicationTailoredCv({ userId, applicationId, hhVacancyId, tailoredCv }) {
  if (!tailoredCv?.buffer?.length) return null;
  const screenlyJobId = Number.parseInt(String(hhVacancyId), 10) || applicationId;
  return resumeStorage.uploadTailoredResumeBuffer({
    seekerId: userId,
    screenlyJobId,
    fileName: tailoredCv.fileName || `tailored-hh-${applicationId}.pdf`,
    mimeType: tailoredCv.mimeType || 'application/pdf',
    buffer: tailoredCv.buffer,
  });
}

export function parseApplyPriorityJsonFromBody(value) {
  if (value == null || value === '') return { ok: true, applyPriorityJson: null };
  if (typeof value === 'object') {
    return { ok: true, applyPriorityJson: JSON.stringify(value) };
  }
  const raw = String(value).trim();
  if (!raw) return { ok: true, applyPriorityJson: null };
  try {
    JSON.parse(raw);
    return { ok: true, applyPriorityJson: raw };
  } catch {
    return { ok: false, status: 400, error: 'Invalid applyPriorityJson' };
  }
}

async function applyHhApplicationFileUploads({
  row,
  userId,
  hhVacancyId,
  artifact,
  tailoredCv,
}) {
  const updates = {};
  let screenshotArtifactUrl = row.ScreenshotArtifactURL || null;
  let tailoredCvUrl = row.TailoredCVURL || null;

  if (artifact?.buffer?.length) {
    screenshotArtifactUrl = await persistHhApplicationArtifact({
      userId,
      applicationId: row.Id,
      hhVacancyId,
      artifact,
    });
    updates.ScreenshotArtifactURL = screenshotArtifactUrl;
  }
  if (tailoredCv?.buffer?.length) {
    tailoredCvUrl = await persistHhApplicationTailoredCv({
      userId,
      applicationId: row.Id,
      hhVacancyId,
      tailoredCv,
    });
    updates.TailoredCVURL = tailoredCvUrl;
  }
  if (Object.keys(updates).length) {
    await row.update(updates);
    await row.reload();
  }
  return { screenshotArtifactUrl, tailoredCvUrl };
}

export function validateHhApplicationCheckQuery({ userId, hhVacancyId, hhId } = {}) {
  const parsedUserId = Number.parseInt(String(userId ?? ''), 10);
  const normalizedVacancyId = normalizeHhVacancyId(hhVacancyId ?? hhId);
  if (!Number.isSafeInteger(parsedUserId) || parsedUserId <= 0) {
    return { ok: false, status: 400, error: 'userId is required and must be a positive integer' };
  }
  if (!normalizedVacancyId) {
    return { ok: false, status: 400, error: 'hhVacancyId is required' };
  }
  return { ok: true, userId: parsedUserId, hhVacancyId: normalizedVacancyId };
}

export function isRejectedApplicationStatus(status) {
  return String(status || '').trim().toLowerCase() === 'rejected';
}

export function buildHhApplicationCheckPayload(existing) {
  const emptyAppliedFields = {
    applicationId: null,
    appliedAt: null,
    vacancyTitle: null,
    companyName: null,
  };

  if (!existing) {
    return { status: null, ...emptyAppliedFields };
  }

  const status = existing.Status || null;
  if (!isAppliedApplicationStatus(status)) {
    return { status, ...emptyAppliedFields };
  }

  return {
    status,
    applicationId: existing.Id,
    appliedAt: existing.AppliedAt || null,
    vacancyTitle: existing.VacancyTitle || null,
    companyName: existing.CompanyName || null,
  };
}

export async function checkHhApplicationApplied({ userId, hhVacancyId, hhId } = {}) {
  const validated = validateHhApplicationCheckQuery({ userId, hhVacancyId, hhId });
  if (!validated.ok) return validated;

  const existing = await findHhApplicationByVacancyId(validated.userId, validated.hhVacancyId);
  return { ok: true, ...buildHhApplicationCheckPayload(existing) };
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
    updates.Source = 'hh';
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
  if (!String(existing.ApplyPriorityJson || '').trim() && payload.applyPriorityJson) {
    updates.ApplyPriorityJson = payload.applyPriorityJson;
  }
  if (!String(existing.CoverLetter || '').trim() && payload.coverLetter) {
    updates.CoverLetter = payload.coverLetter;
  }
  if (!String(existing.CoverLetterUrl || '').trim() && payload.coverLetterUrl) {
    updates.CoverLetterUrl = payload.coverLetterUrl;
  }
  if (payload.status) {
    const existingStatus = String(existing.Status || '').trim().toLowerCase();
    if (!existingStatus || existingStatus === 'rejected') {
      updates.Status = payload.status;
    }
  }
  if (!existing.AppliedAt && payload.appliedAt) {
    updates.AppliedAt = payload.appliedAt;
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
        searchMode: String(user.SearchMode || 'not_urgent').trim() === 'urgent' ? 'urgent' : 'not_urgent',
        skillIds: normalizeSkillIds(user.skills),
        workAuthorizationCountries: String(user.WorkAuthorizationCountries || '').trim(),
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

export async function importHhApplication(body, { artifact, tailoredCv } = {}) {
  const validated = validateHhImportApplicationBody(body);
  if (!validated.ok) return validated;

  const artifactValidated = validateHhArtifactFile(artifact);
  if (!artifactValidated.ok) return artifactValidated;

  const tailoredCvValidated = validateHhTailoredCvFile(tailoredCv);
  if (!tailoredCvValidated.ok) return tailoredCvValidated;

  const applyPriorityParsed = parseApplyPriorityJsonFromBody(body?.applyPriorityJson);
  if (!applyPriorityParsed.ok) return applyPriorityParsed;

  const eligible = await assertEligibleHhApplyClient(validated.userId);
  if (!eligible.ok) return eligible;

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
    applyPriorityJson: applyPriorityParsed.applyPriorityJson,
    appliedAt: parseAppliedAtFromBody(body?.appliedAt),
  };

  const existing = await findHhApplicationByVacancyId(validated.userId, validated.hhVacancyId);
  if (existing) {
    const updates = buildHhApplicationBackfillUpdates(existing, payload);
    if (Object.keys(updates).length) {
      await existing.update(updates);
      await existing.reload();
    }
    const uploads = await applyHhApplicationFileUploads({
      row: existing,
      userId: validated.userId,
      hhVacancyId: validated.hhVacancyId,
      artifact: artifactValidated.artifact,
      tailoredCv: tailoredCvValidated.tailoredCv,
    });
    return {
      success: true,
      applicationId: existing.Id,
      created: false,
      screenshotArtifactUrl: uploads.screenshotArtifactUrl,
      tailoredCvUrl: uploads.tailoredCvUrl,
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
    VacancyTitle: payload.vacancyTitle,
    CompanyName: payload.companyName,
    Source: 'hh',
    ApplyType: 'hh',
    Status: payload.status,
    AppliedAt: payload.appliedAt,
    Notes: payload.notes,
    MetaJson: JSON.stringify(metaJson),
    TailoredCVURL: payload.tailoredCvUrl,
    CoverLetter: payload.coverLetter,
    CoverLetterUrl: payload.coverLetterUrl,
    ApplyPriorityJson: payload.applyPriorityJson,
    ScreenlyJobId: null,
  });

  const uploads = await applyHhApplicationFileUploads({
    row,
    userId: validated.userId,
    hhVacancyId: validated.hhVacancyId,
    artifact: artifactValidated.artifact,
    tailoredCv: tailoredCvValidated.tailoredCv,
  });

  return {
    success: true,
    applicationId: row.Id,
    created: true,
    screenshotArtifactUrl: uploads.screenshotArtifactUrl,
    tailoredCvUrl: uploads.tailoredCvUrl,
    application: row,
  };
}
