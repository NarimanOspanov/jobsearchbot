import { DataTypes } from 'sequelize';

export default function defineUserSubscription(sequelize) {
  const UserSubscription = sequelize.define(
    'UserSubscription',
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
      TelegramPaymentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      StartsAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      EndsAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      Status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'active',
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'UserSubscriptions',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId', 'Status', 'EndsAt'] },
        { fields: ['PlanId', 'Status'] },
      ],
    }
  );

  return UserSubscription;
}
