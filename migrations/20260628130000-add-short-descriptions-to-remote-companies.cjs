'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const addIfMissing = async (column, type) => {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanies' AND COLUMN_NAME = '${column}'`
      );
      if (!rows.length) {
        await qi.addColumn({ tableName: 'RemoteCompanies', schema: 'dbo' }, column, { type, allowNull: true });
      }
    };
    await addIfMissing('ShortDescriptionRU', Sequelize.STRING(1000));
    await addIfMissing('ShortDescriptionEng', Sequelize.STRING(1000));
  },

  async down(queryInterface) {
    await queryInterface.removeColumn({ tableName: 'RemoteCompanies', schema: 'dbo' }, 'ShortDescriptionRU');
    await queryInterface.removeColumn({ tableName: 'RemoteCompanies', schema: 'dbo' }, 'ShortDescriptionEng');
  },
};
