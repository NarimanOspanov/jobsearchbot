import { DataTypes } from 'sequelize';

/**
 * Per-user opt-in: notify the user when matching positions appear at this
 * remote-first company. Join table Users <-> RemoteCompanies.
 */
export default function defineUserRemoteCompanyNotify(sequelize) {
  const UserRemoteCompanyNotify = sequelize.define(
    'UserRemoteCompanyNotify',
    {
      UserId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      RemoteCompanyId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'UserRemoteCompanyNotifies',
      schema: 'dbo',
      timestamps: false,
    }
  );
  return UserRemoteCompanyNotify;
}
