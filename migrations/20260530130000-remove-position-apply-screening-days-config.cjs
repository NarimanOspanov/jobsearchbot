'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;

    const [minExists] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM dbo.Configs WHERE [Key] = 'PositionApplyScreeningResponseMin'`
    );
    if (minExists.length === 0) {
      await qi.bulkInsert(
        { tableName: 'Configs', schema: 'dbo' },
        [
          {
            Key: 'PositionApplyScreeningResponseMin',
            Value: '4320',
            Description: 'Minutes until default screening response (rejection) is sent to applicants',
            UpdatedAt: new Date(),
          },
        ]
      );
    }

    await qi.bulkDelete(
      { tableName: 'Configs', schema: 'dbo' },
      { Key: 'PositionApplyScreeningResponseDays' }
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;

    const [daysExists] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM dbo.Configs WHERE [Key] = 'PositionApplyScreeningResponseDays'`
    );
    if (daysExists.length === 0) {
      await qi.bulkInsert(
        { tableName: 'Configs', schema: 'dbo' },
        [
          {
            Key: 'PositionApplyScreeningResponseDays',
            Value: '3',
            Description: 'Days until default screening response (rejection) is sent to applicants',
            UpdatedAt: new Date(),
          },
        ]
      );
    }
  },
};
