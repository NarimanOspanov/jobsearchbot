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

    if (!(await hasColumn('ApplyType'))) {
      await qi.addColumn(table, 'ApplyType', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }

    await qi.sequelize.query(`
      UPDATE dbo.Applications
      SET ApplyType = JSON_VALUE(MetaJson, '$.applyType')
      WHERE ApplyType IS NULL
        AND MetaJson IS NOT NULL
        AND JSON_VALUE(MetaJson, '$.applyType') IS NOT NULL
    `);
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

    if (await hasColumn('ApplyType')) {
      await qi.removeColumn(table, 'ApplyType');
    }
  },
};
