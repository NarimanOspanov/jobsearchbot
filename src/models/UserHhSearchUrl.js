import { DataTypes } from 'sequelize';

export default function defineUserHhSearchUrl(sequelize) {
  const UserHhSearchUrl = sequelize.define(
    'UserHhSearchUrl',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      SearchURL: {
        type: DataTypes.STRING(2048),
        allowNull: false,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'UserHhSearchUrls',
      schema: 'dbo',
      timestamps: false,
      indexes: [{ fields: ['UserId'] }],
    }
  );

  return UserHhSearchUrl;
}
