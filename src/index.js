import { createHmac } from 'node:crypto';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { Sequelize } from 'sequelize';
import { config } from './config.js';
import { models } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function checkEnvLoaded() {
  const token = config.telegramBotToken;
  console.log('Env check:');
  console.log(
    '  TELEGRAM_BOT_TOKEN:',
    token ? `${token.slice(0, 8)}...${token.slice(-4)} (length ${token.length})` : 'MISSING'
  );
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN must be set.');
}

function toBoolOrUndefined(value) {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function toSearchModeOrUndefined(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'urgent' || normalized === 'not_urgent') return normalized;
  return undefined;
}

function toIntOrNullOrUndefined(value) {
  if (value == null || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function isValidTelegramWebAppUrl(urlValue) {
  if (!urlValue) return false;
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== 'https:') return false;
    const host = (parsed.hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    return true;
  } catch {
    return false;
  }
}

function verifyInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = createHmac('sha256', 'WebAppData').update(config.telegramBotToken).digest();
    const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (expected !== hash) return null;

    const userStr = params.get('user');
    return userStr ? JSON.parse(userStr) : {};
  } catch {
    return null;
  }
}

async function ensureUserByTelegramId(telegramId, username = null) {
  if (!telegramId) return null;
  let user = await models.Users.findOne({ where: { TelegramChatId: telegramId } });
  if (!user) {
    try {
      user = await models.Users.create({
        TelegramChatId: telegramId,
        TelegramUserName: username,
        DateJoined: Sequelize.literal('GETUTCDATE()'),
      });
    } catch (createErr) {
      if (createErr?.name === 'SequelizeUniqueConstraintError') {
        user = await models.Users.findOne({ where: { TelegramChatId: telegramId } });
      } else {
        throw createErr;
      }
    }
  } else if (user.TelegramUserName !== username) {
    await user.update({ TelegramUserName: username });
  }
  return user;
}

async function ensureUser(ctx) {
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  const username = ctx.from?.username ?? null;
  return ensureUserByTelegramId(chatId, username);
}

async function miniAppAuth(req, res, next) {
  const initData = req.headers['x-init-data'];

  if (!initData && process.env.NODE_ENV !== 'production') {
    const fallbackId = Number(req.headers['x-dev-telegram-id']);
    if (Number.isSafeInteger(fallbackId) && fallbackId > 0) {
      req.miniAppUser = { id: fallbackId, username: req.headers['x-dev-username'] || null };
      return next();
    }
  }

  if (!initData) return res.status(401).json({ error: 'Unauthorized' });
  const user = verifyInitData(initData);
  if (!user || !user.id) return res.status(403).json({ error: 'Forbidden' });
  req.miniAppUser = user;
  return next();
}

