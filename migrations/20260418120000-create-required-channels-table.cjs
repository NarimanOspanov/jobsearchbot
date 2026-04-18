'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RequiredChannels'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'RequiredChannels', schema: 'dbo' }, {
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
      JoinUrl: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      IsActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      SortOrder: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      CreatedAtUtc: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'RequiredChannels', schema: 'dbo' }, ['ChannelId'], {
      unique: true,
      name: 'UQ_RequiredChannels_ChannelId',
    });
    await qi.addIndex({ tableName: 'RequiredChannels', schema: 'dbo' }, ['IsActive', 'SortOrder'], {
      name: 'RequiredChannels_IsActive_SortOrder_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RequiredChannels'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'RequiredChannels', schema: 'dbo' });
  },
};
