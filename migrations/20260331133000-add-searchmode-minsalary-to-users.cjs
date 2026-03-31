'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (!(await hasColumn('SearchMode'))) {
      await qi.addColumn(
        { tableName: 'Users', schema: 'dbo' },
        'SearchMode',
        { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'not_urgent' }
      );
    }

    if (!(await hasColumn('MinimumSalary'))) {
      await qi.addColumn(
        { tableName: 'Users', schema: 'dbo' },
        'MinimumSalary',
        { type: Sequelize.INTEGER, allowNull: true }
      );
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (await hasColumn('MinimumSalary')) {
      await qi.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'MinimumSalary');
    }
    if (await hasColumn('SearchMode')) {
      await qi.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'SearchMode');
    }
  },
};
