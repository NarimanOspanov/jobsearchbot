'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'Language'`
    );
    if (rows.length > 0) return;

    await qi.addColumn(
      { tableName: 'Users', schema: 'dbo' },
      'Language',
      { type: Sequelize.STRING(10), allowNull: true }
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'Language'`
    );
    if (rows.length === 0) return;
    await qi.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'Language');
  },
};
