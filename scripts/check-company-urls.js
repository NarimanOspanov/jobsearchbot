/**
 * Check RemoteCompanies.Url reachability. Reports OK / redirected / blocked / BROKEN.
 *   node scripts/check-company-urls.js [--concurrency 12]
 * Interpretation: 2xx = ok; 3xx-final-2xx = ok; 401/403/429 = likely bot-blocked (url ok);
 * 404/410/5xx/DNS/timeout = BROKEN (needs a new careers/website URL).
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sequelize, models } from '../src/db.js';

const args = process.argv.slice(2);
const ci = args.indexOf('--concurrency');
const CONCURRENCY = ci >= 0 ? Math.max(1, Number(args[ci + 1]) || 12) : 12;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BLOCKED = new Set([401, 403, 429, 999]); // anti-bot, not broken

async function check(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    let res;
    try {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
    } catch (e) {
      return { ok: false, status: 'ERR', detail: String(e.message || e).split('\n')[0], finalUrl: null };
    }
    const status = res.status;
    const finalUrl = res.url;
    if (status >= 200 && status < 300) return { ok: true, status, finalUrl };
    if (BLOCKED.has(status)) return { ok: true, blocked: true, status, finalUrl };
    return { ok: false, status, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const rows = await models.RemoteCompanies.findAll({ attributes: ['Id', 'Name', 'Url'], order: [['Id', 'ASC']], raw: true });
  console.log(`checking ${rows.length} URLs (concurrency ${CONCURRENCY})…`);
  const results = [];
  let cursor = 0, done = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const r = await check(row.Url);
      results.push({ ...row, ...r });
      done++;
      if (done % 20 === 0 || done === rows.length) process.stdout.write(`\r  ${done}/${rows.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write('\n');

  const broken = results.filter((r) => !r.ok);
  const blocked = results.filter((r) => r.blocked);
  const redirected = results.filter((r) => r.ok && !r.blocked && r.finalUrl && r.finalUrl.replace(/\/$/, '') !== r.Url.replace(/\/$/, ''));
  console.log(`OK: ${results.filter((r) => r.ok && !r.blocked).length} | blocked(anti-bot, treat ok): ${blocked.length} | BROKEN: ${broken.length}`);
  console.log('\n=== BROKEN (need fixing) ===');
  for (const r of broken.sort((a, b) => a.Id - b.Id)) console.log(`#${r.Id}\t${r.status}\t${r.Name}\t${r.Url}${r.detail ? '  ('+r.detail+')' : ''}`);
  console.log('\n=== BLOCKED (anti-bot; verify manually if unsure) ===');
  for (const r of blocked.sort((a, b) => a.Id - b.Id)) console.log(`#${r.Id}\t${r.status}\t${r.Name}\t${r.Url}`);
  console.log('\n=== REDIRECTED (url still works; final differs) ===');
  for (const r of redirected.slice(0, 40)) console.log(`#${r.Id}\t${r.Name}\t${r.Url}  ->  ${r.finalUrl}`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { try { await sequelize.close(); } catch {} });
}
