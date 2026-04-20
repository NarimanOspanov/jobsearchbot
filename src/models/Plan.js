import { DataTypes } from 'sequelize';

export default function definePlan(sequelize) {
  const Plan = sequelize.define(
    'Plan',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Code: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
      Name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      PriceInStars: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      DurationDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      JobOpenMonthlyLimit: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      IncludesAiTools: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      IsActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      SortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'Plans',
      schema: 'dbo',
      timestamps: false,
      indexes: [{ unique: true, fields: ['Code'] }, { fields: ['IsActive', 'SortOrder'] }],
    }
  );

  return Plan;
}
