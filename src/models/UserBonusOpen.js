import { DataTypes } from 'sequelize';

export default function defineUserBonusOpen(sequelize) {
  const UserBonusOpen = sequelize.define(
    'UserBonusOpen',
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
      Source: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      OpensGranted: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      Note: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'UserBonusOpens',
      schema: 'dbo',
      timestamps: false,
      indexes: [{ fields: ['UserId', 'CreatedAt'] }, { fields: ['Source', 'CreatedAt'] }],
    }
  );

  return UserBonusOpen;
}
