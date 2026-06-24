import { DataTypes } from 'sequelize';

export default function defineIndustry(sequelize) {
  const Industry = sequelize.define(
    'Industry',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      NameEng: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      Slug: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      SortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'Industries',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['Slug'] },
        { unique: true, fields: ['Name'] },
      ],
    }
  );
  return Industry;
}
