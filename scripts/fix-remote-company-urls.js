/**
 * Normalize stored RemoteCompanies.Url values (unwrap Google redirect links, etc.).
 *
 * Usage:
 *   npm run companies:fix-urls
 *   node scripts/fix-remote-company-urls.js --dry-run
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sequelize } from '../src/db.js';
import { initModels } from '../src/models/index.js';
import { normalizeCareerUrl } from '../src/utils/urlNormalize.js';

const models = initModels(sequelize);
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const companies = await models.RemoteCompanies.findAll({ order: [['Id', 'ASC']] });
  let changed = 0;

  for (const company of companies) {
    const current = String(company.Url || '').trim();
    const normalized = normalizeCareerUrl(current);
    if (!normalized || normalized === current) continue;

    changed += 1;
    console.log(`#${company.Id} ${company.Name}`);
    console.log(`  before: ${current}`);
    console.log(`  after:  ${normalized}`);

    if (!dryRun) {
      await company.update({ Url: normalized.slice(0, 1024) });
    }
  }

  console.log('');
  console.log(`${dryRun ? 'Would update' : 'Updated'} ${changed} of ${companies.length} companies`);
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
