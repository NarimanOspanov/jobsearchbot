/**
 * Import industries + company links from a Google Sheets HTML export.
 *
 * Usage:
 *   node scripts/import-remote-companies-from-hypercareer-html.js path/to/file.html
 *
 * Expected sheet layout (flexible):
 * - Optional header row with columns like Name / URL / Industry (RU or EN headers)
 * - OR section rows: first cell = industry name, other cells empty
 * - OR rows with company name + careers URL + industry in a column
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sequelize } from '../src/db.js';
import { initModels } from '../src/models/index.js';
import { findOrCreateIndustryByName, slugifyIndustryName } from '../src/services/companiesService.js';

const models = initModels(sequelize);

function decodeHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHref(cellHtml) {
  const match = String(cellHtml || '').match(/href=["']([^"']+)["']/i);
  return match ? decodeHtml(match[1]) : '';
}

function extractTableRows(html) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const raw = cellMatch[1];
      cells.push({
        text: decodeHtml(raw),
        href: extractHref(raw),
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function normalizeHeaderToken(value) {
  return String(value || '').trim().toLowerCase();
}

function detectColumns(headerCells) {
  const headers = headerCells.map((cell) => normalizeHeaderToken(cell.text));
  const findIdx = (tokens) => headers.findIndex((h) => tokens.some((t) => h.includes(t)));
  const nameIdx = findIdx(['название компании', 'название', 'company name', 'company']);
  const urlIdx = findIdx(['ссылка', 'карьер', 'career', 'url', 'link', 'сайт']);
  const industryIdx = findIdx(['индустрия', 'industry', 'отрасл', 'сфера']);
  if (nameIdx < 0) return null;
  if (urlIdx < 0 && industryIdx < 0) return null;
  if (String(headers[nameIdx] || '').length > 48) return null;
  return { nameIdx, urlIdx, industryIdx };
}

function expandIndustryNames(raw) {
  return [...new Set(
    String(raw || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  )];
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function looksLikeSectionRow(cells) {
  const nonEmpty = cells.filter((cell) => cell.text || cell.href);
  if (nonEmpty.length !== 1) return false;
  const only = nonEmpty[0];
  return !only.href && !looksLikeUrl(only.text) && only.text.length >= 2 && only.text.length <= 120;
}

function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
}

export function parseCompaniesFromHtml(html) {
  const rows = extractTableRows(html);
  const parsed = [];
  let currentIndustry = null;
  let columns = null;
  let headerPassed = false;

  for (const cells of rows) {
    if (!cells.length) continue;
    const texts = cells.map((c) => c.text);
    const allEmpty = texts.every((t) => !t) && cells.every((c) => !c.href);
    if (allEmpty) continue;

    if (!headerPassed) {
      const maybeHeader = detectColumns(cells);
      if (maybeHeader) {
        columns = maybeHeader;
        headerPassed = true;
        continue;
      }
    }

    if (looksLikeSectionRow(cells)) {
      currentIndustry = cells.find((c) => c.text)?.text || null;
      continue;
    }

    let name = '';
    let url = '';
    let industries = [];

    if (columns) {
      name = cells[columns.nameIdx]?.text || '';
      url = cells[columns.urlIdx]?.href || cells[columns.urlIdx]?.text || '';
      const industryCell = columns.industryIdx >= 0 ? cells[columns.industryIdx]?.text : '';
      if (industryCell) industries.push(...expandIndustryNames(industryCell));
    } else {
      name = cells[0]?.text || '';
      url = cells[1]?.href || cells[1]?.text || cells[0]?.href || '';
      if (cells[2]?.text) industries.push(...expandIndustryNames(cells[2].text));
    }

    if (!name && cells[0]?.href) {
      url = cells[0].href;
      name = decodeHtml(cells[0].text) || url;
    }

    url = normalizeUrl(url);
    name = String(name || '').trim();
    if (!name) continue;
    if (!looksLikeUrl(url)) continue;

    if (!industries.length && currentIndustry) industries.push(...expandIndustryNames(currentIndustry));
    parsed.push({
      name,
      url,
      industries: [...new Set(industries.map((item) => String(item).trim()).filter(Boolean))],
    });
  }

  return parsed;
}

async function upsertCompany({ name, url, industryRows }) {
  const normalizedUrl = normalizeUrl(url);
  let company =
    (await models.RemoteCompanies.findOne({ where: { Url: normalizedUrl } })) ||
    (await models.RemoteCompanies.findOne({ where: { Name: name } }));

  if (!company) {
    company = await models.RemoteCompanies.create({
      Name: name.slice(0, 255),
      Url: normalizedUrl.slice(0, 1024),
      Notes: null,
      DateAdded: new Date(),
    });
    return { company, created: true };
  }

  const updates = {};
  if (company.Name !== name) updates.Name = name.slice(0, 255);
  if (normalizeUrl(company.Url) !== normalizedUrl) updates.Url = normalizedUrl.slice(0, 1024);
  if (Object.keys(updates).length) await company.update(updates);

  if (industryRows.length) {
    const industryIds = [...new Set(industryRows.map((row) => Number(row.Id)).filter((id) => id > 0))];
    await company.setIndustries(industryIds);
  }
  return { company, created: false };
}

function resolveImportHtmlPath(inputArg) {
  const candidates = [
    inputArg,
    'data/hypercareer-companies.html',
    'data/HyperCareer_ список русскоязычных компаний за границей - Google Диск_files/sheet.html',
    'data/HyperCareer_ список русскоязычных компаний за границей - Google Диск.html',
  ]
    .filter(Boolean)
    .map((item) => resolve(item));

  for (const candidate of candidates) {
    try {
      let html = readFileSync(candidate, 'utf8');
      let inputPath = candidate;
      if (candidate.endsWith('.html') && !html.includes('<table')) {
        const sheetPath = resolve(candidate, '..', `${candidate.split(/[/\\]/).pop().replace('.html', '')}_files`, 'sheet.html');
        try {
          html = readFileSync(sheetPath, 'utf8');
          inputPath = sheetPath;
        } catch {
          // keep wrapper html
        }
      }
      return { inputPath, html };
    } catch {
      // try next candidate
    }
  }
  throw new Error('Import HTML file not found. Place HyperCareer export under data/ and retry.');
}

async function main() {
  const inputArg = process.argv[2] || null;
  const { inputPath, html } = resolveImportHtmlPath(inputArg);
  const rows = parseCompaniesFromHtml(html);
  if (!rows.length) {
    throw new Error(`No companies parsed from ${inputPath}`);
  }

  const industrySort = new Map();
  let sortCounter = 10;
  const industryBySlug = new Map();

  for (const row of rows) {
    for (const industryName of row.industries) {
      const slug = slugifyIndustryName(industryName);
      if (!industrySort.has(slug)) industrySort.set(slug, sortCounter++);
    }
  }

  let createdCompanies = 0;
  let updatedCompanies = 0;
  let linkedIndustries = 0;

  for (const row of rows) {
    const industryRows = [];
    const seenIndustryIds = new Set();
    for (const industryName of row.industries) {
      const slug = slugifyIndustryName(industryName);
      let industry = industryBySlug.get(slug);
      if (!industry) {
        industry = await findOrCreateIndustryByName(industryName, industrySort.get(slug) || 0);
        industryBySlug.set(slug, industry);
      }
      if (!seenIndustryIds.has(industry.Id)) {
        seenIndustryIds.add(industry.Id);
        industryRows.push(industry);
      }
    }

    const { company, created } = await upsertCompany({
      name: row.name,
      url: row.url,
      industryRows,
    });
    if (created) createdCompanies += 1;
    else updatedCompanies += 1;
    linkedIndustries += industryRows.length;
    console.log(`${created ? 'CREATE' : 'UPDATE'} #${company.Id} ${company.Name} -> ${row.industries.join(', ') || '(no industry)'}`);
  }

  console.log('');
  console.log(`Parsed: ${rows.length} companies`);
  console.log(`Industries: ${industryBySlug.size}`);
  console.log(`Created companies: ${createdCompanies}`);
  console.log(`Updated companies: ${updatedCompanies}`);
  console.log(`Industry links written: ${linkedIndustries}`);
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === scriptPath;
if (isMain) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await sequelize.close();
      } catch {
        // ignore
      }
    });
}
