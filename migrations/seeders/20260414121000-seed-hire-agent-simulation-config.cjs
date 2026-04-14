'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const key = 'hireAgentSimulationVisible';
    const [rows] = await queryInterface.sequelize.query(
      `SELECT TOP 1 Id
       FROM dbo.Configs
       WHERE [Key] = :key`,
      { replacements: { key } }
    );
    if (rows.length > 0) return;

    await queryInterface.bulkInsert({ tableName: 'Configs', schema: 'dbo' }, [{
      Key: key,
      Value: 'false',
      Description: 'Controls demo simulation flow in /hireagent after CV upload',
      UpdatedAt: new Date(),
    }]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete(
      { tableName: 'Configs', schema: 'dbo' },
      { Key: 'hireAgentSimulationVisible' }
    );
  },
};
