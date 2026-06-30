'use strict';

/**
 * Adds Applications.HhStatus — the latest HH negotiation/response status
 * (e.g. "Отклик доставлен", "Просмотрено", "Приглашение", "Отказ") harvested
 * from /applicant/negotiations by the autoapply cron. NULL for non-HH applies.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [col] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Applications' AND COLUMN_NAME = 'HhStatus'`
    );
    if (!col.length) {
      await qi.addColumn({ tableName: 'Applications', schema: 'dbo' }, 'HhStatus', {
        type: Sequelize.STRING(100),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [col] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Applications' AND COLUMN_NAME = 'HhStatus'`
    );
    if (col.length) {
      await qi.removeColumn({ tableName: 'Applications', schema: 'dbo' }, 'HhStatus');
    }
  },
};
