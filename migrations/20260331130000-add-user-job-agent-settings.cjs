'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const cols = [
      'HhEnabled',
      'LinkedInEnabled',
      'IndeedEnabled',
      'CompanySitesEnabled',
      'EmailFoundersEnabled',
      'EmailRecruitersEnabled',
    ];

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    for (const col of cols) {
      if (!(await hasColumn(col))) {
        await qi.addColumn(
          { tableName: 'Users', schema: 'dbo' },
          col,
          { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }
        );
      }
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const cols = [
      'HhEnabled',
      'LinkedInEnabled',
      'IndeedEnabled',
      'CompanySitesEnabled',
      'EmailFoundersEnabled',
      'EmailRecruitersEnabled',
    ];

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    for (const col of cols) {
      if (await hasColumn(col)) {
        await qi.removeColumn({ tableName: 'Users', schema: 'dbo' }, col);
      }
    }
  },
};
