'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;
    const rows = [
      {
        key: 'ChannelSubscribeBonusOpens',
        value: '20',
        description: 'Bonus job opens granted once after required channels are verified',
      },
      {
        key: 'FreeJobOpensMonthlyLimit',
        value: '100',
        description: 'Monthly free job opens limit for users without active paid plan',
      },
    ];

    for (const row of rows) {
      const [existing] = await qi.sequelize.query(
        `SELECT TOP 1 Id
         FROM dbo.Configs
         WHERE [Key] = :key`,
        { replacements: { key: row.key } }
      );
      if (existing.length > 0) continue;

      await qi.bulkInsert({ tableName: 'Configs', schema: 'dbo' }, [
        {
          Key: row.key,
          Value: row.value,
          Description: row.description,
          UpdatedAt: new Date(),
        },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete(
      { tableName: 'Configs', schema: 'dbo' },
      { Key: ['ChannelSubscribeBonusOpens', 'FreeJobOpensMonthlyLimit'] }
    );
  },
};
