'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [tables] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Positions'`
    );
    if (tables.length === 0) return;

    const [cols] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Positions' AND COLUMN_NAME = 'ExternalApplyURL'`
    );
    if (cols.length > 0) return;

    await qi.addColumn(
      { tableName: 'Positions', schema: 'dbo' },
      'ExternalApplyURL',
      {
        type: Sequelize.STRING(2048),
        allowNull: true,
      }
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [tables] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Positions'`
    );
    if (tables.length === 0) return;

    const [cols] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Positions' AND COLUMN_NAME = 'ExternalApplyURL'`
    );
    if (cols.length === 0) return;

    await qi.removeColumn({ tableName: 'Positions', schema: 'dbo' }, 'ExternalApplyURL');
  },
};
