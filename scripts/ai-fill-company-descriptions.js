/**
 * Generate ShortDescriptionRU / ShortDescriptionEng for RemoteCompanies via Gemini.
 *
 * Usage:
 *   node scripts/ai-fill-company-descriptions.js --dry-run            # preview, no writes
 *   node scripts/ai-fill-company-descriptions.js --only-missing       # only rows with empty descriptions
 *   node scripts/ai-fill-company-descriptions.js                      # (re)fill all
 *   node scripts/ai-fill-company-descriptions.js --company-ids=12,34  # specific ids
 *   node scripts/ai-fill-company-descriptions.js --limit=20
 */
import { Op } from 'sequelize';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sequelize } from '../src/db.js';
import { initModels } from '../src/models/index.js';
import {
  COMPANY_DESCRIPTION_BATCH_SIZE,
  generateCompanyDescriptionsBatchWithAI,
} from '../src/services/aiService.js';

const models = initModels(sequelize);
const dryRun = process.argv.includes('--dry-run');
const onlyMissing = process.argv.includes('--only-missing');

function intArg(flag) {
  const arg = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (!arg) return null;
  const n = Number.parseInt(arg.slice(flag.length + 1), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function idsArg() {
  const arg = process.argv.find((a) => a.startsWith('--company-ids='));
  if (!arg) return null;
  const ids = arg.slice('--company-ids='.length).split(',').map((t) => Number.parseInt(t.trim(), 10)).filter((id) => id > 0);
  return ids.length ? [...new Set(ids)] : null;
}
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  const where = {};
  const ids = idsArg();
  if (ids) where.Id = { [Op.in]: ids };
  if (onlyMissing) {
    where[Op.and] = [
      { [Op.or]: [{ ShortDescriptionRU: null }, { ShortDescriptionRU: '' }] },
      { [Op.or]: [{ ShortDescriptionEng: null }, { ShortDescriptionEng: '' }] },
    ];
  }
  const limit = intArg('--limit');
  const rows = await models.RemoteCompanies.findAll({
    where,
    include: [{ model: models.Industries, as: 'Industries', through: { attributes: [] } }],
    order: [['Id', 'ASC']],
    ...(limit ? { limit } : {}),
  });
  console.log(`${rows.length} company(ies) to describe${onlyMissing ? ' (missing only)' : ''}`);
  if (!rows.length) return;

  const byId = new Map(rows.map((r) => [r.Id, r]));
  const payload = rows.map((r) => ({
    id: r.Id,
    name: r.Name,
    url: r.Url,
    industries: (r.Industries || []).map((i) => i.Name).filter(Boolean),
  }));

  let updated = 0;
  const batches = chunk(payload, COMPANY_DESCRIPTION_BATCH_SIZE);
  for (let b = 0; b < batches.length; b += 1) {
    let results = [];
    try {
      results = await generateCompanyDescriptionsBatchWithAI({ companies: batches[b] });
    } catch (e) {
      console.warn(`batch ${b + 1}/${batches.length} failed: ${e.message}`);
      continue;
    }
    for (const r of results) {
      const row = byId.get(r.companyId);
      if (!row) continue;
      if (dryRun) {
        console.log(`#${r.companyId} ${row.Name}\n  RU:  ${r.ru}\n  ENG: ${r.eng}`);
      } else {
        await row.update({ ShortDescriptionRU: r.ru, ShortDescriptionEng: r.eng });
      }
      updated += 1;
    }
    process.stdout.write(`\r  batch ${b + 1}/${batches.length} — ${updated} done`);
  }
  process.stdout.write('\n');
  console.log(`${dryRun ? 'Would update' : 'Updated'} ${updated} company(ies).`);
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === scriptPath;
if (isMain) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(async () => { try { await sequelize.close(); } catch { /* ignore */ } });
}
