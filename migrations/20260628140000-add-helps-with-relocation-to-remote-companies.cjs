'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanies' AND COLUMN_NAME = 'HelpsWithRelocation'`
    );
    if (!rows.length) {
      await qi.addColumn({ tableName: 'RemoteCompanies', schema: 'dbo' }, 'HelpsWithRelocation', {
        type: Sequelize.BOOLEAN, // BIT, NULL = unknown
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn({ tableName: 'RemoteCompanies', schema: 'dbo' }, 'HelpsWithRelocation');
  },
};
