import { DataTypes } from 'sequelize';

export default function defineAdminNotificationRun(sequelize) {
  const AdminNotificationRun = sequelize.define(
    'AdminNotificationRun',
    {
      Id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      InitiatorChatId: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      Text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      Total: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      Processed: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      Sent: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      Failed: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      Status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'running',
      },
      StopRequestedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      StartedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      StoppedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      FinishedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      UpdatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'AdminNotificationRuns',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['Status', 'StartedAt'] },
        { fields: ['InitiatorChatId', 'StartedAt'] },
        { fields: ['CreatedAt'] },
      ],
    }
  );

  return AdminNotificationRun;
}
