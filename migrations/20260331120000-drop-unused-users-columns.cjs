'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
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

    if (await hasColumn('ActiveModel')) {
      await qi.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'ActiveModel');
    }
    if (await hasColumn('FreeGenerationsRemaining')) {
      await qi.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'FreeGenerationsRemaining');
    }
    if (await hasColumn('LastDailyBonusAt')) {
      await qi.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'LastDailyBonusAt');
    }
  },

  async down(queryInterface, Sequelize) {
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

    if (!(await hasColumn('ActiveModel'))) {
      await qi.addColumn(
        { tableName: 'Users', schema: 'dbo' },
        'ActiveModel',
        { type: Sequelize.STRING(50), allowNull: true }
      );
    }
    if (!(await hasColumn('FreeGenerationsRemaining'))) {
      await qi.addColumn(
        { tableName: 'Users', schema: 'dbo' },
        'FreeGenerationsRemaining',
        { type: Sequelize.INTEGER, allowNull: false, defaultValue: 20 }
      );
    }
    if (!(await hasColumn('LastDailyBonusAt'))) {
      await qi.addColumn(
        { tableName: 'Users', schema: 'dbo' },
        'LastDailyBonusAt',
        { type: Sequelize.DATE, allowNull: true }
      );
    }
  },
};
