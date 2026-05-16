/**
 * Push updated command menus to Telegram without restarting the main bot process.
 * Usage: npm run menus:refresh
 */
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { config } from '../src/config.js';
import { sequelize, models } from '../src/db.js';
import { refreshBotMenus } from '../src/i18n/botI18n.js';

async function main() {
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }

  const bot = new Telegraf(config.telegramBotToken);
  const me = await bot.telegram.getMe();
  console.log(`Refreshing menus for @${me.username || me.id}…`);

  const rows = await models.Users.findAll({
    attributes: ['TelegramChatId', 'Language'],
  });
  const result = await refreshBotMenus(
    bot.telegram,
    rows.map((u) => ({ telegramChatId: u.TelegramChatId, language: u.Language }))
  );

  console.log('Done.', result);
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
