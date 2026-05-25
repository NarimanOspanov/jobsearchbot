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

    if (!(await hasColumn('ScreenshotArtifactURL'))) {
      await qi.addColumn(table, 'ScreenshotArtifactURL', {
        type: Sequelize.STRING(2048),
        allowNull: true,
      });
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

    if (await hasColumn('ScreenshotArtifactURL')) {
      await qi.removeColumn(table, 'ScreenshotArtifactURL');
    }
  },
};
