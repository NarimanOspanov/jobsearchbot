/**
 * Rebuild RemoteCompanyIndustries links using Gemini classification.
 *
 * Usage:
 *   npm run companies:ai-assign-industries
 *   node scripts/ai-assign-company-industries.js --dry-run
 *   node scripts/ai-assign-company-industries.js --company-ids=1007,1008
 */
import { Op } from 'sequelize';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sequelize } from '../src/db.js';
import { initModels } from '../src/models/index.js';
import { setCompanyIndustries } from '../src/services/companiesService.js';
import {
  COMPANY_INDUSTRY_BATCH_SIZE,
  classifyCompaniesIndustriesBatchWithAI,
} from '../src/services/aiService.js';

const models = initModels(sequelize);
const dryRun = process.argv.includes('--dry-run');
const CHUNK_CONCURRENCY = 2;
const CHUNK_RETRY_COUNT = 1;

function parseCompanyIdsArg() {
  const arg = process.argv.find((item) => item.startsWith('--company-ids='));
  if (!arg) return null;
  const ids = arg
    .slice('--company-ids='.length)
    .split(',')
    .map((token) => Number.parseInt(String(token).trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return ids.length ? [...new Set(ids)] : null;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function runChunkWithRetry({ industries, companies, chunkIndex }) {
  let lastError = null;
  for (let attempt = 0; attempt <= CHUNK_RETRY_COUNT; attempt += 1) {
    try {
      const rows = await classifyCompaniesIndustriesBatchWithAI({ industries, companies });
      return rows;
    } catch (err) {
      lastError = err;
      console.warn(`Chunk ${chunkIndex} attempt ${attempt + 1} failed:`, err.message);
    }
  }
  throw lastError || new Error(`Chunk ${chunkIndex} failed`);
}

async function processChunksInParallel(chunks, industries) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= chunks.length) return;
      const companies = chunks[current];
      const rows = await runChunkWithRetry({ industries, companies, chunkIndex: current });
      results.push(...rows);
      console.log(`Chunk ${current + 1}/${chunks.length}: classified ${companies.length} companies`);
    }
  }

  const workers = Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const filterIds = parseCompanyIdsArg();
  const industryRows = await models.Industries.findAll({
    order: [['SortOrder', 'ASC'], ['Name', 'ASC']],
  });
  if (!industryRows.length) throw new Error('No industries found. Import industries first.');

  const industries = industryRows.map((row) => ({
    id: row.Id,
    name: row.Name,
    nameEng: row.NameEng,
    slug: row.Slug,
  }));

  const companyWhere = filterIds ? { Id: { [Op.in]: filterIds } } : undefined;
  const companyRows = await models.RemoteCompanies.findAll({
    where: companyWhere,
    order: [['Id', 'ASC']],
  });
  if (!companyRows.length) throw new Error('No companies found to classify.');

  const companies = companyRows.map((row) => ({
    id: row.Id,
    name: row.Name,
    url: row.Url,
  }));

  console.log(`Industries: ${industries.length}`);
  console.log(`Companies: ${companies.length}`);
  if (!filterIds) {
    if (dryRun) {
      console.log('Dry run: would delete all RemoteCompanyIndustries rows');
    } else {
      const deleted = await models.RemoteCompanyIndustries.destroy({ where: {}, truncate: false });
      console.log(`Deleted ${deleted} existing industry links`);
    }
  } else {
    console.log(`Partial run for company ids: ${filterIds.join(', ')}`);
  }

  const chunks = chunkArray(companies, COMPANY_INDUSTRY_BATCH_SIZE);
  const assignments = await processChunksInParallel(chunks, industries);
  const byCompanyId = new Map(assignments.map((item) => [item.companyId, item.industryIds]));

  let written = 0;
  let empty = 0;
  for (const company of companies) {
    const industryIds = byCompanyId.get(company.id) || [];
    const labels = industryIds
      .map((id) => industries.find((item) => item.id === id))
      .filter(Boolean)
      .map((item) => item.nameEng || item.name)
      .join(', ');
    console.log(`#${company.id} ${company.name} -> [${labels || 'none'}]`);
    if (!industryIds.length) {
      empty += 1;
      if (!dryRun) await setCompanyIndustries(company.id, []);
      continue;
    }
    if (!dryRun) await setCompanyIndustries(company.id, industryIds);
    written += 1;
  }

  console.log('');
  console.log(`${dryRun ? 'Would write' : 'Wrote'} links for ${written} companies (${empty} with no industry)`);
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
