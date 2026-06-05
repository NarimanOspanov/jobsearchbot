import { DataTypes } from 'sequelize';

export const HUMAN_ASSISTANT_REQUEST_STATUS = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  CANCELLED: 'cancelled',
};

export default function defineHumanAssistantRequest(sequelize) {
  const HumanAssistantRequest = sequelize.define(
    'HumanAssistantRequest',
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
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      Status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: HUMAN_ASSISTANT_REQUEST_STATUS.PENDING,
      },
      Source: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      AssignedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'HumanAssistantRequests',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId'] },
        { fields: ['Status', 'CreatedAt'] },
      ],
    }
  );

  return HumanAssistantRequest;
}
