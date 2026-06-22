import { Op } from 'sequelize';
import { models } from '../db.js';

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

export function mapIndustryRow(row) {
  return {
    id: row.Id,
    name: row.Name,
    slug: row.Slug,
    sortOrder: Number(row.SortOrder) || 0,
  };
}

export function mapCompanyRow(row) {
  const industries = (row.Industries || [])
    .map(mapIndustryRow)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name, 'ru');
    });
  return {
    Id: row.Id,
    Name: row.Name,
    Url: row.Url,
    Notes: row.Notes,
    DateAdded: row.DateAdded,
    industries,
    industryNames: industries.map((item) => item.name),
    primaryIndustry: industries[0] || null,
  };
}

export async function listIndustries() {
  const rows = await models.Industries.findAll({
    order: [
      ['SortOrder', 'ASC'],
      ['Name', 'ASC'],
    ],
  });
  return rows.map(mapIndustryRow);
}

export async function listRemoteCompanies({ industryId = null, industrySlug = null } = {}) {
  const include = {
    model: models.Industries,
    as: 'Industries',
    through: { attributes: [] },
    required: Boolean(industryId || industrySlug),
  };
  if (industryId) {
    include.where = { Id: Number(industryId) };
  } else if (industrySlug) {
    include.where = { Slug: String(industrySlug).trim() };
  }

  const rows = await models.RemoteCompanies.findAll({
    include: [include],
    order: [['Name', 'ASC']],
    limit: 2000,
  });

  const mapped = rows.map(mapCompanyRow);
  mapped.sort((a, b) => {
    const industryA = a.primaryIndustry?.name || 'яяя';
    const industryB = b.primaryIndustry?.name || 'яяя';
    const byIndustry = industryA.localeCompare(industryB, 'ru');
    if (byIndustry !== 0) return byIndustry;
    return String(a.Name || '').localeCompare(String(b.Name || ''), 'ru');
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
    defaults: { Name: trimmed, Slug: slug, SortOrder: sortOrder },
  });
  if (row.Name !== trimmed && row.Name.toLowerCase() !== trimmed.toLowerCase()) {
    // Keep first canonical spelling; slug collision handled by findOrCreate on slug.
  }
  return row;
}
