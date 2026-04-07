import { createHmac } from 'node:crypto';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { Sequelize } from 'sequelize';
import { config } from './config.js';
import { models, sequelize } from './db.js';
import { createResumeStorage } from './services/resumeStorage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WELCOME_NEW_USER =
  'Welcome to Job Agent.\n\n' +
  'Use the menu (Applications / Profile) to manage your applications and profile settings.';
const ABOUT_MESSAGE = [
  'Забудьте про поиск работы вручную.',
  '',
  'Будущее наступило. Теперь у каждого человека будет личный ИИ-агент для поиска работы.',
  '',
  'Что требуется:',
  '- Загрузить резюме',
  '- Указать предпочтения',
  '',
  'Все остальное агент берет на себя. Вы получите уведомление, когда потребуется действие.',
  '',
  'Как это работает:',
  'Агент мониторит большое количество сайтов компаний с вакансиями на полную удаленку.',
  'Не джоб-борды, а напрямую разделы с вакансиями на сайтах компаний.',
  '',
  'Если вакансия подходит, ИИ откликается с персонализированным резюме,',
  'адаптируя ваш опыт под конкретные требования.',
  '',
  'Это повышает шансы на просмотр: для рекрутера ваш отклик выглядит',
  'как качественная ручная работа.',
  '',
  'Агент сам распознает поля любых форм и заполняет их вашими данными.',
].join('\n');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Keeps Telegram «печатает…» alive for long waits (action expires ~after 5s). */
async function withTypingTelegram(telegram, chatId, ms) {
  const pulse = () => telegram.sendChatAction(chatId, 'typing').catch(() => {});
  pulse();
  const id = setInterval(pulse, 4000);
  try {
    await sleep(ms);
  } finally {
    clearInterval(id);
  }
}

/** @type {Map<number, { step: string }>} */
const hireAgentStateByChatId = new Map();

const HIRE_AGENT_FAKE_QUEUE = [
  { role: 'Backend Engineer', company: 'Deel' },
  { role: 'Fullstack Engineer', company: 'GitLab' },
  { role: 'Data Engineer', company: 'Zapier' },
  { role: 'DevOps Engineer', company: 'Canonical' },
  { role: 'Software Engineer', company: 'Automattic' },
  { role: 'Product Engineer', company: 'PostHog' },
  { role: 'ML Engineer', company: 'Apollo' },
  { role: 'Frontend Engineer', company: 'ClickUp' },
  { role: 'Platform Engineer', company: 'Circle' },
  { role: 'Security Engineer', company: '1Password' },
];
const resumeStorage = createResumeStorage(config);

/** doneThroughIndex: rows with j <= index are ✅ (green); the rest ⬜. Use -1 so all are ⬜. */
function formatHireAgentFullList(doneThroughIndex) {
  return HIRE_AGENT_FAKE_QUEUE.map((p, j) => {
    const mark = j <= doneThroughIndex ? '✅' : '⬜';
    return `${mark} ${p.role} · ${p.company}`;
  }).join('\n');
}

async function runHireAgentFakeApplying(ctx, chatId) {
  await withTypingTelegram(ctx.telegram, chatId, 500 + Math.floor(Math.random() * 500));
  const pendingPreview = formatHireAgentFullList(-1);
  const statusMsg = await ctx.reply(
    `⏳ Запускаю автоматические отклики…\nСтатус: подготовка\n\nВакансии (${HIRE_AGENT_FAKE_QUEUE.length}):\n${pendingPreview}`
  );
  const mid = statusMsg.message_id;
  const api = ctx.telegram;

  for (let i = 0; i < HIRE_AGENT_FAKE_QUEUE.length; i++) {
    const current = HIRE_AGENT_FAKE_QUEUE[i];
    const listBlock = formatHireAgentFullList(i);
    const text =
      `Статус: отправка отклика…\n` +
      `Сейчас: ${current.role} — ${current.company}\n\n` +
      listBlock;
    await api.editMessageText(chatId, mid, undefined, text).catch(() => {});
    await withTypingTelegram(api, chatId, 900 + Math.floor(Math.random() * 700));
  }

  const allChecked = formatHireAgentFullList(HIRE_AGENT_FAKE_QUEUE.length - 1);
  await api
    .editMessageText(
      chatId,
      mid,
      undefined,
      `✅ Первая партия откликов завершена (демо).\n\n${allChecked}`
    )
    .catch(() => {});

  await ctx.reply(
    'Я откликнулся на первые 10 позиций. Резюме и сопроводительные письма были адаптированы под каждую вакансию.\n\n' +
      'Проверьте почту — возможно, уже есть письма от работодателей.\n\n' +
      'Чтобы продолжить, купите подписку.',
    {
      reply_markup: {
        inline_keyboard: [[{ text: 'Продолжить', callback_data: 'hireagent_continue' }]],
      },
    }
  );
  hireAgentStateByChatId.set(chatId, { step: 'idle' });
}

