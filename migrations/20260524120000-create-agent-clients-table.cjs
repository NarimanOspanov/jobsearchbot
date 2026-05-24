'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AgentClients'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'AgentClients', schema: 'dbo' }, {
      Id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      AgentUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ClientUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      CreatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'AgentClients', schema: 'dbo' }, ['AgentUserId'], {
      name: 'AgentClients_AgentUserId_idx',
    });
    await qi.addIndex({ tableName: 'AgentClients', schema: 'dbo' }, ['ClientUserId'], {
      unique: true,
      name: 'UQ_AgentClients_ClientUserId',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'AgentClients', schema: 'dbo' });
  },
};
