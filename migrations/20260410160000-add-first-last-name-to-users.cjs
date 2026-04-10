'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = { tableName: 'Users', schema: 'dbo' };

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (!(await hasColumn('FirstName'))) {
      await qi.addColumn(table, 'FirstName', { type: Sequelize.STRING(255), allowNull: true });
    }
    if (!(await hasColumn('LastName'))) {
      await qi.addColumn(table, 'LastName', { type: Sequelize.STRING(255), allowNull: true });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const table = { tableName: 'Users', schema: 'dbo' };

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (await hasColumn('LastName')) await qi.removeColumn(table, 'LastName');
    if (await hasColumn('FirstName')) await qi.removeColumn(table, 'FirstName');
  },
};
