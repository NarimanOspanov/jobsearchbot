import { DataTypes } from 'sequelize';

function normalizeSkillIds(value) {
  const rawItems = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      rawItems
        .map((item) => Number.parseInt(String(item), 10))
        .filter((item) => Number.isSafeInteger(item) && item > 0)
    )
  );
}

/**
 * Code-first User model. Maps to existing dbo.Users table.
 */
export default function defineUser(sequelize) {
  const User = sequelize.define(
    'User',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      TelegramUserName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      FirstName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      LastName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      TelegramChatId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
      },
      DateJoined: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      Promocode: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      IsBlocked: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      MuteBotUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      Timezone: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      HhEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      LinkedInEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      IndeedEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      TelegramEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      CompanySitesEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      EmailFoundersEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      EmailRecruitersEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      SearchMode: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'not_urgent',
      },
      MinimumSalary: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      RemoteOnly: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      ResumeURL: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      ResumeContactsJson: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      skills: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
          const rawValue = this.getDataValue('skills');
          if (!rawValue || typeof rawValue !== 'string') return [];
          try {
            return normalizeSkillIds(JSON.parse(rawValue));
          } catch {
            return [];
          }
        },
        set(value) {
          const normalized = normalizeSkillIds(value);
          this.setDataValue('skills', normalized.length > 0 ? JSON.stringify(normalized) : null);
        },
      },
    },
    {
      tableName: 'Users',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['TelegramChatId'] },
      ],
    }
  );
  return User;
}
