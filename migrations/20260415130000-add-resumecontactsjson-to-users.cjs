'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [tableRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users'`
    );
    if (tableRows.length === 0) return;

    const [columnRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'ResumeContactsJson'`
    );
    if (columnRows.length > 0) return;

    await qi.addColumn(
      { tableName: 'Users', schema: 'dbo' },
      'ResumeContactsJson',
      {
        type: Sequelize.TEXT,
        allowNull: true,
      }
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [tableRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users'`
    );
    if (tableRows.length === 0) return;

    const [columnRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'ResumeContactsJson'`
    );
    if (columnRows.length === 0) return;

    await qi.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'ResumeContactsJson');
  },
};
