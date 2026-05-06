export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTypingTelegram(telegram, chatId, ms) {
  const pulse = () => telegram.sendChatAction(chatId, 'typing').catch(() => {});
  pulse();
  const id = setInterval(pulse, 4000);
  try {
    await sleep(ms);
  } finally {
    clearInterval(id);
  }
}

export async function runWithTyping(telegram, chatId, work) {
  const pulse = () => telegram.sendChatAction(chatId, 'typing').catch(() => {});
  pulse();
  const id = setInterval(pulse, 4000);
  try {
    return await work();
  } finally {
    clearInterval(id);
  }
}

export async function sendLongTelegramText(telegram, chatId, text, chunkSize = 3500) {
  const value = String(text || '').trim();
  if (!value) return;
  if (value.length <= chunkSize) {
    await telegram.sendMessage(chatId, value);
    return;
  }
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + chunkSize, value.length);
    if (end < value.length) {
      const slice = value.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
      if (lastBreak > Math.floor(chunkSize * 0.5)) {
        end = start + lastBreak + 1;
      }
    }
    const part = value.slice(start, end).trim();
    if (part) await telegram.sendMessage(chatId, part);
    start = end;
  }
}

export function parseConfigBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function parseConfigInt(value, fallback = 0) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n)) return fallback;
  return n;
}

export function normalizePriceUsd(value) {
  const n = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function formatUsd(amount) {
  const normalized = normalizePriceUsd(amount);
  if (!normalized) return '';
  return `$${normalized.toFixed(2)}`;
}

export function formatPlanPrice(stars, usd) {
  const starsAmount = Number(stars || 0);
  const usdText = formatUsd(usd);
  return usdText ? `${starsAmount} ⭐ (~${usdText})` : `${starsAmount} ⭐`;
}

export function normalizeChatId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  return s;
}

export function formatUserDisplayName(user) {
  const fullName = [user?.FirstName, user?.LastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  return fullName || 'Не указано';
}

export function formatUsername(raw, { withAt = true } = {}) {
  const usernameRaw = String(raw || '').trim();
  if (!usernameRaw) return 'нет';
  if (!withAt) return usernameRaw.replace(/^@/, '');
  return usernameRaw.startsWith('@') ? usernameRaw : `@${usernameRaw}`;
}

export const HIRE_AGENT_FAKE_QUEUE = [
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

export function formatHireAgentFullList(doneThroughIndex) {
  return HIRE_AGENT_FAKE_QUEUE.map((p, j) => {
    const mark = j <= doneThroughIndex ? '✅' : '⬜';
    return `${mark} ${p.role} · ${p.company}`;
  }).join('\n');
}

export async function runHireAgentFakeApplying(ctx, chatId, hireAgentStateByChatId) {
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
