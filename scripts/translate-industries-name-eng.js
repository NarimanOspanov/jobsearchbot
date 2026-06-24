/**
 * Translate Industries.Name -> NameEng via Gemini.
 *
 * Usage:
 *   npm run companies:translate-industries
 *   node scripts/translate-industries-name-eng.js --dry-run
 */
import { Op } from 'sequelize';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sequelize } from '../src/db.js';
import { initModels } from '../src/models/index.js';
import {
  INDUSTRY_TRANSLATE_BATCH_SIZE,
  translateIndustriesNameEngBatchWithAI,
} from '../src/services/aiService.js';

const models = initModels(sequelize);
const dryRun = process.argv.includes('--dry-run');

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function main() {
  const rows = await models.Industries.findAll({
    where: {
      [Op.or]: [{ NameEng: null }, { NameEng: '' }],
    },
    order: [['SortOrder', 'ASC'], ['Name', 'ASC']],
  });

  if (!rows.length) {
    console.log('All industries already have NameEng.');
    return;
  }

  const pending = rows.map((row) => ({
    id: row.Id,
    name: row.Name,
    slug: row.Slug,
  }));

  console.log(`Translating ${pending.length} industries in batches of ${INDUSTRY_TRANSLATE_BATCH_SIZE}...`);
  let updated = 0;

  for (const batch of chunkArray(pending, INDUSTRY_TRANSLATE_BATCH_SIZE)) {
    const translations = await translateIndustriesNameEngBatchWithAI({ industries: batch });
    const byId = new Map(translations.map((item) => [item.id, item.nameEng]));

    for (const item of batch) {
      const nameEng = byId.get(item.id);
      if (!nameEng) {
        console.warn(`No translation for #${item.id} ${item.name}`);
        continue;
      }
      console.log(`#${item.id} ${item.name} -> ${nameEng}`);
      if (!dryRun) {
        await models.Industries.update({ NameEng: nameEng }, { where: { Id: item.id } });
      }
      updated += 1;
    }
  }

  console.log('');
  console.log(`${dryRun ? 'Would update' : 'Updated'} ${updated} industries`);
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