function registerHandlers(bot, appBaseUrl) {
  const applicationsUrl = appBaseUrl ? `${appBaseUrl}/app/applications` : '';
  const profileUrl = appBaseUrl ? `${appBaseUrl}/app/profile` : '';
  const canUseApplicationsWebApp = isValidTelegramWebAppUrl(applicationsUrl);
  const canUseProfileWebApp = isValidTelegramWebAppUrl(profileUrl);

  bot.use(async (ctx, next) => {
    try {
      await ensureUser(ctx);
    } catch (err) {
      console.error('ensureUser error:', err);
    }
    return next();
  });

  bot.start(async (ctx) => {
    if (canUseApplicationsWebApp) {
      await ctx.reply('Open your job agent mini app:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Open Applications', web_app: { url: applicationsUrl } }]],
        },
      });
      return;
    }
    if (applicationsUrl) {
      await ctx.reply(
        `Bot is active. Mini app URL is not valid for Telegram WebApp button: ${applicationsUrl}\n` +
          'Use a public HTTPS domain (not localhost) for WEBHOOK_URL/ADMIN_APP_URL.'
      );
      return;
    }
    await ctx.reply('Bot is active. Set WEBHOOK_URL or ADMIN_APP_URL to public HTTPS URL for mini app button.');
  });

  bot.command('applications', async (ctx) => {
    if (canUseApplicationsWebApp) {
      await ctx.reply('Open applications:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Applications', web_app: { url: applicationsUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Applications page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  });

  bot.command('profile', async (ctx) => {
    if (canUseProfileWebApp) {
      await ctx.reply('Open profile:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Profile', web_app: { url: profileUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Profile page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });
}

async function main() {
  process.stdout.write('App: main() started\n');
  const port = process.env.PORT || 3000;

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) => res.status(200).send('OK'));
  app.use('/app', express.static(join(__dirname, '..', 'public', 'app')));
  app.get('/app/applications', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'applications.html'));
  });
  app.get('/app/profile', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'profile.html'));
  });

  let runtimeBotUsername = '';
  app.get('/api/app/bot-info', (_req, res) => res.json({ botUsername: runtimeBotUsername }));

  app.get('/api/app/profile', miniAppAuth, async (req, res) => {
    try {
      const user = await ensureUserByTelegramId(req.miniAppUser.id, req.miniAppUser.username ?? null);
      res.json({
        id: user.Id,
        telegramChatId: String(user.TelegramChatId),
        telegramUserName: user.TelegramUserName,
        settings: {
          hhEnabled: !!user.HhEnabled,
          linkedInEnabled: !!user.LinkedInEnabled,
          indeedEnabled: !!user.IndeedEnabled,
          companySitesEnabled: !!user.CompanySitesEnabled,
          emailFoundersEnabled: !!user.EmailFoundersEnabled,
          emailRecruitersEnabled: !!user.EmailRecruitersEnabled,
          searchMode: user.SearchMode || 'not_urgent',
          minimumSalary: user.MinimumSalary,
          remoteOnly: !!user.RemoteOnly,
        },
      });
    } catch (err) {
      console.error('GET /api/app/profile:', err);
      res.status(500).json({ error: 'Failed to load profile' });
    }
  });

  app.patch('/api/app/profile/settings', miniAppAuth, async (req, res) => {
    try {
      const user = await ensureUserByTelegramId(req.miniAppUser.id, req.miniAppUser.username ?? null);
      const patch = {
        HhEnabled: toBoolOrUndefined(req.body.hhEnabled),
        LinkedInEnabled: toBoolOrUndefined(req.body.linkedInEnabled),
        IndeedEnabled: toBoolOrUndefined(req.body.indeedEnabled),
        CompanySitesEnabled: toBoolOrUndefined(req.body.companySitesEnabled),
        EmailFoundersEnabled: toBoolOrUndefined(req.body.emailFoundersEnabled),
        EmailRecruitersEnabled: toBoolOrUndefined(req.body.emailRecruitersEnabled),
        SearchMode: toSearchModeOrUndefined(req.body.searchMode),
        MinimumSalary: toIntOrNullOrUndefined(req.body.minimumSalary),
        RemoteOnly: toBoolOrUndefined(req.body.remoteOnly),
      };

      const updates = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => typeof v === 'boolean' || typeof v === 'string' || v === null || typeof v === 'number')
      );
      if (Object.keys(updates).length > 0) await user.update(updates);

      res.json({
        ok: true,
        settings: {
          hhEnabled: !!user.HhEnabled,
          linkedInEnabled: !!user.LinkedInEnabled,
          indeedEnabled: !!user.IndeedEnabled,
          companySitesEnabled: !!user.CompanySitesEnabled,
          emailFoundersEnabled: !!user.EmailFoundersEnabled,
          emailRecruitersEnabled: !!user.EmailRecruitersEnabled,
          searchMode: user.SearchMode || 'not_urgent',
          minimumSalary: user.MinimumSalary,
          remoteOnly: !!user.RemoteOnly,
        },
      });
    } catch (err) {
      console.error('PATCH /api/app/profile/settings:', err);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  app.get('/api/app/applications', miniAppAuth, async (req, res) => {
    try {
      const user = await ensureUserByTelegramId(req.miniAppUser.id, req.miniAppUser.username ?? null);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.Applications.findAll({
        where: { UserId: user.Id },
        order: [['AppliedAt', 'DESC'], ['Id', 'DESC']],
        limit,
        offset,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/applications:', err);
      res.status(500).json({ error: 'Failed to load applications' });
    }
  });

  app.post('/api/app/applications', miniAppAuth, async (req, res) => {
    try {
      const user = await ensureUserByTelegramId(req.miniAppUser.id, req.miniAppUser.username ?? null);
      const vacancyTitle = String(req.body.vacancyTitle || '').trim();
      if (!vacancyTitle) return res.status(400).json({ error: 'vacancyTitle is required' });

      const row = await models.Applications.create({
        UserId: user.Id,
        VacancyTitle: vacancyTitle.slice(0, 255),
        CompanyName: req.body.companyName ? String(req.body.companyName).slice(0, 255) : null,
        Source: req.body.source ? String(req.body.source).slice(0, 50) : null,
        Status: req.body.status ? String(req.body.status).slice(0, 50) : 'applied',
        AppliedAt: req.body.appliedAt ? new Date(req.body.appliedAt) : new Date(),
        Notes: req.body.notes ? String(req.body.notes) : null,
        MetaJson: req.body.metaJson ? JSON.stringify(req.body.metaJson) : null,
      });

      res.status(201).json(row);
    } catch (err) {
      console.error('POST /api/app/applications:', err);
      res.status(500).json({ error: 'Failed to create application' });
    }
  });

  await new Promise((resolve) => app.listen(port, resolve));
  console.log('HTTP server listening on port', port);

  try {
    checkEnvLoaded();
  } catch (err) {
    console.error('Env error:', err.message);
    return;
  }

  const bot = new Telegraf(config.telegramBotToken, { handlerTimeout: 300_000 });
  console.log('Checking Telegram connection (getMe)...');

  try {
    const me = await bot.telegram.getMe();
    runtimeBotUsername = me?.username || '';
    console.log('Telegram OK.', runtimeBotUsername ? `@${runtimeBotUsername}` : '(username not set)');
  } catch (err) {
    console.error('Cannot reach Telegram:', err.message);
    return;
  }

  const appBaseUrl = (process.env.ADMIN_APP_URL || config.webhookUrl || '').replace(/\/$/, '');
  registerHandlers(bot, appBaseUrl);

  try {
    await bot.telegram.setMyCommands([
      { command: 'applications', description: 'Applications' },
      { command: 'profile', description: 'Profile' },
    ]);
  } catch (err) {
    console.error('Failed to set menu commands:', err.message);
  }

  if (config.isProduction) {
    app.use(bot.webhookCallback('/'));
    const webhookUrl = config.webhookUrl.replace(/\/$/, '');
    console.log('Setting webhook:', webhookUrl);
    try {
      await bot.telegram.setWebhook(webhookUrl);
      console.log('Webhook set. Bot is ready.');
    } catch (err) {
      console.error('Failed to set webhook:', err.message);
    }
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch();
    console.log('Polling started. Bot is ready.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
