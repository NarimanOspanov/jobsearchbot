import defineUser from './User.js';
import defineApplication from './Application.js';
import defineRemoteCompany from './RemoteCompany.js';
import defineIndustry from './Industry.js';
import defineRemoteCompanyIndustry from './RemoteCompanyIndustry.js';
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
import definePosition from './Position.js';
import defineUserApplication from './UserApplication.js';
import defineUserApplicationOutreach from './UserApplicationOutreach.js';
import defineAdminNotification from './AdminNotification.js';
import defineAdminNotificationRun from './AdminNotificationRun.js';
import defineAgentClient from './AgentClient.js';
import defineClientMentor from './ClientMentor.js';
import defineHumanAssistantRequest from './HumanAssistantRequest.js';
import definePublisherSignup from './PublisherSignup.js';
import defineCampaignSignup from './CampaignSignup.js';
import defineUserHhSearchUrl from './UserHhSearchUrl.js';

/**
 * Initialize only the User model for empty bot runtime.
 */
export function initModels(sequelize) {
  const User = defineUser(sequelize);
  const Application = defineApplication(sequelize);
  const RemoteCompany = defineRemoteCompany(sequelize);
  const Industry = defineIndustry(sequelize);
  const RemoteCompanyIndustry = defineRemoteCompanyIndustry(sequelize);
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
  const Position = definePosition(sequelize);
  const UserApplication = defineUserApplication(sequelize);
  const UserApplicationOutreach = defineUserApplicationOutreach(sequelize);
  const AdminNotification = defineAdminNotification(sequelize);
  const AdminNotificationRun = defineAdminNotificationRun(sequelize);
  const AgentClient = defineAgentClient(sequelize);
  const ClientMentor = defineClientMentor(sequelize);
  const HumanAssistantRequest = defineHumanAssistantRequest(sequelize);
  const PublisherSignup = definePublisherSignup(sequelize);
  const CampaignSignup = defineCampaignSignup(sequelize);
  const UserHhSearchUrl = defineUserHhSearchUrl(sequelize);

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
  User.hasMany(UserApplication, { foreignKey: 'UserId' });
  UserApplication.belongsTo(User, { foreignKey: 'UserId' });
  Position.hasMany(UserApplication, { foreignKey: 'PositionId' });
  UserApplication.belongsTo(Position, { foreignKey: 'PositionId' });
  UserApplication.hasMany(UserApplicationOutreach, { foreignKey: 'UserApplicationId' });
  UserApplicationOutreach.belongsTo(UserApplication, { foreignKey: 'UserApplicationId' });
  User.hasMany(UserApplicationOutreach, { foreignKey: 'UserId' });
  UserApplicationOutreach.belongsTo(User, { foreignKey: 'UserId' });
  User.hasMany(AgentClient, { as: 'AgentAssignments', foreignKey: 'AgentUserId' });
  AgentClient.belongsTo(User, { as: 'Agent', foreignKey: 'AgentUserId' });
  User.hasOne(AgentClient, { as: 'ClientAssignment', foreignKey: 'ClientUserId' });
  AgentClient.belongsTo(User, { as: 'Client', foreignKey: 'ClientUserId' });
  User.hasMany(ClientMentor, { as: 'MentorAssignments', foreignKey: 'MentorUserId' });
  ClientMentor.belongsTo(User, { as: 'Mentor', foreignKey: 'MentorUserId' });
  User.hasMany(ClientMentor, { as: 'ClientMentorAssignments', foreignKey: 'ClientUserId' });
  ClientMentor.belongsTo(User, { as: 'Client', foreignKey: 'ClientUserId' });
  User.hasMany(HumanAssistantRequest, { foreignKey: 'UserId' });
  HumanAssistantRequest.belongsTo(User, { as: 'User', foreignKey: 'UserId' });
  User.hasOne(PublisherSignup, { foreignKey: 'UserId' });
  PublisherSignup.belongsTo(User, { foreignKey: 'UserId' });
  Position.hasMany(PublisherSignup, { foreignKey: 'PositionId' });
  PublisherSignup.belongsTo(Position, { foreignKey: 'PositionId' });
  User.hasOne(CampaignSignup, { foreignKey: 'UserId' });
  CampaignSignup.belongsTo(User, { foreignKey: 'UserId' });
  User.hasMany(UserHhSearchUrl, { as: 'HhSearchUrls', foreignKey: 'UserId' });
  UserHhSearchUrl.belongsTo(User, { foreignKey: 'UserId' });

  RemoteCompany.belongsToMany(Industry, {
    through: RemoteCompanyIndustry,
    foreignKey: 'RemoteCompanyId',
    otherKey: 'IndustryId',
    as: 'Industries',
  });
  Industry.belongsToMany(RemoteCompany, {
    through: RemoteCompanyIndustry,
    foreignKey: 'IndustryId',
    otherKey: 'RemoteCompanyId',
    as: 'Companies',
  });

  return {
    User,
    Application,
    Users: User,
    Applications: Application,
    RemoteCompany,
    RemoteCompanies: RemoteCompany,
    Industry,
    Industries: Industry,
    RemoteCompanyIndustry,
    RemoteCompanyIndustries: RemoteCompanyIndustry,
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
    Position,
    Positions: Position,
    UserApplication,
    UserApplications: UserApplication,
    UserApplicationOutreach,
    UserApplicationOutreaches: UserApplicationOutreach,
    AdminNotification,
    AdminNotifications: AdminNotification,
    AdminNotificationRun,
    AdminNotificationRuns: AdminNotificationRun,
    AgentClient,
    AgentClients: AgentClient,
    ClientMentor,
    ClientMentors: ClientMentor,
    HumanAssistantRequest,
    HumanAssistantRequests: HumanAssistantRequest,
    PublisherSignup,
    PublisherSignups: PublisherSignup,
    CampaignSignup,
    CampaignSignups: CampaignSignup,
    UserHhSearchUrl,
    UserHhSearchUrls: UserHhSearchUrl,
  };
}
