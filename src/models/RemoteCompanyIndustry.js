import { DataTypes } from 'sequelize';

export default function defineRemoteCompanyIndustry(sequelize) {
  const RemoteCompanyIndustry = sequelize.define(
    'RemoteCompanyIndustry',
    {
      RemoteCompanyId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      IndustryId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
    },
    {
      tableName: 'RemoteCompanyIndustries',
      schema: 'dbo',
      timestamps: false,
    }
  );
  return RemoteCompanyIndustry;
}
