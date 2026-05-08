import { existsSync } from 'node:fs';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { Sequelize } from 'sequelize';
import { config } from './config.js';
import { models } from './db.js';
import { createResumeStorage } from './services/resumeStorage.js';

// utils
import {
  sleep,
  withTypingTelegram,
  runWithTyping,
  sendLongTelegramText,
  parseConfigBoolean,
  formatUsd,
  formatPlanPrice,
  normalizeChatId,
  formatUserDisplayName,
  formatUsername,
  HIRE_AGENT_FAKE_QUEUE,
  formatHireAgentFullList,
  runHireAgentFakeApplying,
} from './utils/helpers.js';
import {
  isValidTelegramWebAppUrl,
  pickResumeSourceFromMessage,
  downloadTelegramFileAsBuffer,
  parseStartPayload,
  parseStartReferralChatId,
  parseStartPositionId,
} from './utils/telegramUtils.js';

// services
import {
  extractResumeTextFromUrl,
} from './services/resumeService.js';
import {
  reviewResumeWithAI,
} from './services/aiService.js';
import {
  getConfigInt,
  buildPlanInvoicePayload,
  getActivePlans,
  getPlanByCode,
  getActiveSubscriptionForUser,
  ensureChannelSubscribeBonus,
  grantReferralBonusToReferrer,
} from './services/planService.js';
import {
  ensureRequiredChannelUserRecords,
  serializeRequiredChannels,
  getRequiredChannelsState,
} from './services/channelService.js';
import {
  ensureUserByTelegramId,
  ensureUser,
  removeUserDataByTelegramChatId,
  runResumeEnrichmentInBackground,
} from './services/userService.js';
import {
  hireAgentStateByChatId,
  legacyKeyboardClearedByChatId,
  cvScoreResultByUserId,
  runtimeBot,
} from './bot/state.js';

// routes
import { createStaticRouter } from './routes/static.js';
import { createResumeRouter } from './routes/api/resume.js';
import { createProfileRouter } from './routes/api/profile.js';
import { createMonetizationRouter } from './routes/api/monetization.js';
import { createAnalyticsRouter } from './routes/api/analytics.js';
import { createApplicationsRouter } from './routes/api/applications.js';
import { createCompaniesRouter } from './routes/api/companies.js';
import { createPositionsRouter } from './routes/api/positions.js';
import { createAdminRouter } from './routes/api/admin.js';
import { createNotificationsRouter } from './routes/api/notifications.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const START_INTRO_MESSAGE = [
  'Привет',
  '',
  'Получи доступ к вакансиям на 100% удалёнку',
].join('\n');
const ABOUT_MESSAGE = [
  'Забудьте про поиск работы вручную.',
  '',
  'У вас будет личный карьерный агент.',
  'Мы используем гибридную модель: человек-агент + ИИ.',
  '',
  'Что это значит на практике:',
  '- ИИ ищет релевантные remote вакансии и готовит отклики',
  '- Человек-агент проверяет качество и помогает там, где нужна ручная работа',
  '',
  'Если у сайта или бирж труда есть политика против автооткликов,',
  'или есть риск блокировки за автоматизацию — отклик делает человек-агент.',
  '',
  'Если таких ограничений нет, отклик отправляет ИИ-агент.',
  '',
  'Вы получаете скорость ИИ и надежность ручной проверки в одном процессе.',
  '',
  'Когда от вас потребуется действие, мы сразу напишем.',
  '',
  'Отчеты о проделанных откликах всегда доступны в разделе мои отклики',
].join('\n');

const resumeStorage = createResumeStorage(config);
const HIRE_AGENT_SIMULATION_CONFIG_KEY = 'hireAgentSimulationVisible';
const DIGITAL_NOMADS_CHANNEL_URL = 'https://t.me/+0zv_MNh22Xw3NTMy';
const REFERRAL_BONUS_OPENS_CONFIG_KEY = 'ReferralBonusOpens';


async function ensureHireAgentSimulationVisibleConfig() {
  const fallback = false;
  if (!models.Configs) return fallback;
  try {
    let row = await models.Configs.findOne({ where: { Key: HIRE_AGENT_SIMULATION_CONFIG_KEY } });
    if (!row) {
      row = await models.Configs.create({
        Key: HIRE_AGENT_SIMULATION_CONFIG_KEY,
        Value: String(fallback),
        Description: 'Controls demo simulation flow in /hireagent after CV upload',
        UpdatedAt: new Date(),
      });
    }
    return parseConfigBoolean(row.Value, fallback);
  } catch (err) {
    console.error('Failed to read Configs.hireAgentSimulationVisible; fallback=false:', err?.message || err);
    return fallback;
  }
}

function checkEnvLoaded() {
  const token = config.telegramBotToken;
  console.log('Env check:');
  console.log(
    '  TELEGRAM_BOT_TOKEN:',
    token ? `${token.slice(0, 8)}...${token.slice(-4)} (length ${token.length})` : 'MISSING'
  );
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN must be set.');
  if (!config.geminiApiKey && !config.anthropicApiKey) {
    console.warn('Both GEMINI_API_KEY and ANTHROPIC_API_KEY are missing; AI resume features will fail.');
  } else if (!config.geminiApiKey) {
    console.warn('GEMINI_API_KEY is missing; some AI features will fallback to Anthropic only.');
  } else if (!config.anthropicApiKey) {
    console.warn('ANTHROPIC_API_KEY is missing; /cvscore will fallback to Gemini.');
  }
  if (!config.azureStorageConnectionString) {
    console.warn('AZURE_STORAGE_CONNECTION_STRING is missing; resume uploads in /hireagent will fail.');
  }
}

