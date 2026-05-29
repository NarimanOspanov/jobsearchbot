import { DataTypes } from 'sequelize';

export default function defineUserApplicationOutreach(sequelize) {
  const UserApplicationOutreach = sequelize.define(
    'UserApplicationOutreach',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      UserApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      MessageType: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      Language: {
        type: DataTypes.STRING(10),
        allowNull: false,
      },
      Text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      ReplyMarkupJson: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      Status: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      Error: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      TelegramMessageId: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      SentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'UserApplicationOutreach',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['UserApplicationId', 'MessageType'] },
        { fields: ['CreatedAt'] },
      ],
    }
  );

  return UserApplicationOutreach;
}
