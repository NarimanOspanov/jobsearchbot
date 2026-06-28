'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const addIfMissing = async (column, type) => {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = '${column}'`
      );
      if (!rows.length) {
        await qi.addColumn({ tableName: 'Users', schema: 'dbo' }, column, { type, allowNull: true });
      }
    };
    await addIfMissing('HHUserName', Sequelize.STRING(255));
    await addIfMissing('HHPassword', Sequelize.STRING(512));
  },

  async down(queryInterface) {
    await queryInterface.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'HHUserName');
    await queryInterface.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'HHPassword');
  },
};
