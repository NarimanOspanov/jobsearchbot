import defineUser from './User.js';
import defineApplication from './Application.js';
import defineRemoteCompany from './RemoteCompany.js';
import defineConfig from './Config.js';
import defineSearchClick from './SearchClick.js';
import defineJobDetailsOpen from './JobDetailsOpen.js';
import defineRequiredChannel from './RequiredChannel.js';
import defineRequiredChannelUser from './RequiredChannelUser.js';

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

  User.hasMany(Application, { foreignKey: 'UserId' });
  Application.belongsTo(User, { foreignKey: 'UserId' });
  User.hasMany(SearchClick, { foreignKey: 'UserId' });
  SearchClick.belongsTo(User, { foreignKey: 'UserId' });
  User.hasMany(JobDetailsOpen, { foreignKey: 'UserId' });
  JobDetailsOpen.belongsTo(User, { foreignKey: 'UserId' });

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
  };
}
