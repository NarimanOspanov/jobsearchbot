import { DataTypes } from 'sequelize';

export default function defineReferral(sequelize) {
  const Referral = sequelize.define(
    'Referral',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      ReferrerUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ReferredUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ReferredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'Referrals',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['ReferrerUserId'] },
        { fields: ['ReferredUserId'] },
        { unique: true, fields: ['ReferrerUserId', 'ReferredUserId'] },
      ],
    }
  );

  return Referral;
}
