'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserApplications'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'UserApplications', schema: 'dbo' }, {
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
      PositionId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: { tableName: 'Positions', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      DateTime: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'UserApplications', schema: 'dbo' }, ['UserId', 'DateTime'], {
      name: 'UserApplications_UserId_DateTime_idx',
    });
    await qi.addIndex({ tableName: 'UserApplications', schema: 'dbo' }, ['PositionId', 'DateTime'], {
      name: 'UserApplications_PositionId_DateTime_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserApplications'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'UserApplications', schema: 'dbo' });
  },
};
