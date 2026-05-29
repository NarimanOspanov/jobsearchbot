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
      Publisher: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      PublishedIn: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      Status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'pending_screening',
      },
      ScreeningResponseDueAt: {
        type: DataTypes.DATE,
        allowNull: true,
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