function checkEnvLoaded() {
  const token = config.telegramBotToken;
  console.log('Env check:');
  console.log(
    '  TELEGRAM_BOT_TOKEN:',
    token ? `${token.slice(0, 8)}...${token.slice(-4)} (length ${token.length})` : 'MISSING'
  );
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN must be set.');
  if (!config.azureStorageConnectionString) {
    console.warn('AZURE_STORAGE_CONNECTION_STRING is missing; resume uploads in /hireagent will fail.');
  }
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

function toStringOrUndefined(value, maxLen = 255) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function toValidUrlOrUndefined(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
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

/** Deletes Applications rows then User for the given Telegram chat id. */
async function removeUserDataByTelegramChatId(telegramChatId) {
  return sequelize.transaction(async (transaction) => {
    const user = await models.Users.findOne({
      where: { TelegramChatId: telegramChatId },
      transaction,
    });
    if (!user) return { ok: true, found: false, applicationsDeleted: 0 };
    const applicationsDeleted = await models.Applications.destroy({
      where: { UserId: user.Id },
      transaction,
    });
    await user.destroy({ transaction });
    return { ok: true, found: true, applicationsDeleted };
  });
}

function pickResumeSourceFromMessage(message) {
  if (!message) return null;
  if (message.document?.file_id) {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name || null,
      mimeType: message.document.mime_type || 'application/octet-stream',
    };
  }
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    if (!largest?.file_id) return null;
    return {
      fileId: largest.file_id,
      fileName: `resume-${largest.file_unique_id || largest.file_id}.jpg`,
      mimeType: 'image/jpeg',
    };
  }
  return null;
}

