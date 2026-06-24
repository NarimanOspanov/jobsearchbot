'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [columns] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Industries' AND COLUMN_NAME = 'NameEng'`
    );
    if (!columns.length) {
      await qi.addColumn({ tableName: 'Industries', schema: 'dbo' }, 'NameEng', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [columns] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Industries' AND COLUMN_NAME = 'NameEng'`
    );
    if (columns.length) {
      await qi.removeColumn({ tableName: 'Industries', schema: 'dbo' }, 'NameEng');
    }
  },
};
