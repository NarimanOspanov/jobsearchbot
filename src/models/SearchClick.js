import { DataTypes } from 'sequelize';

export default function defineSearchClick(sequelize) {
  const SearchClick = sequelize.define(
    'SearchClick',
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
      SearchUrl: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'SearchClicks',
      schema: 'dbo',
      timestamps: false,
      indexes: [{ fields: ['UserId', 'CreatedAt'] }],
    }
  );

  return SearchClick;
}
