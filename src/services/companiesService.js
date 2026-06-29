import { Op } from 'sequelize';
import { models } from '../db.js';
import { normalizeUserLanguage } from '../utils/userLanguage.js';

export function slugifyIndustryName(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base.slice(0, 200) || 'other';
}

export function industryDisplayName(row, lang = 'ru') {
  const locale = normalizeUserLanguage(lang);
  const name = String(row?.Name ?? row?.name ?? '').trim();
  const nameEng = String(row?.NameEng ?? row?.nameEng ?? '').trim();
  if (locale === 'en' && nameEng) return nameEng;
  return name;
}

export function mapIndustryRow(row, lang = 'ru') {
  const nameEng = row.NameEng ? String(row.NameEng).trim() : null;
  return {
    id: row.Id,
    name: industryDisplayName(row, lang),
    nameEng,
    slug: row.Slug,
    sortOrder: Number(row.SortOrder) || 0,
  };
}

export function mapCompanyRow(row, lang = 'ru') {
  const industries = (row.Industries || [])
    .map((item) => mapIndustryRow(item, lang))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name, normalizeUserLanguage(lang));
    });
  const shortDescriptionRu = row.ShortDescriptionRU ? String(row.ShortDescriptionRU).trim() : null;
  const shortDescriptionEng = row.ShortDescriptionEng ? String(row.ShortDescriptionEng).trim() : null;
  const shortDescription =
    normalizeUserLanguage(lang) === 'en'
      ? shortDescriptionEng || shortDescriptionRu
      : shortDescriptionRu || shortDescriptionEng;
  return {
    Id: row.Id,
    Name: row.Name,
    Url: row.Url,
    Notes: row.Notes,
    DateAdded: row.DateAdded,
    shortDescription: shortDescription || null,
    shortDescriptionRu,
    shortDescriptionEng,
    helpsWithRelocation: row.HelpsWithRelocation == null ? null : !!row.HelpsWithRelocation,
    industries,
    industryNames: industries.map((item) => item.name),
    primaryIndustry: industries[0] || null,
  };
}

export async function listIndustries({ lang = 'ru' } = {}) {
  const rows = await models.Industries.findAll({
    order: [
      ['SortOrder', 'ASC'],
      ['Name', 'ASC'],
    ],
  });
  return rows.map((row) => mapIndustryRow(row, lang));
}

export async function listRemoteCompanies({ industryIds = [], industryId = null, industrySlug = null, lang = 'ru' } = {}) {
  const normalizedIds = [
    ...new Set(
      [
        ...(Array.isArray(industryIds) ? industryIds : []),
        ...(Number.isSafeInteger(Number(industryId)) && Number(industryId) > 0 ? [Number(industryId)] : []),
      ]
        .map((id) => Number.parseInt(String(id), 10))
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    ),
  ];
  const slug = String(industrySlug || '').trim();
  const hasIndustryFilter = normalizedIds.length > 0 || Boolean(slug);
  const locale = normalizeUserLanguage(lang);

  const include = {
    model: models.Industries,
    as: 'Industries',
    through: { attributes: [] },
    required: hasIndustryFilter,
  };
  if (normalizedIds.length) {
    include.where = { Id: { [Op.in]: normalizedIds } };
  } else if (slug) {
    include.where = { Slug: slug };
  }

  const rows = await models.RemoteCompanies.findAll({
    include: [include],
    order: [['Name', 'ASC']],
    limit: 2000,
    distinct: true,
    col: 'Id',
  });

  const mapped = rows.map((row) => mapCompanyRow(row, locale));
  mapped.sort((a, b) => {
    const industryA = a.primaryIndustry?.name || 'яяя';
    const industryB = b.primaryIndustry?.name || 'яяя';
    const byIndustry = industryA.localeCompare(industryB, locale);
    if (byIndustry !== 0) return byIndustry;
    return String(a.Name || '').localeCompare(String(b.Name || ''), locale);
  });
  return mapped;
}

export async function setCompanyIndustries(companyId, industryIds) {
  const ids = [...new Set(
    (Array.isArray(industryIds) ? industryIds : [])
      .map((id) => Number.parseInt(String(id), 10))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  )];
  const company = await models.RemoteCompanies.findByPk(companyId);
  if (!company) return null;
  if (!ids.length) {
    await company.setIndustries([]);
    await company.reload({ include: [{ model: models.Industries, as: 'Industries', through: { attributes: [] } }] });
    return mapCompanyRow(company);
  }
  const industries = await models.Industries.findAll({ where: { Id: { [Op.in]: ids } } });
  await company.setIndustries(industries.map((row) => row.Id));
  await company.reload({ include: [{ model: models.Industries, as: 'Industries', through: { attributes: [] } }] });
  return mapCompanyRow(company);
}

export async function findOrCreateIndustryByName(name, sortOrder = 0) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const slug = slugifyIndustryName(trimmed);
  const [row] = await models.Industries.findOrCreate({
    where: { Slug: slug },
    defaults: { Name: trimmed, Slug: slug, SortOrder: sortOrder, NameEng: null },
  });
  if (row.Name !== trimmed && row.Name.toLowerCase() !== trimmed.toLowerCase()) {
    // Keep first canonical spelling; slug collision handled by findOrCreate on slug.
  }
  return row;
}

// --- Per-user remote-company opt-ins (notify / auto-apply) ---

const PREF_MODEL_BY_TYPE = {
  notify: () => models.UserRemoteCompanyNotifies,
  autoApply: () => models.UserRemoteCompanyAutoApplies,
};

export function isValidCompanyPrefType(type) {
  return type === 'notify' || type === 'autoApply';
}

/** Returns the company ids a user has enabled for each opt-in type. */
export async function getUserCompanyPrefs(userId) {
  const id = Number.parseInt(String(userId), 10);
  if (!Number.isSafeInteger(id) || id <= 0) return { notify: [], autoApply: [] };
  const [notifyRows, autoApplyRows] = await Promise.all([
    models.UserRemoteCompanyNotifies.findAll({ where: { UserId: id }, attributes: ['RemoteCompanyId'], raw: true }),
    models.UserRemoteCompanyAutoApplies.findAll({ where: { UserId: id }, attributes: ['RemoteCompanyId'], raw: true }),
  ]);
  return {
    notify: notifyRows.map((r) => r.RemoteCompanyId),
    autoApply: autoApplyRows.map((r) => r.RemoteCompanyId),
  };
}

/**
 * Enable/disable one opt-in for (user, company). Idempotent.
 * Returns { ok: true, enabled } or null on invalid input / unknown company.
 */
export async function setUserCompanyPref({ userId, companyId, type, enabled }) {
  const uid = Number.parseInt(String(userId), 10);
  const cid = Number.parseInt(String(companyId), 10);
  if (!Number.isSafeInteger(uid) || uid <= 0) return null;
  if (!Number.isSafeInteger(cid) || cid <= 0) return null;
  if (!isValidCompanyPrefType(type)) return null;

  const company = await models.RemoteCompanies.findByPk(cid, { attributes: ['Id'] });
  if (!company) return null;

  const Model = PREF_MODEL_BY_TYPE[type]();
  if (enabled) {
    await Model.findOrCreate({ where: { UserId: uid, RemoteCompanyId: cid } });
  } else {
    await Model.destroy({ where: { UserId: uid, RemoteCompanyId: cid } });
  }
  return { ok: true, enabled: Boolean(enabled) };
}
