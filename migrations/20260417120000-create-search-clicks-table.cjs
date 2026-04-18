'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SearchClicks'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'SearchClicks', schema: 'dbo' }, {
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
      SearchUrl: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      CreatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'SearchClicks', schema: 'dbo' }, ['UserId', 'CreatedAt'], {
      name: 'SearchClicks_UserId_CreatedAt_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SearchClicks'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'SearchClicks', schema: 'dbo' });
  },
};
