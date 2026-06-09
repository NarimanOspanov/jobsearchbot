'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = { tableName: 'CampaignSignups', schema: 'dbo' };

    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CampaignSignups'`
    );
    if (rows.length > 0) return;

    await qi.createTable(table, {
      Id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      UserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      CampaignSlug: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      StartPayload: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      SignedUpAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex(table, ['UserId'], {
      name: 'CampaignSignups_UserId_uq',
      unique: true,
    });
    await qi.addIndex(table, ['CampaignSlug', 'SignedUpAt'], {
      name: 'CampaignSignups_CampaignSlug_SignedUpAt_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CampaignSignups'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'CampaignSignups', schema: 'dbo' });
  },
};
