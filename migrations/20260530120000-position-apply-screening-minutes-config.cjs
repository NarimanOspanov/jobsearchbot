'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;

    const [minExists] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM dbo.Configs WHERE [Key] = 'PositionApplyScreeningResponseMin'`
    );
    if (minExists.length === 0) {
      const [daysRow] = await qi.sequelize.query(
        `SELECT [Value] FROM dbo.Configs WHERE [Key] = 'PositionApplyScreeningResponseDays'`
      );
      let minutes = 4320;
      if (daysRow.length > 0) {
        const days = Number.parseInt(String(daysRow[0]?.Value || ''), 10);
        if (Number.isSafeInteger(days) && days > 0) {
          minutes = days * 24 * 60;
        }
      }
      await qi.bulkInsert(
        { tableName: 'Configs', schema: 'dbo' },
        [
          {
            Key: 'PositionApplyScreeningResponseMin',
            Value: String(minutes),
            Description: 'Minutes until default screening response (rejection) is sent to applicants',
            UpdatedAt: new Date(),
          },
        ]
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete(
      { tableName: 'Configs', schema: 'dbo' },
      { Key: 'PositionApplyScreeningResponseMin' }
    );
  },
};
