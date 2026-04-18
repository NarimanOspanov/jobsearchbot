import { DataTypes } from 'sequelize';

export default function defineJobDetailsOpen(sequelize) {
  const JobDetailsOpen = sequelize.define(
    'JobDetailsOpen',
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
      JobId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'JobDetailsOpens',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId', 'CreatedAt'] },
        { fields: ['JobId', 'CreatedAt'] },
      ],
    }
  );

  return JobDetailsOpen;
}
