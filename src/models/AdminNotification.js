import { DataTypes } from 'sequelize';

export default function defineAdminNotification(sequelize) {
  const AdminNotification = sequelize.define(
    'AdminNotification',
    {
      Id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      RunId: {
        type: DataTypes.STRING(36),
        allowNull: true,
      },
      InitiatorChatId: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      Text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      ReceiverType: {
        type: DataTypes.STRING(10),
        allowNull: false,
      },
      ReceiverChatId: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      Status: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      Error: {
        type: DataTypes.STRING(500),
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
      SentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'AdminNotifications',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['RunId', 'CreatedAt'] },
        { fields: ['InitiatorChatId', 'CreatedAt'] },
        { fields: ['ReceiverChatId', 'CreatedAt'] },
        { fields: ['Status', 'CreatedAt'] },
      ],
    }
  );

  return AdminNotification;
}
