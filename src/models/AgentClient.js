import { DataTypes } from 'sequelize';

export default function defineAgentClient(sequelize) {
  const AgentClient = sequelize.define(
    'AgentClient',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      AgentUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ClientUserId: {
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
      tableName: 'AgentClients',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['AgentUserId'] },
        { unique: true, fields: ['ClientUserId'] },
      ],
    }
  );

  return AgentClient;
}
