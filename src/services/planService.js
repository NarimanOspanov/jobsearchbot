import { Sequelize } from 'sequelize';
import { models } from '../db.js';
import { parseConfigInt, normalizePriceUsd, formatUsd, formatPlanPrice } from '../utils/helpers.js';

const JOB_DETAILS_SUBSCRIBE_GATE_CONFIG_KEY = 'JobDetailsOpensBeforeSubscribeGate';
const FREE_JOB_OPENS_MONTHLY_LIMIT_CONFIG_KEY = 'FreeJobOpensMonthlyLimit';
const CHANNEL_SUBSCRIBE_BONUS_OPENS_CONFIG_KEY = 'ChannelSubscribeBonusOpens';
const REFERRAL_BONUS_OPENS_CONFIG_KEY = 'ReferralBonusOpens';

const FALLBACK_PLANS = [
  {
    Id: 1,
    Code: 'silver',
    Name: 'Silver',
    PriceInStars: 500,
    PriceUsd: 10,
    DurationDays: 30,
    JobOpenMonthlyLimit: 300,
    IncludesAiTools: false,
    IsActive: true,
    SortOrder: 10,
  },
  {
    Id: 2,
    Code: 'gold',
    Name: 'Gold',
    PriceInStars: 1000,
    PriceUsd: 20,
    DurationDays: 30,
    JobOpenMonthlyLimit: 1000,
    IncludesAiTools: true,
    IsActive: true,
    SortOrder: 20,
  },
];

export async function getConfigInt(key, fallback = 0) {
  const safeFallback = Number.isSafeInteger(fallback) ? fallback : 0;
  if (!models.Configs) return safeFallback;
  try {
    const row = await models.Configs.findOne({ where: { Key: key } });
    if (!row) return safeFallback;
    return parseConfigInt(row.Value, safeFallback);
  } catch (err) {
    console.error(`Failed to read Configs.${key}; fallback=${safeFallback}:`, err?.message || err);
    return safeFallback;
  }
}

export async function getJobDetailsSubscribeGateN() {
  return Math.max(0, await getConfigInt(JOB_DETAILS_SUBSCRIBE_GATE_CONFIG_KEY, 0));
}

