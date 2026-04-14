import defineUser from './User.js';
import defineApplication from './Application.js';
import defineRemoteCompany from './RemoteCompany.js';
import defineConfig from './Config.js';

/**
 * Initialize only the User model for empty bot runtime.
 */
export function initModels(sequelize) {
  const User = defineUser(sequelize);
  const Application = defineApplication(sequelize);
  const RemoteCompany = defineRemoteCompany(sequelize);
  const Config = defineConfig(sequelize);

  User.hasMany(Application, { foreignKey: 'UserId' });
  Application.belongsTo(User, { foreignKey: 'UserId' });

  return {
    User,
    Application,
    Users: User,
    Applications: Application,
    RemoteCompany,
    RemoteCompanies: RemoteCompany,
    Config,
    Configs: Config,
  };
}
