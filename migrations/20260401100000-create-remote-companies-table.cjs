'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanies'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'RemoteCompanies', schema: 'dbo' }, {
      Id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      Url: {
        type: Sequelize.STRING(1024),
        allowNull: false,
      },
      DateAdded: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });
    await qi.addIndex({ tableName: 'RemoteCompanies', schema: 'dbo' }, ['DateAdded'], {
      name: 'IX_RemoteCompanies_DateAdded',
    });
    await qi.addIndex({ tableName: 'RemoteCompanies', schema: 'dbo' }, ['Url'], {
      unique: true,
      name: 'UQ_RemoteCompanies_Url',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanies'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'RemoteCompanies', schema: 'dbo' });
  },
};
