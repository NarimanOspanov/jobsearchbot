'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Positions'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'Positions', schema: 'dbo' }, {
      Id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('NEWID()'),
      },
      Title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      Description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      CompanyName: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      CompanyWebsite: {
        type: Sequelize.STRING(1024),
        allowNull: true,
      },
      DateCreated: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
      IsArchived: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    });

    await qi.addIndex({ tableName: 'Positions', schema: 'dbo' }, ['DateCreated'], {
      name: 'Positions_DateCreated_idx',
    });
    await qi.addIndex({ tableName: 'Positions', schema: 'dbo' }, ['IsArchived', 'DateCreated'], {
      name: 'Positions_IsArchived_DateCreated_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Positions'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'Positions', schema: 'dbo' });
  },
};
