'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'JobDetailsOpens'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'JobDetailsOpens', schema: 'dbo' }, {
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
      JobId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      CreatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'JobDetailsOpens', schema: 'dbo' }, ['UserId', 'CreatedAt'], {
      name: 'JobDetailsOpens_UserId_CreatedAt_idx',
    });
    await qi.addIndex({ tableName: 'JobDetailsOpens', schema: 'dbo' }, ['JobId', 'CreatedAt'], {
      name: 'JobDetailsOpens_JobId_CreatedAt_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'JobDetailsOpens'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'JobDetailsOpens', schema: 'dbo' });
  },
};
