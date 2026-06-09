'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = { tableName: 'PublisherSignups', schema: 'dbo' };

    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PublisherSignups'`
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
      Publisher: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      PublishedIn: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      PositionId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: { tableName: 'Positions', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
      name: 'PublisherSignups_UserId_uq',
      unique: true,
    });
    await qi.addIndex(table, ['Publisher', 'PublishedIn', 'SignedUpAt'], {
      name: 'PublisherSignups_Publisher_PublishedIn_SignedUpAt_idx',
    });
    await qi.addIndex(table, ['PositionId', 'SignedUpAt'], {
      name: 'PublisherSignups_PositionId_SignedUpAt_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PublisherSignups'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'PublisherSignups', schema: 'dbo' });
  },
};
