/**
 * Backfill Applications.ApplyType for remote-positions rows created before ApplyType was
 * persisted (ScreenlyJobId set, ApplyType empty). The value is looked up per job from the
 * anyhires by-id endpoint:  GET https://anyhires.com/api/remote-positions/{ScreenlyJobId}
 * -> { success, position: { applyType, ... } }
 *
 * Usage:
 *   node scripts/backfill-apply-type.js --dry-run            # report only, no writes
 *   node scripts/backfill-apply-type.js                      # apply updates
 *   node scripts/backfill-apply-type.js --concurrency 20     # tune parallel fetches (default 15)
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Sequelize } from 'sequelize';
import { sequelize, models } from '../src/db.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const ci = args.indexOf('--concurrency');
const CONCURRENCY = ci >= 0 ? Math.max(1, Number(args[ci + 1]) || 15) : 15;
const si = args.indexOf('--status');
const STATUS = si >= 0 ? String(args[si + 1] || '').trim() : null; // e.g. --status applied
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? Math.max(1, Number(args[li + 1]) || 0) : null; // process at most N rows per run
const POSITION_URL = (id) => `https://anyhires.com/api/remote-positions/${id}`;

async function fetchApplyType(id) {
  try {
    const res = await fetch(POSITION_URL(id));
    if (!res.ok) return { id, error: `http ${res.status}` };
    const data = await res.json();
    const applyType = data?.position?.applyType;
    if (!data?.success || !applyType) return { id, error: 'no applyType' };
    return { id, applyType: String(applyType).slice(0, 50) };
  } catch (e) {
    return { id, error: e.message.split('\n')[0] };
  }
}

// Resolve applyType for every id with a bounded worker pool.
async function resolveApplyTypes(ids) {
  const map = new Map();
  const errors = [];
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const r = await fetchApplyType(id);
      if (r.applyType) map.set(id, r.applyType);
      else errors.push(r);
      done += 1;
      if (done % 100 === 0 || done === ids.length) {
        process.stdout.write(`\r  resolved ${done}/${ids.length} (matched ${map.size})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  process.stdout.write('\n');
  return { map, errors };
}

async function main() {
  const where = {
    ScreenlyJobId: { [Sequelize.Op.ne]: null },
    [Sequelize.Op.or]: [{ ApplyType: null }, { ApplyType: '' }],
  };
  if (STATUS) where.Status = STATUS; // prioritize a subset, e.g. --status applied
  const findOpts = { where, order: [['Id', 'ASC']] };
  if (LIMIT) findOpts.limit = LIMIT; // process in portions; re-run picks up the next batch (idempotent)
  const rows = await models.Applications.findAll(findOpts);
  console.log(`found ${rows.length} row(s) with empty ApplyType and a ScreenlyJobId${STATUS ? ` (Status='${STATUS}')` : ''}`);
  if (!rows.length) return;

  const ids = [...new Set(rows.map((r) => Number(r.ScreenlyJobId)).filter(Number.isSafeInteger))];
  console.log(`resolving ${ids.length} distinct job id(s) from anyhires (concurrency ${CONCURRENCY})…`);
  const { map, errors } = await resolveApplyTypes(ids);

  const byType = {};
  let updated = 0;
  let unmatched = 0;
  for (const row of rows) {
    const applyType = map.get(Number(row.ScreenlyJobId));
    if (!applyType) { unmatched += 1; continue; }
    byType[applyType] = (byType[applyType] || 0) + 1;
    if (!dryRun) await row.update({ ApplyType: applyType });
    updated += 1;
  }
  console.log(`${dryRun ? 'Would update' : 'Updated'} ${updated} row(s): ${JSON.stringify(byType)}`);
  console.log(`${unmatched} row(s) had no applyType from the API (e.g. position not found).`);
  if (errors.length) {
    const sample = errors.slice(0, 5).map((e) => `${e.id}:${e.error}`).join(', ');
    console.log(`${errors.length} id(s) failed to resolve. sample: ${sample}`);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === scriptPath;
if (isMain) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(async () => { try { await sequelize.close(); } catch { /* ignore */ } });
}
