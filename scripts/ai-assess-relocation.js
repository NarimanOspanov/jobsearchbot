/**
 * Assess RemoteCompanies.HelpsWithRelocation (visa sponsorship / relocation support) via Gemini.
 * Values: true = helps relocate, false = no relocation (remote-only), null = unknown.
 *
 * Usage:
 *   node scripts/ai-assess-relocation.js --dry-run
 *   node scripts/ai-assess-relocation.js --only-missing
 *   node scripts/ai-assess-relocation.js
 *   node scripts/ai-assess-relocation.js --company-ids=12,34 --limit=20
 */
import { Op } from 'sequelize';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sequelize } from '../src/db.js';
import { initModels } from '../src/models/index.js';
import {
  COMPANY_RELOCATION_BATCH_SIZE,
  assessCompaniesRelocationBatchWithAI,
} from '../src/services/aiService.js';

const models = initModels(sequelize);
const dryRun = process.argv.includes('--dry-run');
const onlyMissing = process.argv.includes('--only-missing');

function intArg(flag) {
  const a = process.argv.find((x) => x.startsWith(`${flag}=`));
  if (!a) return null;
  const n = Number.parseInt(a.slice(flag.length + 1), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function idsArg() {
  const a = process.argv.find((x) => x.startsWith('--company-ids='));
  if (!a) return null;
  const ids = a.slice('--company-ids='.length).split(',').map((t) => Number.parseInt(t.trim(), 10)).filter((id) => id > 0);
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
  if (onlyMissing) where.HelpsWithRelocation = null;
  const limit = intArg('--limit');
  const rows = await models.RemoteCompanies.findAll({
    where,
    include: [{ model: models.Industries, as: 'Industries', through: { attributes: [] } }],
    order: [['Id', 'ASC']],
    ...(limit ? { limit } : {}),
  });
  console.log(`${rows.length} company(ies) to assess${onlyMissing ? ' (missing only)' : ''}`);
  if (!rows.length) return;

  const byId = new Map(rows.map((r) => [r.Id, r]));
  const payload = rows.map((r) => ({
    id: r.Id,
    name: r.Name,
    url: r.Url,
    industries: (r.Industries || []).map((i) => i.Name).filter(Boolean),
    description: r.ShortDescriptionEng || r.ShortDescriptionRU || null,
  }));

  const counts = { true: 0, false: 0, null: 0 };
  let processed = 0;
  for (const [b, batch] of chunk(payload, COMPANY_RELOCATION_BATCH_SIZE).entries()) {
    let results = [];
    try {
      results = await assessCompaniesRelocationBatchWithAI({ companies: batch });
    } catch (e) {
      console.warn(`\nbatch ${b + 1} failed: ${e.message}`);
      continue;
    }
    const seen = new Set(results.map((r) => r.companyId));
    // Any company the model omitted stays null.
    for (const r of results) {
      const row = byId.get(r.companyId);
      if (!row) continue;
      counts[String(r.relocation)] += 1;
      if (dryRun) console.log(`#${r.companyId} ${row.Name} -> ${r.relocation}`);
      else await row.update({ HelpsWithRelocation: r.relocation });
    }
    processed += seen.size;
    process.stdout.write(`\r  ${processed}/${payload.length} assessed`);
  }
  process.stdout.write('\n');
  console.log(`${dryRun ? 'Would set' : 'Set'}: true=${counts.true}, false=${counts.false}, null=${counts.null}`);
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === scriptPath;
if (isMain) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(async () => { try { await sequelize.close(); } catch { /* ignore */ } });
}
