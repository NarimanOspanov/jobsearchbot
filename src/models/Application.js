import { DataTypes } from 'sequelize';

export default function defineApplication(sequelize) {
  const Application = sequelize.define(
    'Application',
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
      VacancyTitle: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      CompanyName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      Source: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      Status: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      AppliedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      Notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      MetaJson: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'Applications',
      schema: 'dbo',
      timestamps: false,
      indexes: [{ fields: ['UserId', 'AppliedAt'] }],
    }
  );

  return Application;
}