export function getMonthBoundsUtc(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

export function toPlanSummary(plan) {
  if (!plan) return null;
  const monthlyOpens = Number(plan.JobOpenMonthlyLimit || 0);
  const durationDays = Number(plan.DurationDays || 30);
  const includesAiTools = Boolean(plan.IncludesAiTools);
  const priceUsd = normalizePriceUsd(plan.PriceUsd);
  return {
    id: Number(plan.Id || 0),
    code: String(plan.Code || '').toLowerCase(),
    name: String(plan.Name || ''),
    priceInStars: Number(plan.PriceInStars || 0),
    priceUsd,
    durationDays,
    jobOpenMonthlyLimit: monthlyOpens,
    includesAiTools,
    description:
      `${monthlyOpens} открытий вакансий в месяц на ${durationDays} дней. ` +
      `${formatPlanPrice(plan.PriceInStars, priceUsd)}. ` +
      `${includesAiTools ? 'Включает AI CV + Cover Letter.' : 'AI CV + Cover Letter не включены.'}`,
    sortOrder: Number(plan.SortOrder || 0),
  };
}

export function buildPlanInvoicePayload(plan) {
  return JSON.stringify({
    type: 'monthly_plan',
    planId: Number(plan.Id),
    code: String(plan.Code || '').toLowerCase(),
    version: 1,
  });
}

export async function getActivePlans() {
  if (!models.Plans) return FALLBACK_PLANS.map((plan) => ({ ...plan }));
  try {
    const rows = await models.Plans.findAll({
      where: { IsActive: true },
      order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
    });
    if (!rows || rows.length === 0) return FALLBACK_PLANS.map((plan) => ({ ...plan }));
    return rows.map((row) => row.get({ plain: true }));
  } catch (err) {
    console.warn('Failed to load Plans, using fallback:', err?.message || err);
    return FALLBACK_PLANS.map((plan) => ({ ...plan }));
  }
}

export async function getPlanByCode(planCode) {
  const normalized = String(planCode || '').trim().toLowerCase();
  if (!normalized) return null;
  const plans = await getActivePlans();
  return plans.find((plan) => String(plan.Code || '').trim().toLowerCase() === normalized) || null;
}

export async function getPlanById(planId) {
  const id = Number.parseInt(String(planId), 10);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const plans = await getActivePlans();
  return plans.find((plan) => Number(plan.Id) === id) || null;
}

export async function getActiveSubscriptionForUser(userId, now = new Date()) {
  if (!models.UserSubscriptions || !userId) return null;
  try {
    const row = await models.UserSubscriptions.findOne({
      where: {
        UserId: userId,
        Status: 'active',
        StartsAt: { [Sequelize.Op.lte]: now },
        EndsAt: { [Sequelize.Op.gt]: now },
      },
      order: [['EndsAt', 'DESC'], ['Id', 'DESC']],
    });
    return row || null;
  } catch (err) {
    console.warn('Failed to load active UserSubscription:', err?.message || err);
    return null;
  }
}

export async function getUserBonusOpensTotal(userId) {
  if (!models.UserBonusOpens || !userId) return 0;
  try {
    const rows = await models.UserBonusOpens.findAll({
      where: { UserId: userId },
      attributes: ['OpensGranted'],
    });
    return rows.reduce((acc, row) => acc + Math.max(0, Number(row.OpensGranted || 0)), 0);
  } catch (err) {
    console.warn('Failed to load UserBonusOpens:', err?.message || err);
    return 0;
  }
}

export async function ensureChannelSubscribeBonus(userId) {
  if (!models.UserBonusOpens || !userId) return 0;
  const bonusOpens = Math.max(0, await getConfigInt(CHANNEL_SUBSCRIBE_BONUS_OPENS_CONFIG_KEY, 20));
  if (bonusOpens <= 0) return 0;
  try {
    const [row, created] = await models.UserBonusOpens.findOrCreate({
      where: { UserId: userId, Source: 'required_channels_join', Note: 'auto-bonus-v1' },
      defaults: {
        UserId: userId,
        Source: 'required_channels_join',
        OpensGranted: bonusOpens,
        Note: 'auto-bonus-v1',
        CreatedAt: new Date(),
      },
    });
    return created ? Number(row.OpensGranted || 0) : 0;
  } catch (err) {
    console.warn('Failed to grant channel subscribe bonus:', err?.message || err);
    return 0;
  }
}

export async function grantReferralBonusToReferrer(referrerUserId, referredUserId) {
  if (!models.UserBonusOpens || !referrerUserId || !referredUserId) return 0;
  const bonusOpens = Math.max(0, await getConfigInt(REFERRAL_BONUS_OPENS_CONFIG_KEY, 10));
  if (bonusOpens <= 0) return 0;
  try {
    const note = `referred-user-${referredUserId}`;
    const [row, created] = await models.UserBonusOpens.findOrCreate({
      where: { UserId: referrerUserId, Source: 'referral_invite', Note: note },
      defaults: {
        UserId: referrerUserId,
        Source: 'referral_invite',
        OpensGranted: bonusOpens,
        Note: note,
        CreatedAt: new Date(),
      },
    });
    return created ? Number(row.OpensGranted || 0) : 0;
  } catch (err) {
    console.warn('Failed to grant referral bonus:', err?.message || err);
    return 0;
  }
}

export async function getUserMonthlyOpenUsage(userId, now = new Date()) {
  if (!models.JobDetailsOpens || !userId) return 0;
  const { start, end } = getMonthBoundsUtc(now);
  try {
    const opens = await models.JobDetailsOpens.count({
      where: {
        UserId: userId,
        CreatedAt: { [Sequelize.Op.gte]: start, [Sequelize.Op.lt]: end },
      },
    });
    return Math.max(0, opens);
  } catch (err) {
    console.warn('Failed to count monthly JobDetailsOpens:', err?.message || err);
    return 0;
  }
}

export async function getUserEntitlement(userId, now = new Date()) {
  const [activeSubscription, freeLimitRaw, bonusTotal, plans] = await Promise.all([
    getActiveSubscriptionForUser(userId, now),
    getConfigInt(FREE_JOB_OPENS_MONTHLY_LIMIT_CONFIG_KEY, 100),
    getUserBonusOpensTotal(userId),
    getActivePlans(),
  ]);
  const freeMonthlyLimit = Math.max(0, freeLimitRaw);
  const subscriptionPlan = activeSubscription
    ? plans.find((plan) => Number(plan.Id) === Number(activeSubscription.PlanId)) || null
    : null;
  const monthlyLimit = subscriptionPlan
    ? Math.max(0, Number(subscriptionPlan.JobOpenMonthlyLimit || 0))
    : freeMonthlyLimit;
  const usedThisMonth = await getUserMonthlyOpenUsage(userId, now);
  const totalAllowance = monthlyLimit + Math.max(0, bonusTotal);
  const remainingOpens = Math.max(0, totalAllowance - usedThisMonth);
  return {
    activeSubscription,
    subscriptionPlan,
    freeMonthlyLimit,
    bonusOpensTotal: Math.max(0, bonusTotal),
    usedThisMonth,
    monthlyLimit,
    totalAllowance,
    remainingOpens,
  };
}

export async function canUseAiToolsForUser(userId, now = new Date()) {
  const entitlement = await getUserEntitlement(userId, now);
  if (Number(entitlement?.remainingOpens || 0) > 0) return true;
  const activeSub = entitlement?.activeSubscription || null;
  if (!activeSub) return false;
  const plan = await getPlanById(activeSub.PlanId);
  return Boolean(plan?.IncludesAiTools);
}

export async function buildMonetizationStatus(userId, now = new Date()) {
  const [entitlement, activePlans] = await Promise.all([getUserEntitlement(userId, now), getActivePlans()]);
  const planSummary = toPlanSummary(entitlement.subscriptionPlan);
  const plans = activePlans
    .filter((plan) => Boolean(plan?.IsActive))
    .sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0))
    .map((plan) => toPlanSummary(plan));
  return {
    activePlan: planSummary,
    subscriptionEndsAt: entitlement.activeSubscription?.EndsAt || null,
    usedThisMonth: entitlement.usedThisMonth,
    monthlyLimit: entitlement.monthlyLimit,
    bonusOpensTotal: entitlement.bonusOpensTotal,
    totalAllowance: entitlement.totalAllowance,
    remainingOpens: entitlement.remainingOpens,
    canUseAiTools: Boolean(planSummary?.includesAiTools) || Number(entitlement?.remainingOpens || 0) > 0,
    freeMonthlyLimit: entitlement.freeMonthlyLimit,
    plans,
  };
}
