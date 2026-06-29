import { DataTypes } from 'sequelize';

/**
 * Per-user opt-in: auto-apply on the user's behalf when matching positions
 * appear at this remote-first company. Join table Users <-> RemoteCompanies.
 */
export default function defineUserRemoteCompanyAutoApply(sequelize) {
  const UserRemoteCompanyAutoApply = sequelize.define(
    'UserRemoteCompanyAutoApply',
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
      tableName: 'UserRemoteCompanyAutoApplies',
      schema: 'dbo',
      timestamps: false,
    }
  );
  return UserRemoteCompanyAutoApply;
}
