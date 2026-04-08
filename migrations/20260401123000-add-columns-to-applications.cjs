'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = { tableName: 'Applications', schema: 'dbo' };

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Applications' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (!(await hasColumn('Score'))) {
      await qi.addColumn(table, 'Score', { type: Sequelize.DECIMAL(3, 1), allowNull: true });
    }
    if (!(await hasColumn('ScreenlyJobId'))) {
      await qi.addColumn(table, 'ScreenlyJobId', { type: Sequelize.INTEGER, allowNull: true });
    }
    if (!(await hasColumn('TailoredCVURL'))) {
      await qi.addColumn(table, 'TailoredCVURL', { type: Sequelize.STRING(2048), allowNull: true });
    }
    if (!(await hasColumn('CoverLetter'))) {
      await qi.addColumn(table, 'CoverLetter', { type: Sequelize.TEXT, allowNull: true });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const table = { tableName: 'Applications', schema: 'dbo' };

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Applications' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (await hasColumn('CoverLetter')) await qi.removeColumn(table, 'CoverLetter');
    if (await hasColumn('TailoredCVURL')) await qi.removeColumn(table, 'TailoredCVURL');
    if (await hasColumn('ScreenlyJobId')) await qi.removeColumn(table, 'ScreenlyJobId');
    if (await hasColumn('Score')) await qi.removeColumn(table, 'Score');
  },
};
