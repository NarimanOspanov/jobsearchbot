'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [tableRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanies'`
    );
    if (tableRows.length === 0) return;

    const [columnRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanies' AND COLUMN_NAME = 'Notes'`
    );
    if (columnRows.length > 0) return;

    await qi.addColumn(
      { tableName: 'RemoteCompanies', schema: 'dbo' },
      'Notes',
      {
        type: Sequelize.STRING(1000),
        allowNull: true,
      }
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [tableRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanies'`
    );
    if (tableRows.length === 0) return;

    const [columnRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanies' AND COLUMN_NAME = 'Notes'`
    );
    if (columnRows.length === 0) return;

    await qi.removeColumn({ tableName: 'RemoteCompanies', schema: 'dbo' }, 'Notes');
  },
};
