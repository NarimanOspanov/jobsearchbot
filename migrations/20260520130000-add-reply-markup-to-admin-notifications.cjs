'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AdminNotifications' AND COLUMN_NAME = 'ReplyMarkupJson'`
    );
    if (rows.length > 0) return;

    await qi.addColumn(
      { tableName: 'AdminNotifications', schema: 'dbo' },
      'ReplyMarkupJson',
      { type: Sequelize.TEXT, allowNull: true }
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AdminNotifications' AND COLUMN_NAME = 'ReplyMarkupJson'`
    );
    if (rows.length === 0) return;
    await qi.removeColumn({ tableName: 'AdminNotifications', schema: 'dbo' }, 'ReplyMarkupJson');
  },
};