async function downloadTelegramFileAsBuffer(telegram, fileId) {
  const fileUrl = await telegram.getFileLink(fileId);
  const response = await fetch(fileUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
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

async function adminMiniAppAuth(req, res, next) {
  await miniAppAuth(req, res, async () => {
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) return res.status(403).json({ error: 'Admin mode is disabled' });
    const userId = Number(req.miniAppUser?.id);
    if (!Number.isSafeInteger(userId) || !adminIds.has(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  });
}

function registerHandlers(bot, appBaseUrl) {
  const applicationsUrl = appBaseUrl ? `${appBaseUrl}/app/applications` : '';
  const profileUrl = appBaseUrl ? `${appBaseUrl}/app/profile` : '';
  const companiesUrl = appBaseUrl ? `${appBaseUrl}/app/companies` : '';
  const canUseApplicationsWebApp = isValidTelegramWebAppUrl(applicationsUrl);
  const canUseProfileWebApp = isValidTelegramWebAppUrl(profileUrl);
  const canUseCompaniesWebApp = isValidTelegramWebAppUrl(companiesUrl);

  bot.use(async (ctx, next) => {
    try {
      const chatId = ctx.chat?.id ?? ctx.from?.id;
      if (chatId) {
        const existing = await models.Users.findOne({ where: { TelegramChatId: chatId } });
        ctx.state.isFirstTimeUser = !existing;
      } else {
        ctx.state.isFirstTimeUser = false;
      }
      await ensureUser(ctx);
    } catch (err) {
      console.error('ensureUser error:', err);
    }
    return next();
  });

  bot.start(async (ctx) => {
    if (ctx.state.isFirstTimeUser) {
      await ctx.reply(WELCOME_NEW_USER);
    }
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

  bot.command('hireagent', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Этот сценарий доступен только в личном чате с ботом.');
      return;
    }
    hireAgentStateByChatId.set(ctx.chat.id, { step: 'awaiting_cv' });
    await ctx.reply(
      'Привет! Я Алекс! Ваш персональный карьерный агент. Я буду искать для Вас вакансии на 100% удалёнку и откликаться за вас.\n\n' +
        'От вас требуется лишь резюме. Когда подтребуются действия, я напишу.\n\n' +
        'Отправьте резюме файлом (PDF или изображение) — я «разберу» его и начну работу.'
    );
  });

  bot.action('hireagent_yes', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) return;
    const st = hireAgentStateByChatId.get(chatId);
    if (st?.step !== 'awaiting_confirm') {
      await ctx.reply('Сначала пройдите шаг с резюме в диалоге с агентом (/hireagent).');
      return;
    }
    hireAgentStateByChatId.set(chatId, { step: 'applying' });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await runHireAgentFakeApplying(ctx, chatId);
  });

  bot.action('hireagent_no', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) return;
    const st = hireAgentStateByChatId.get(chatId);
    if (st?.step !== 'awaiting_confirm') return;
    hireAgentStateByChatId.set(chatId, { step: 'idle' });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await ctx.reply('Хорошо. Когда будете готовы — снова выберите «Нанять агента» в меню.');
  });

  bot.action('hireagent_continue', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
  });

  bot.on(['document', 'photo'], async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const chatId = ctx.chat.id;
    const st = hireAgentStateByChatId.get(chatId);
    if (st?.step !== 'awaiting_cv') return next();
    const resumeSource = pickResumeSourceFromMessage(ctx.message);
    if (!resumeSource) {
      await ctx.reply('Не удалось распознать файл резюме. Отправьте PDF или изображение еще раз.');
      return;
    }
    try {
      await ctx.reply('Спасибо! Загружаю и анализирую резюме…');
      await withTypingTelegram(ctx.telegram, chatId, 1200 + Math.floor(Math.random() * 600));

      const fileBuffer = await downloadTelegramFileAsBuffer(ctx.telegram, resumeSource.fileId);
      const resumeUrl = await resumeStorage.uploadResumeBuffer({
        chatId,
        fileId: resumeSource.fileId,
        fileName: resumeSource.fileName,
        mimeType: resumeSource.mimeType,
        buffer: fileBuffer,
      });

      const user = await ensureUserByTelegramId(chatId, ctx.from?.username ?? null);
      await user.update({ ResumeURL: resumeUrl });

      await withTypingTelegram(ctx.telegram, chatId, 800 + Math.floor(Math.random() * 400));
      hireAgentStateByChatId.set(chatId, { step: 'awaiting_confirm' });
      await ctx.reply(
        'Готово. Я сохранил ваше резюме и нашёл 263 вакансии с полной удалёнкой (100%), которые вам подходят.\n\n' +
          'Запустить автоматические отклики?',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Да, начинай', callback_data: 'hireagent_yes' },
                { text: 'Нет, позже', callback_data: 'hireagent_no' },
              ],
            ],
          },
        }
      );
    } catch (err) {
      console.error('hireagent resume upload failed:', err);
      await ctx.reply(
        'Не удалось сохранить резюме. Проверьте настройки Azure Storage (AZURE_STORAGE_CONNECTION_STRING) и попробуйте снова.'
      );
      hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv' });
    }
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

  bot.command('about', async (ctx) => {
    await ctx.reply(ABOUT_MESSAGE);
  });

  bot.command('companies', async (ctx) => {
    if (canUseCompaniesWebApp) {
      await ctx.reply('Open companies:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Companies', web_app: { url: companiesUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Companies page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  });

  bot.command('removeuser', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('This command only works in a private chat with the bot.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) {
      await ctx.reply('This command is disabled. Set BOT_ADMIN_TELEGRAM_IDS in the server environment.');
      return;
    }
    const fromId = ctx.from?.id;
    if (!fromId || !adminIds.has(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    const text = (ctx.message?.text || '').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const arg = parts[1];
    if (!arg || !/^-?\d+$/.test(arg)) {
      await ctx.reply('Usage: /removeuser <telegramChatId>');
      return;
    }
    const targetChatId = Number(arg);
    if (!Number.isSafeInteger(targetChatId)) {
      await ctx.reply('Chat id is not a valid integer.');
      return;
    }
    try {
      const result = await removeUserDataByTelegramChatId(targetChatId);
      console.log('removeuser:', { adminTelegramId: fromId, targetChatId, ...result });
      if (!result.found) {
        await ctx.reply(`No user found for chat id ${targetChatId}.`);
        return;
      }
      await ctx.reply(
        `Removed user ${targetChatId} and ${result.applicationsDeleted} application(s).`
      );
    } catch (err) {
      console.error('removeuser failed:', err);
      await ctx.reply('Failed to remove user data. Check server logs.');
    }
  });

  bot.on('text', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const cmd = ctx.message?.entities?.[0];
    if (cmd?.type === 'bot_command' && cmd.offset === 0) return next();
    const st = hireAgentStateByChatId.get(ctx.chat.id);
    if (st?.step === 'awaiting_cv') {
      await ctx.reply('Пожалуйста, отправьте резюме файлом (PDF или изображение), а не текстом.');
      return;
    }
    return next();
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
  app.get('/app/companies', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'companies.html'));
  });
  app.get('/app/admin/companies', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'app', 'admin-companies.html'));
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
        resumeUrl: user.ResumeURL,
        settings: {
          hhEnabled: !!user.HhEnabled,
          linkedInEnabled: !!user.LinkedInEnabled,
          indeedEnabled: !!user.IndeedEnabled,
          telegramEnabled: !!user.TelegramEnabled,
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
        TelegramEnabled: toBoolOrUndefined(req.body.telegramEnabled),
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
          telegramEnabled: !!user.TelegramEnabled,
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

  app.get('/api/app/companies', miniAppAuth, async (_req, res) => {
    try {
      const rows = await models.RemoteCompanies.findAll({
        order: [['DateAdded', 'DESC'], ['Id', 'DESC']],
        limit: 500,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/companies:', err);
      res.status(500).json({ error: 'Failed to load companies' });
    }
  });

  app.get('/api/app/admin/companies', adminMiniAppAuth, async (_req, res) => {
    try {
      const rows = await models.RemoteCompanies.findAll({
        order: [['DateAdded', 'DESC'], ['Id', 'DESC']],
        limit: 1000,
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/app/admin/companies:', err);
      res.status(500).json({ error: 'Failed to load admin companies' });
    }
  });

  app.post('/api/app/admin/companies', adminMiniAppAuth, async (req, res) => {
    try {
      const name = toStringOrUndefined(req.body.name, 255);
      const url = toValidUrlOrUndefined(req.body.url);
      if (!name || !url) return res.status(400).json({ error: 'name and valid url are required' });
      const row = await models.RemoteCompanies.create({
        Name: name,
        Url: url,
        DateAdded: Sequelize.literal('GETUTCDATE()'),
      });
      res.status(201).json(row);
    } catch (err) {
      console.error('POST /api/app/admin/companies:', err);
      res.status(500).json({ error: 'Failed to create company' });
    }
  });

  app.patch('/api/app/admin/companies/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

      const row = await models.RemoteCompanies.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Company not found' });

      const updates = {};
      const name = toStringOrUndefined(req.body.name, 255);
      const url = toValidUrlOrUndefined(req.body.url);
      if (name) updates.Name = name;
      if (url) updates.Url = url;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'At least one valid field is required' });
      }
      await row.update(updates);
      res.json(row);
    } catch (err) {
      console.error('PATCH /api/app/admin/companies/:id:', err);
      res.status(500).json({ error: 'Failed to update company' });
    }
  });

  app.delete('/api/app/admin/companies/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const deleted = await models.RemoteCompanies.destroy({ where: { Id: id } });
      if (!deleted) return res.status(404).json({ error: 'Company not found' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/app/admin/companies/:id:', err);
      res.status(500).json({ error: 'Failed to delete company' });
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
      { command: 'hireagent', description: 'Нанять агента' },
      { command: 'profile', description: 'Settings' },
      { command: 'companies', description: 'Companies' },
      { command: 'about', description: 'About' },
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
