import { DataTypes } from 'sequelize';

export default function defineConfig(sequelize) {
  const Config = sequelize.define(
    'Config',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Key: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      Value: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      Description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      UpdatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'Configs',
      schema: 'dbo',
      timestamps: false,
      indexes: [{ unique: true, fields: ['Key'] }],
    }
  );

  return Config;
}
