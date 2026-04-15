import { DataTypes } from 'sequelize';

export default function defineRemoteCompany(sequelize) {
  const RemoteCompany = sequelize.define(
    'RemoteCompany',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      Url: {
        type: DataTypes.STRING(1024),
        allowNull: false,
      },
      Notes: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },
      DateAdded: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'RemoteCompanies',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['DateAdded'] },
        { unique: true, fields: ['Url'] },
      ],
    }
  );

  return RemoteCompany;
}
