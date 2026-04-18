'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RequiredChannelUsers'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'RequiredChannelUsers', schema: 'dbo' }, {
      Id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      ChannelId: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      UserId: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      DateTime: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'RequiredChannelUsers', schema: 'dbo' }, ['ChannelId', 'UserId'], {
      unique: true,
      name: 'UQ_RequiredChannelUsers_ChannelId_UserId',
    });
    await qi.addIndex({ tableName: 'RequiredChannelUsers', schema: 'dbo' }, ['DateTime'], {
      name: 'RequiredChannelUsers_DateTime_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RequiredChannelUsers'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'RequiredChannelUsers', schema: 'dbo' });
  },
};
