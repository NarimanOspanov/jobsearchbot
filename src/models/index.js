import defineUser from './User.js';
import defineApplication from './Application.js';
import defineRemoteCompany from './RemoteCompany.js';
import defineConfig from './Config.js';
import defineSearchClick from './SearchClick.js';
import defineJobDetailsOpen from './JobDetailsOpen.js';
import defineRequiredChannel from './RequiredChannel.js';
import defineRequiredChannelUser from './RequiredChannelUser.js';
import definePlan from './Plan.js';
import defineTelegramPayment from './TelegramPayment.js';
import defineUserSubscription from './UserSubscription.js';
import defineUserBonusOpen from './UserBonusOpen.js';
import defineReferral from './Referral.js';

/**
 * Initialize only the User model for empty bot runtime.
 */
export function initModels(sequelize) {
  const User = defineUser(sequelize);
  const Application = defineApplication(sequelize);
  const RemoteCompany = defineRemoteCompany(sequelize);
  const Config = defineConfig(sequelize);
  const SearchClick = defineSearchClick(sequelize);
  const JobDetailsOpen = defineJobDetailsOpen(sequelize);
  const RequiredChannel = defineRequiredChannel(sequelize);
  const RequiredChannelUser = defineRequiredChannelUser(sequelize);
  const Plan = definePlan(sequelize);
  const TelegramPayment = defineTelegramPayment(sequelize);
  const UserSubscription = defineUserSubscription(sequelize);
  const UserBonusOpen = defineUserBonusOpen(sequelize);
  const Referral = defineReferral(sequelize);

  User.hasMany(Application, { foreignKey: 'UserId' });
  Application.belongsTo(User, { foreignKey: 'UserId' });
  User.hasMany(SearchClick, { foreignKey: 'UserId' });
  SearchClick.belongsTo(User, { foreignKey: 'UserId' });
  User.hasMany(JobDetailsOpen, { foreignKey: 'UserId' });
  JobDetailsOpen.belongsTo(User, { foreignKey: 'UserId' });
  User.hasMany(TelegramPayment, { foreignKey: 'UserId' });
  TelegramPayment.belongsTo(User, { foreignKey: 'UserId' });
  Plan.hasMany(TelegramPayment, { foreignKey: 'PlanId' });
  TelegramPayment.belongsTo(Plan, { foreignKey: 'PlanId' });
  User.hasMany(UserSubscription, { foreignKey: 'UserId' });
  UserSubscription.belongsTo(User, { foreignKey: 'UserId' });
  Plan.hasMany(UserSubscription, { foreignKey: 'PlanId' });
  UserSubscription.belongsTo(Plan, { foreignKey: 'PlanId' });
  TelegramPayment.hasMany(UserSubscription, { foreignKey: 'TelegramPaymentId' });
  UserSubscription.belongsTo(TelegramPayment, { foreignKey: 'TelegramPaymentId' });
  User.hasMany(UserBonusOpen, { foreignKey: 'UserId' });
  UserBonusOpen.belongsTo(User, { foreignKey: 'UserId' });
  User.hasMany(Referral, { foreignKey: 'ReferrerUserId' });
  Referral.belongsTo(User, { as: 'Referrer', foreignKey: 'ReferrerUserId' });
  User.hasMany(Referral, { foreignKey: 'ReferredUserId' });
  Referral.belongsTo(User, { as: 'Referred', foreignKey: 'ReferredUserId' });

  return {
    User,
    Application,
    Users: User,
    Applications: Application,
    RemoteCompany,
    RemoteCompanies: RemoteCompany,
    Config,
    Configs: Config,
    SearchClick,
    SearchClicks: SearchClick,
    JobDetailsOpen,
    JobDetailsOpens: JobDetailsOpen,
    RequiredChannel,
    RequiredChannels: RequiredChannel,
    RequiredChannelUser,
    RequiredChannelUsers: RequiredChannelUser,
    Plan,
    Plans: Plan,
    TelegramPayment,
    TelegramPayments: TelegramPayment,
    UserSubscription,
    UserSubscriptions: UserSubscription,
    UserBonusOpen,
    UserBonusOpens: UserBonusOpen,
    Referral,
    Referrals: Referral,
  };
}