function registerHandlers(bot, appBaseUrl, options = {}) {
  const hireAgentSimulationVisible = Boolean(options.hireAgentSimulationVisible);
  const seekerJobsUrl = appBaseUrl ? `${appBaseUrl}/app/seeker-jobs` : '';
  const pricingTmaUrl = appBaseUrl ? `${appBaseUrl}/app/pricing` : '';
  const applicationsUrl = appBaseUrl ? `${appBaseUrl}/app/applications` : '';
  const profileUrl = appBaseUrl ? `${appBaseUrl}/app/profile` : '';
  const companiesUrl = appBaseUrl ? `${appBaseUrl}/app/companies` : '';
  const adminUrl = appBaseUrl ? `${appBaseUrl}/app/admin` : '';
  const adminCompaniesUrl = appBaseUrl ? `${appBaseUrl}/app/admin/companies` : '';
  const adminPositionsUrl = appBaseUrl ? `${appBaseUrl}/app/admin/positions` : '';
  const adminNotificationsUrl = appBaseUrl ? `${appBaseUrl}/app/admin/notifications` : '';
  const stat2Url = appBaseUrl ? `${appBaseUrl}/app/stat2` : '';
  const cvScoreUrl = appBaseUrl ? `${appBaseUrl}/app/cvscore` : '';
  const canUseSeekerJobsWebApp = isValidTelegramWebAppUrl(seekerJobsUrl);
  const canUseApplicationsWebApp = isValidTelegramWebAppUrl(applicationsUrl);
  const canUseProfileWebApp = isValidTelegramWebAppUrl(profileUrl);
  const canUseCompaniesWebApp = isValidTelegramWebAppUrl(companiesUrl);
  const canUsePricingWebApp = isValidTelegramWebAppUrl(pricingTmaUrl);
  const canUseAdminWebApp = isValidTelegramWebAppUrl(adminUrl);
  const canUseAdminCompaniesWebApp = isValidTelegramWebAppUrl(adminCompaniesUrl);
  const canUseAdminPositionsWebApp = isValidTelegramWebAppUrl(adminPositionsUrl);
  const canUseAdminNotificationsWebApp = isValidTelegramWebAppUrl(adminNotificationsUrl);
  const canUseStat2WebApp = isValidTelegramWebAppUrl(stat2Url);
  const canUseCvScoreWebApp = isValidTelegramWebAppUrl(cvScoreUrl);
  const startAvatarPath = join(__dirname, '..', 'avatar.png');
  const notSubscribedImagePath = join(__dirname, '..', 'not_subscribed.png');
  const subscribedImagePath = join(__dirname, '..', 'subscribed.png');
  const startKeyboard = {
    inline_keyboard: [
      [
        canUseSeekerJobsWebApp
          ? { text: 'Открыть вакансии', web_app: { url: seekerJobsUrl } }
          : { text: 'Открыть вакансии', callback_data: 'start_open_jobsearch' },
      ],
    ],
  };
  const START_REQUIRED_CHANNEL_CONFIRM_CALLBACK = 'start_confirm_required_channels';

  const sendStartIntro = async (ctx) => {
    if (existsSync(startAvatarPath)) {
      await ctx.replyWithPhoto(
        { source: startAvatarPath },
        {
          caption: START_INTRO_MESSAGE,
          reply_markup: startKeyboard,
        }
      );
      return;
    }
    await ctx.reply(START_INTRO_MESSAGE, { reply_markup: startKeyboard });
  };

  const buildStartRequiredChannelsKeyboard = (channels) => {
    const serialized = serializeRequiredChannels(channels);
    const firstJoinUrl = String(serialized[0]?.joinUrl || '').trim();
    const channelButtons = firstJoinUrl ? [[{ text: '✈️ Подписаться на канал', url: firstJoinUrl }]] : [];
    return {
      inline_keyboard: [
        ...channelButtons,
        [{ text: '✅ Я подписался', callback_data: START_REQUIRED_CHANNEL_CONFIRM_CALLBACK }],
      ],
    };
  };

  const sendStartRequiredChannelsGate = async (ctx, channels) => {
    const lines = [
      '<b>Подпишись на канал, для старта</b>',
      '',
      '',
      'Мы фильтруем <b>10 000+ вакансий в день</b> — это требует серьёзных ресурсов. Подписка на канал помогает нам покрывать часть расходов, чтобы сервис оставался максимально доступным для вас.',
    ].filter(Boolean);
    const replyMarkup = buildStartRequiredChannelsKeyboard(channels);
    if (existsSync(notSubscribedImagePath)) {
      await ctx.replyWithPhoto(
        { source: notSubscribedImagePath },
        {
          caption: lines.join('\n'),
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        }
      );
      return;
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: replyMarkup });
  };

  const enforceStartRequiredChannelsGate = async (ctx) => {
    const telegramUserId = Number(ctx.from?.id || ctx.chat?.id || 0);
    if (!telegramUserId) return true;
    const channelsState = await getRequiredChannelsState(telegramUserId);
    if (channelsState.ok) {
      await ensureRequiredChannelUserRecords(telegramUserId);
      return true;
    }
    await sendStartRequiredChannelsGate(ctx, channelsState.channels);
    return false;
  };

  const notifyAdmins = async (ctx, message, errorLabel, telemetry = {}) => {
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) return;
    for (const adminId of adminIds) {
      await ctx.telegram.sendMessage(adminId, message).catch((err) => {
        console.error(errorLabel, {
          adminId,
          ...telemetry,
          error: err?.message || err,
        });
      });
    }
  };

  const formatPlanButtonLabel = (plan) => {
    const limit = Number(plan?.JobOpenMonthlyLimit || 0);
    const priceLabel = formatPlanPrice(plan?.PriceInStars, plan?.PriceUsd);
    return `${plan?.Name || 'Тариф'} · ${limit} открытий/мес · ${priceLabel}`;
  };

  const sendPlansIntro = async (ctx) => {
    const pricingButton = canUsePricingWebApp
      ? { text: 'Pricing', web_app: { url: pricingTmaUrl } }
      : { text: 'Pricing', callback_data: 'plan_pricing' };
    await ctx.reply(
      'Выберите формат оплаты через Telegram Stars. Нажмите Pricing, чтобы посмотреть доступные тарифы и описание.',
      {
        reply_markup: {
          inline_keyboard: [[pricingButton]],
        },
      }
    );
  };

  const sendPlanMenu = async (ctx) => {
    const plans = (await getActivePlans()).filter((plan) => Boolean(plan?.IsActive));
    if (plans.length === 0) {
      await ctx.reply('Платные тарифы временно недоступны.');
      return;
    }
    const sortedPlans = plans.sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0));
    const detailsText = sortedPlans
      .map((plan) => {
        const monthlyOpens = Number(plan.JobOpenMonthlyLimit || 0);
        const durationDays = Number(plan.DurationDays || 30);
        const aiText = plan.IncludesAiTools
          ? 'AI CV + Cover Letter включены'
          : 'AI CV + Cover Letter не включены';
        return `• ${plan.Name}: ${monthlyOpens} открытий/мес, ${durationDays} дней, ${formatPlanPrice(plan.PriceInStars, plan.PriceUsd)}, ${aiText}`;
      })
      .join('\n');
    const buttons = plans
      .sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0))
      .map((plan) => [{ text: formatPlanButtonLabel(plan), callback_data: `plan_buy_${String(plan.Code || '').toLowerCase()}` }]);
    await ctx.reply(`Pricing plans:\n${detailsText}\n\nВыберите подписку для оплаты в Telegram Stars:`, {
      reply_markup: { inline_keyboard: buttons },
    });
  };

  const resolveBotUsername = async (ctx) => {
    const fromCtx = String(ctx?.botInfo?.username || '').trim();
    if (fromCtx) return fromCtx;
    try {
      const me = await ctx.telegram.getMe();
      return String(me?.username || '').trim();
    } catch {
      return '';
    }
  };

  const sendReferralScreen = async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Команда доступна только в личном чате с ботом.');
      return;
    }
    const { user } = await ensureUserByTelegramId(
      ctx.chat?.id ?? ctx.from?.id,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? null,
      ctx.from?.last_name ?? null
    );
    if (!user) {
      await ctx.reply('Не удалось определить пользователя.');
      return;
    }
    const bonusOpens = Math.max(0, await getConfigInt(REFERRAL_BONUS_OPENS_CONFIG_KEY, 10));
    const invitedCount = models.Referrals
      ? await models.Referrals.count({ where: { ReferrerUserId: user.Id } })
      : 0;
    const botUsername = await resolveBotUsername(ctx);
    const referralLink = botUsername
      ? `https://t.me/${botUsername}?start=${encodeURIComponent(String(user.TelegramChatId || ''))}`
      : '';
    const shareUrl = referralLink
      ? `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Привет! Попробуй бот для поиска удаленной работы:')}`
      : '';
    const lines = [
      `Пригласите друга и получите +${bonusOpens} открытий вакансий.`,
      `Уже приглашено: ${invitedCount}`,
      '',
      referralLink || 'Реферальная ссылка временно недоступна.',
    ];
    const inlineKeyboard = shareUrl
      ? [[{ text: 'Поделиться ссылкой', url: shareUrl }]]
      : [];
    await ctx.reply(lines.join('\n'), {
      disable_web_page_preview: true,
      ...(inlineKeyboard.length > 0 ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
    });
  };

  const processReferralOnStart = async (ctx, invitedUser, startPayload) => {
    if (!invitedUser || !models.Referrals) return;
    const referrerTelegramChatId = parseStartReferralChatId(startPayload);
    if (!referrerTelegramChatId) return;
    if (Number(invitedUser.TelegramChatId) === Number(referrerTelegramChatId)) return;
    try {
      const referrer = await models.Users.findOne({ where: { TelegramChatId: referrerTelegramChatId } });
      if (!referrer || Number(referrer.Id) === Number(invitedUser.Id)) return;

      const [row, created] = await models.Referrals.findOrCreate({
        where: {
          ReferrerUserId: referrer.Id,
          ReferredUserId: invitedUser.Id,
        },
        defaults: {
          ReferrerUserId: referrer.Id,
          ReferredUserId: invitedUser.Id,
          ReferredAt: new Date(),
        },
      });
      if (!created || !row) return;

      const granted = await grantReferralBonusToReferrer(referrer.Id, invitedUser.Id);
      if (granted > 0) {
        await ctx.telegram.sendMessage(
          Number(referrer.TelegramChatId),
          `🎉 Ваш друг запустил бота по вашей ссылке. Начислено +${granted} открытий вакансий.`
        ).catch(() => { });
      }
    } catch (err) {
      console.warn('processReferralOnStart failed:', err?.message || err);
    }
  };

  const sendPlanInvoice = async (ctx, planCode) => {
    const plan = await getPlanByCode(planCode);
    if (!plan || Number(plan.PriceInStars || 0) < 1) {
      await ctx.reply('Этот тариф недоступен для оплаты.');
      return;
    }
    const payload = buildPlanInvoicePayload(plan);
    const monthlyOpens = Number(plan.JobOpenMonthlyLimit || 0);
    const hasAiTools = Boolean(plan.IncludesAiTools);
    const priceLabel = formatPlanPrice(plan.PriceInStars, plan.PriceUsd);
    const title = `${plan.Name} — ${monthlyOpens} открытий/мес — ${priceLabel}`;
    const description =
      `${plan.Name}: ${monthlyOpens} открытий вакансий в месяц на ${Number(plan.DurationDays || 30)} дней. ` +
      `${hasAiTools ? 'Включает инструменты AI CV и Cover Letter. ' : 'Инструменты AI CV и Cover Letter не включены. '}` +
      `Цена: ${priceLabel}. Оплата через Telegram Stars.`;
    try {
      await ctx.telegram.sendInvoice(ctx.chat.id, {
        title,
        description,
        payload,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: `${plan.Name} (${Number(plan.DurationDays || 30)} дней)`, amount: Number(plan.PriceInStars || 0) }],
      });
    } catch (err) {
      const msg = err?.response?.body?.description ?? err?.message ?? String(err);
      console.error('sendInvoice plan error:', msg);
      await ctx.reply(`Не удалось выставить счёт. Попробуйте позже.${msg ? ` (${msg})` : ''}`);
    }
  };

  const startHireAgentScenario = async (ctx) => {
    const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat;
    if (chat?.type !== 'private') {
      await ctx.reply('Этот сценарий доступен только в личном чате с ботом.');
      return;
    }
    if (ctx.callbackQuery) await withTypingTelegram(ctx.telegram, chat.id, 700);
    hireAgentStateByChatId.set(chat.id, { step: 'awaiting_cv' });
    await ctx.reply(
      'Отправьте резюме файлом (PDF или изображение) — я разберу его и начну работу.\n' +
      'Когда потребуются действия, я напишу.'
    );
  };

  const startPositionApplyScenario = async (ctx, positionId) => {
    const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat;
    if (chat?.type !== 'private') {
      await ctx.reply('Этот сценарий доступен только в личном чате с ботом.');
      return;
    }
    if (!models.Positions) {
      await ctx.reply('Сервис вакансий временно недоступен. Попробуйте позже.');
      return;
    }
    const position = await models.Positions.findByPk(positionId);
    if (!position || position.IsArchived) {
      await ctx.reply('Вакансия не найдена или уже архивирована.');
      return;
    }
    const website = String(position.CompanyWebsite || '').trim();
    const externalApplyUrl = String(position.ExternalApplyURL || '').trim();
    const companyName = String(position.CompanyName || '').trim();
    const externalApplyButtonText = companyName
      ? `Откликнуться на сайте ${companyName}`
      : 'Откликнуться на сайте работодателя';
    const openOtherJobsButton = canUseSeekerJobsWebApp
      ? { text: 'Открыть другие вакансии на 100% удалёнку', web_app: { url: seekerJobsUrl } }
      : { text: 'Открыть другие вакансии на 100% удалёнку', callback_data: 'start_open_jobsearch' };
    const lines = [
      `Вакансия: ${position.Title}`,
      `Компания: ${position.CompanyName}`,
      ...(website ? [`Сайт компании: ${website}`] : []),
      '',
      String(position.Description || '').trim(),
    ];
    if (externalApplyUrl) {
      await ctx.reply(lines.join('\n'), {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: externalApplyButtonText, url: externalApplyUrl }],
            [openOtherJobsButton],
          ],
        },
      });
      return;
    }
    lines.push('', '<b>Чтобы откликнуться, отправьте резюме файлом (PDF или изображение).</b>');
    hireAgentStateByChatId.set(chat.id, { step: 'awaiting_cv_for_position', positionId: position.Id });
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  };

  const tryRemoveLegacyKeyboard = async (ctx) => {
    const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat;
    if (chat?.type !== 'private') return;
    const chatId = chat?.id ?? ctx.from?.id;
    if (!chatId || legacyKeyboardClearedByChatId.has(chatId)) return;
    try {
      const cleanupMessage = await ctx.telegram.sendMessage(chatId, '\u2060', {
        reply_markup: { remove_keyboard: true },
      });
      if (cleanupMessage?.message_id) {
        await ctx.telegram.deleteMessage(chatId, cleanupMessage.message_id).catch(() => { });
      }
      legacyKeyboardClearedByChatId.add(chatId);
    } catch (err) {
      console.error('Failed to remove legacy keyboard:', err?.message || err);
    }
  };

  bot.use(async (ctx, next) => {
    await tryRemoveLegacyKeyboard(ctx);
    return next();
  });

  bot.use(async (ctx, next) => {
    try {
      const { user, wasCreated } = await ensureUser(ctx);
      ctx.state.isFirstTimeUser = wasCreated;
      if (wasCreated && user) {
        const totalUsers = await models.Users.count();
        const message = [
          '🔔 Новый пользователь присоединился!',
          `Имя: ${formatUserDisplayName(user)}`,
          `Username: ${formatUsername(user.TelegramUserName, { withAt: true })}`,
          `ChatId: ${user.TelegramChatId}`,
          `Всего пользователей: ${totalUsers}`,
        ].join('\n');
        await notifyAdmins(
          ctx,
          message,
          'Failed to send new-user admin notification:',
          { telegramChatId: user.TelegramChatId }
        );
      }
    } catch (err) {
      console.error('ensureUser error:', err);
    }
    return next();
  });

  // Show "typing..." for all slash commands.
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    if (ctx.chat?.id && typeof text === 'string' && text.trim().startsWith('/')) {
      await withTypingTelegram(ctx.telegram, ctx.chat.id, 700);
    }
    return next();
  });

  bot.start(async (ctx) => {
    const payload = parseStartPayload(ctx);
    const positionIdFromStart = parseStartPositionId(payload);
    const canProceedToVacancies = await enforceStartRequiredChannelsGate(ctx);
    if (!canProceedToVacancies) return;
    if (positionIdFromStart) {
      await startPositionApplyScenario(ctx, positionIdFromStart);
      return;
    }
    if (payload === 'jobsearch') {
      await openJobSearchFromBot(ctx);
      return;
    }
    if (payload.startsWith('buy_')) {
      const requestedCode = payload.replace(/^buy_/, '').trim().toLowerCase();
      if (requestedCode) {
        await sendPlanInvoice(ctx, requestedCode);
        return;
      }
    }
    if (payload === 'referrals') {
      await sendReferralScreen(ctx);
      return;
    }
    const { user: invitedUser } = await ensureUserByTelegramId(
      ctx.chat?.id ?? ctx.from?.id,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? null,
      ctx.from?.last_name ?? null
    );
    await processReferralOnStart(ctx, invitedUser, payload);
    await sendStartIntro(ctx);
  });

  bot.action(START_REQUIRED_CHANNEL_CONFIRM_CALLBACK, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    const telegramUserId = Number(ctx.from?.id || ctx.chat?.id || 0);
    if (!telegramUserId) {
      await ctx.reply('Не удалось определить пользователя. Откройте /start еще раз.');
      return;
    }
    const channelsState = await getRequiredChannelsState(telegramUserId);
    if (!channelsState.ok) {
      await sendStartRequiredChannelsGate(ctx, channelsState.channels);
      return;
    }
    await ensureRequiredChannelUserRecords(telegramUserId);
    let grantedBonus = 0;
    try {
      const { user } = await ensureUserByTelegramId(
        telegramUserId,
        ctx.from?.username ?? null,
        ctx.from?.first_name ?? null,
        ctx.from?.last_name ?? null
      );
      grantedBonus = await ensureChannelSubscribeBonus(user?.Id);
    } catch (err) {
      console.warn('Failed to grant start subscription bonus:', err?.message || err);
    }
    const successLines = [
      'Спасибо! Подписка подтверждена.',
      grantedBonus > 0 ? `Начислено +${grantedBonus} открытий вакансий.` : 'Доступ к вакансиям открыт.',
    ];
    if (existsSync(subscribedImagePath)) {
      await ctx.replyWithPhoto({ source: subscribedImagePath }, { caption: successLines.join('\n') });
    } else {
      await ctx.reply(successLines.join('\n'));
    }
    await sendStartIntro(ctx);
  });

  const openJobSearchFromBot = async (ctx) => {
    if (canUseSeekerJobsWebApp) {
      await ctx.reply(
        'Ищите удаленные вакансии, отмечайте релевантные роли и открывайте детали прямо в мини-приложении.',
        {
          reply_markup: {
            inline_keyboard: [[{ text: 'Open job search', web_app: { url: seekerJobsUrl } }]],
          },
        }
      );
      return;
    }
    await ctx.reply('Job search page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  };

  bot.command('jobsearch', async (ctx) => {
    await openJobSearchFromBot(ctx);
  });

  bot.action('start_open_jobsearch', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    await openJobSearchFromBot(ctx);
  });

  bot.command('plans', async (ctx) => {
    await sendPlansIntro(ctx);
  });

  bot.action('plan_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    await sendPlanMenu(ctx);
  });

  bot.action('plan_pricing', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    await sendPlanMenu(ctx);
  });

  bot.action(/^plan_buy_(.+)$/i, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    const code = String(ctx.match?.[1] || '').trim().toLowerCase();
    if (!code) {
      await ctx.reply('Не удалось определить тариф для оплаты.');
      return;
    }
    await sendPlanInvoice(ctx, code);
  });

  bot.command('applications', async (ctx) => {
    if (canUseApplicationsWebApp) {
      await ctx.reply('Мои отклики', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Applications', web_app: { url: applicationsUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Applications page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  });

  bot.command('hireagent', async (ctx) => {
    await startHireAgentScenario(ctx);
  });

  bot.command('cvscore', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Эта команда доступна только в личном чате с ботом.');
      return;
    }
    const chatId = ctx.chat.id;
    hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv_review' });
    await ctx.reply(
      'Отправьте ваше резюме файлом (PDF/TXT).\n' +
      'Я оценю CV как HR-эксперт, дам комментарии и верну улучшенную ATS-friendly версию.'
    );
  });

  bot.action('start_hireagent', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    await startHireAgentScenario(ctx);
  });

  bot.action('start_hireagent_info', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (chatId) await withTypingTelegram(ctx.telegram, chatId, 700);
    await ctx.reply(ABOUT_MESSAGE, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Отправить резюме и попробовать', callback_data: 'start_hireagent' }]],
      },
    });
  });

  bot.action('hireagent_yes', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    if (!hireAgentSimulationVisible) {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { });
      await ctx.reply('Симуляция откликов сейчас отключена. Мы сообщим вам по результатам проверки резюме.');
      return;
    }
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) return;
    const st = hireAgentStateByChatId.get(chatId);
    if (st?.step !== 'awaiting_confirm') {
      await ctx.reply('Сначала пройдите шаг с резюме в диалоге с агентом (/hireagent).');
      return;
    }
    hireAgentStateByChatId.set(chatId, { step: 'applying' });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { });
    await runHireAgentFakeApplying(ctx, chatId, hireAgentStateByChatId);
  });

  bot.action('hireagent_no', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      /* ignore */
    }
    if (!hireAgentSimulationVisible) {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { });
      return;
    }
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) return;
    const st = hireAgentStateByChatId.get(chatId);
    if (st?.step !== 'awaiting_confirm') return;
    hireAgentStateByChatId.set(chatId, { step: 'idle' });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { });
    await ctx.reply('Хорошо. Когда будете готовы — снова выберите «Делегировать отклики» в меню.');
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
    const isHireAgentCvFlow = st?.step === 'awaiting_cv';
    const isPositionCvFlow = st?.step === 'awaiting_cv_for_position';
    const isCvReviewFlow = st?.step === 'awaiting_cv_review';
    if (!isHireAgentCvFlow && !isPositionCvFlow && !isCvReviewFlow) return next();
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

      const { user } = await ensureUserByTelegramId(
        chatId,
        ctx.from?.username ?? null,
        ctx.from?.first_name ?? null,
        ctx.from?.last_name ?? null
      );
      await user.update({ ResumeURL: resumeUrl });
      runResumeEnrichmentInBackground({ userId: user.Id, resumeUrl, includeSkills: true });
      const totalWithResume = await models.Users.count({
        where: {
          ResumeURL: {
            [Sequelize.Op.ne]: null,
          },
        },
      });
      const resumeUploadMessage = [
        '📄 CV Пользователь загрузил резюме',
        `Имя: ${formatUserDisplayName(user)}`,
        `Username: ${formatUsername(user.TelegramUserName, { withAt: false })}`,
        `ChatId: ${user.TelegramChatId}`,
        `Всего пользователей загрузило: ${totalWithResume}`,
        `URL: ${resumeUrl}`,
      ].join('\n');
      await notifyAdmins(
        ctx,
        resumeUploadMessage,
        'Failed to send CV upload admin notification:',
        { telegramChatId: user.TelegramChatId }
      );

      await withTypingTelegram(ctx.telegram, chatId, 800 + Math.floor(Math.random() * 400));
      if (isCvReviewFlow) {
        const mime = String(resumeSource.mimeType || '').toLowerCase();
        const canExtractText =
          mime.includes('pdf') ||
          mime.includes('text/') ||
          String(resumeSource.fileName || '').toLowerCase().endsWith('.pdf') ||
          String(resumeSource.fileName || '').toLowerCase().endsWith('.txt');
        if (!canExtractText) {
          hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv_review' });
          await ctx.reply('Для CV score сейчас поддерживаются PDF/TXT файлы. Пожалуйста, отправьте резюме в PDF.');
          return;
        }
        await ctx.reply('Провожу HR-анализ и улучшаю структуру резюме…');
        let resumeText = '';
        const review = await runWithTyping(ctx.telegram, chatId, async () => {
          resumeText = await extractResumeTextFromUrl(resumeUrl);
          return reviewResumeWithAI({ resumeText });
        });
        const cvScoreResult = {
          name: `${ctx.from?.first_name || ''} ${ctx.from?.last_name || ''}`.trim() || 'Candidate',
          title: 'Resume Review',
          ats_score: review.score,
          grade:
            review.score >= 90 ? 'A+'
              : review.score >= 80 ? 'A'
                : review.score >= 70 ? 'B'
                  : review.score >= 60 ? 'C'
                    : review.score >= 50 ? 'D'
                      : 'F',
          summary: review.summary,
          categories: [
            {
              name: 'ATS & Keywords',
              score: review.score,
              max: 100,
              feedback: review.improvements[0] || 'Improve keyword relevance and role-specific terms.',
            },
            {
              name: 'Structure & Clarity',
              score: review.score,
              max: 100,
              feedback: review.improvements[1] || 'Keep sections concise with measurable outcomes.',
            },
          ],
          strengths: review.strengths,
          critical_fixes: review.improvements,
          roast: review.summary,
        };
        cvScoreResultByUserId.set(String(chatId), cvScoreResult);
        if (canUseCvScoreWebApp) {
          await ctx.reply('Открыть полный отчет CV Score:', {
            reply_markup: {
              inline_keyboard: [[{ text: '📊 Открыть полный отчет по анализу резюме', web_app: { url: `${cvScoreUrl}?uid=${chatId}` } }]],
            },
          });
        }
        const enhancedCvRes = await fetch('https://tailered-cv.onrender.com/generate-from-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeText, review }),
        });
        if (!enhancedCvRes.ok) {
          const errBody = await enhancedCvRes.json().catch(() => ({}));
          throw new Error(errBody.error || 'Failed to generate enhanced CV');
        }
        const { url: enhancedCvUrl } = await enhancedCvRes.json();
        await ctx.reply('Готово! Вот ваша улучшенная ATS-friendly версия резюме:', {
          reply_markup: {
            inline_keyboard: [[{ text: '⬇ Скачать улучшенное резюме', url: enhancedCvUrl }]],
          },
        });
        hireAgentStateByChatId.set(chatId, { step: 'idle' });
      } else if (isPositionCvFlow) {
        const positionId = String(st?.positionId || '').trim();
        if (positionId && models.UserApplications) {
          await models.UserApplications.create({
            UserId: user.Id,
            PositionId: positionId,
            DateTime: Sequelize.literal('GETUTCDATE()'),
          });
        }
        hireAgentStateByChatId.set(chatId, { step: 'idle' });
        if (canUseSeekerJobsWebApp) {
          await ctx.reply(
            'Резюме принято. Спасибо за отклик! Пока мы обрабатываем вашу заявку, вы можете посмотреть другие доступные вакансии.',
            {
              reply_markup: {
                inline_keyboard: [[{ text: 'Открыть поиск вакансий', web_app: { url: seekerJobsUrl } }]],
              },
            }
          );
        } else {
          await ctx.reply(
            'Резюме принято. Спасибо за отклик! Пока мы обрабатываем вашу заявку, вы можете посмотреть другие доступные вакансии.'
          );
        }
      } else if (hireAgentSimulationVisible) {
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
      } else {
        hireAgentStateByChatId.set(chatId, { step: 'idle' });
        await ctx.reply('Резюме принято. Мы передали его на проверку — свяжемся с вами с обратной связью.');
      }
    } catch (err) {
      console.error('hireagent resume upload failed:', err);
      if (isCvReviewFlow) {
        await ctx.reply('Не удалось обработать резюме для CV score. Попробуйте еще раз через минуту.');
        hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv_review' });
      } else {
        await ctx.reply(
          'Не удалось сохранить резюме. Проверьте настройки Azure Storage (AZURE_STORAGE_CONNECTION_STRING) и попробуйте снова.'
        );
        hireAgentStateByChatId.set(chatId, { step: 'awaiting_cv' });
      }
    }
  });

  bot.command('profile', async (ctx) => {
    if (canUseProfileWebApp) {
      await ctx.reply('Открыть настройки:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Настройки', web_app: { url: profileUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Страница настроек требует публичный HTTPS WEBHOOK_URL/ADMIN_APP_URL (не localhost).');
  });

  bot.command('about', async (ctx) => {
    await ctx.reply(ABOUT_MESSAGE);
  });

  bot.command('companies', async (ctx) => {
    const canProceedToCompanies = await enforceStartRequiredChannelsGate(ctx);
    if (!canProceedToCompanies) return;
    if (canUseCompaniesWebApp) {
      await ctx.reply('Открыть компании с удалёнкой:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Компании с удалёнкой', web_app: { url: companiesUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Страница компаний требует публичный HTTPS WEBHOOK_URL/ADMIN_APP_URL (не localhost).');
  });

  bot.command('news', async (ctx) => {
    await ctx.reply(
      'Получайте последние новости про удалённую жизнь, релокацию и общение с единомышленниками.\n\n' +
      'Сообщество Digital nomads. Work from anywhere:',
      {
      reply_markup: {
        inline_keyboard: [[{ text: 'Ознакомиться', url: DIGITAL_NOMADS_CHANNEL_URL }]],
      },
      }
    );
  });

  bot.command('referrals', async (ctx) => {
    await sendReferralScreen(ctx);
  });

  bot.command('admin', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Admin panel is available only in private chat.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size > 0 && (!ctx.from?.id || !adminIds.has(ctx.from.id))) {
      await ctx.reply('Unauthorized.');
      return;
    }
    if (canUseAdminWebApp) {
      await ctx.reply('Open admin panel:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Admin Panel', web_app: { url: adminUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Admin page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  });

  const openAdminCompanies = async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Admin companies page is available only in private chat.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size > 0 && (!ctx.from?.id || !adminIds.has(ctx.from.id))) {
      await ctx.reply('Unauthorized.');
      return;
    }
    if (canUseAdminCompaniesWebApp) {
      await ctx.reply('Open admin companies:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Admin Companies', web_app: { url: adminCompaniesUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Admin companies page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  };

  bot.command('admin_companies', async (ctx) => {
    await openAdminCompanies(ctx);
  });

  bot.hears(/^\/admin-companies(?:@\w+)?$/, async (ctx) => {
    await openAdminCompanies(ctx);
  });

  const openAdminPositions = async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Admin positions page is available only in private chat.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size > 0 && (!ctx.from?.id || !adminIds.has(ctx.from.id))) {
      await ctx.reply('Unauthorized.');
      return;
    }
    if (canUseAdminPositionsWebApp) {
      await ctx.reply('Open admin positions:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Admin Positions', web_app: { url: adminPositionsUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Admin positions page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  };

  bot.command('admin_positions', async (ctx) => {
    await openAdminPositions(ctx);
  });

  bot.hears(/^\/admin-positions(?:@\w+)?$/, async (ctx) => {
    await openAdminPositions(ctx);
  });

  const openAdminNotifications = async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Admin notifications page is available only in private chat.');
      return;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size > 0 && (!ctx.from?.id || !adminIds.has(ctx.from.id))) {
      await ctx.reply('Unauthorized.');
      return;
    }
    if (canUseAdminNotificationsWebApp) {
      await ctx.reply('Open admin notifications:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Admin Notifications', web_app: { url: adminNotificationsUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Admin notifications page requires public HTTPS WEBHOOK_URL/ADMIN_APP_URL (not localhost).');
  };

  bot.command('admin_notifications', async (ctx) => {
    await openAdminNotifications(ctx);
  });

  bot.hears(/^\/admin-notifications(?:@\w+)?$/, async (ctx) => {
    await openAdminNotifications(ctx);
  });

  bot.command('stat', async (ctx) => {
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
    await ctx.reply('Открыть статистику импорта вакансий:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть статистику', url: 'https://anyhires.com/JobStat?period=1' }]],
      },
    });
  });

  const ensurePrivateAdminForHiddenCommand = async (ctx, commandName = 'This command') => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply(`${commandName} only works in a private chat with the bot.`);
      return false;
    }
    const adminIds = config.botAdminTelegramIds;
    if (adminIds.size === 0) {
      await ctx.reply('This command is disabled. Set BOT_ADMIN_TELEGRAM_IDS in the server environment.');
      return false;
    }
    const fromId = ctx.from?.id;
    if (!fromId || !adminIds.has(fromId)) {
      await ctx.reply('Unauthorized.');
      return false;
    }
    return true;
  };

  const parsePeriodDays = (raw, fallback = 7) => {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(365, parsed);
  };

  bot.command('stat2', async (ctx) => {
    const ok = await ensurePrivateAdminForHiddenCommand(ctx, 'This command');
    if (!ok) return;
    const text = String(ctx.message?.text || '').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const periodDays = parsePeriodDays(parts[1], 7);
    const stat2PageUrl = stat2Url ? `${stat2Url}?period=${encodeURIComponent(periodDays)}` : '';
    if (!stat2PageUrl) {
      await ctx.reply('Stat2 page URL is not configured.');
      return;
    }
    if (canUseStat2WebApp) {
      await ctx.reply('Open Stat2 dashboard:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Open Stat2', web_app: { url: stat2PageUrl } }]],
        },
      });
      return;
    }
    await ctx.reply('Open Stat2 dashboard:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Open Stat2', url: stat2PageUrl }]],
      },
    });
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

  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message?.successful_payment;
    if (!payment) return;
    const telegramPaymentChargeId = String(payment.telegram_payment_charge_id || '').trim();
    if (!telegramPaymentChargeId) {
      console.error('successful_payment without telegram_payment_charge_id');
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(String(payment.invoice_payload || '{}'));
    } catch {
      console.error('successful_payment invalid invoice_payload:', payment.invoice_payload);
      return;
    }
    if (String(payload.type || '') !== 'monthly_plan') {
      console.warn('successful_payment unknown payload type:', payload);
      return;
    }
    const planCode = String(payload.code || '').trim().toLowerCase();
    const plan = await getPlanByCode(planCode);
    if (!plan) {
      await ctx.reply('Оплата получена, но тариф не найден. Напишите в поддержку.');
      return;
    }

    try {
      const existing = models.TelegramPayments
        ? await models.TelegramPayments.findOne({ where: { TelegramPaymentChargeId: telegramPaymentChargeId } })
        : null;
      if (existing) {
        await ctx.reply('Оплата уже была зачислена ранее. Подписка активна.');
        return;
      }

      const { user } = await ensureUserByTelegramId(
        ctx.chat?.id,
        ctx.from?.username ?? null,
        ctx.from?.first_name ?? null,
        ctx.from?.last_name ?? null
      );
      if (!user) {
        await ctx.reply('Не удалось определить пользователя для зачисления подписки.');
        return;
      }

      const paidAt = new Date();
      let telegramPaymentRow = null;
      if (models.TelegramPayments) {
        telegramPaymentRow = await models.TelegramPayments.create({
          UserId: user.Id,
          PlanId: Number(plan.Id),
          TelegramPaymentChargeId: telegramPaymentChargeId,
          ProviderPaymentChargeId: payment.provider_payment_charge_id || null,
          InvoicePayload: String(payment.invoice_payload || ''),
          StarsAmount: Number(payment.total_amount || 0),
          Currency: String(payment.currency || 'XTR'),
          Status: 'completed',
          PaidAt: paidAt,
        });
      }

      if (!models.UserSubscriptions) {
        await ctx.reply('Оплата получена, но таблица подписок недоступна. Напишите в поддержку.');
        return;
      }

      const currentActive = await getActiveSubscriptionForUser(user.Id, paidAt);
      const startsAt = currentActive ? new Date(currentActive.EndsAt) : paidAt;
      const endsAt = new Date(startsAt.getTime() + Math.max(1, Number(plan.DurationDays || 30)) * 24 * 60 * 60 * 1000);
      await models.UserSubscriptions.create({
        UserId: user.Id,
        PlanId: Number(plan.Id),
        TelegramPaymentId: telegramPaymentRow?.Id ?? null,
        StartsAt: startsAt,
        EndsAt: endsAt,
        Status: 'active',
        CreatedAt: paidAt,
      });

      const until = endsAt.toISOString().slice(0, 10);
      await ctx.reply(`✅ Оплата получена. Подписка ${plan.Name} активна до ${until}.`);
    } catch (err) {
      console.error('successful_payment processing failed:', err);
      await ctx.reply('Оплата получена, но автозачисление не завершилось. Напишите в поддержку.');
    }
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

  app.use(createStaticRouter());
  app.use(createResumeRouter());
  app.use(createProfileRouter());
  app.use(createMonetizationRouter());
  app.use(createAnalyticsRouter());
  app.use(createApplicationsRouter());
  app.use(createCompaniesRouter());
  app.use(createPositionsRouter());
  app.use(createAdminRouter());
  app.use(createNotificationsRouter());

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
    runtimeBot.username = me?.username || '';
    runtimeBot.telegram = bot.telegram;
    console.log('Telegram OK.', runtimeBot.username ? `@${runtimeBot.username}` : '(username not set)');
  } catch (err) {
    console.error('Cannot reach Telegram:', err.message);
    return;
  }

  const appBaseUrl = (process.env.ADMIN_APP_URL || config.webhookUrl || '').replace(/\/$/, '');
  const hireAgentSimulationVisible = await ensureHireAgentSimulationVisibleConfig();
  registerHandlers(bot, appBaseUrl, { hireAgentSimulationVisible });

  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Вакансии на удалёнку' },
      { command: 'cvscore', description: 'Проверка и улучшение резюме' },
      { command: 'companies', description: 'Компании с удалёнкой' },
      { command: 'referrals', description: 'Реферальная программа' },
      { command: 'news', description: 'Новости про релокацию, удалёнку и ИИ' },
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
