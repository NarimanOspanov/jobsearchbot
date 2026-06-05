'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'HumanAssistantRequests'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'HumanAssistantRequests', schema: 'dbo' }, {
      Id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      UserId: {
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
      Status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'pending',
      },
      Source: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      AssignedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await qi.addIndex({ tableName: 'HumanAssistantRequests', schema: 'dbo' }, ['UserId'], {
      name: 'HumanAssistantRequests_UserId_idx',
    });
    await qi.addIndex({ tableName: 'HumanAssistantRequests', schema: 'dbo' }, ['Status', 'CreatedAt'], {
      name: 'HumanAssistantRequests_Status_CreatedAt_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'HumanAssistantRequests', schema: 'dbo' });
  },
};
