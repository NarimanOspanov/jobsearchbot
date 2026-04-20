import { DataTypes } from 'sequelize';

export default function defineTelegramPayment(sequelize) {
  const TelegramPayment = sequelize.define(
    'TelegramPayment',
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
      PlanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      TelegramPaymentChargeId: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      ProviderPaymentChargeId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      InvoicePayload: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      StarsAmount: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      Currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'XTR',
      },
      Status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'completed',
      },
      PaidAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'TelegramPayments',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['TelegramPaymentChargeId'] },
        { fields: ['UserId', 'PaidAt'] },
        { fields: ['PlanId', 'PaidAt'] },
      ],
    }
  );

  return TelegramPayment;
}
