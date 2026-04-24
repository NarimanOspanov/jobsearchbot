import { DataTypes } from 'sequelize';

export default function defineUserApplication(sequelize) {
  const UserApplication = sequelize.define(
    'UserApplication',
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
      PositionId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      DateTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'UserApplications',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId', 'DateTime'] },
        { fields: ['PositionId', 'DateTime'] },
      ],
    }
  );

  return UserApplication;
}
