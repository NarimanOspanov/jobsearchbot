'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Configs'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'Configs', schema: 'dbo' }, {
      Id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Key: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      Value: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      Description: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      UpdatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'Configs', schema: 'dbo' }, ['Key'], {
      unique: true,
      name: 'UQ_Configs_Key',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Configs'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'Configs', schema: 'dbo' });
  },
};
