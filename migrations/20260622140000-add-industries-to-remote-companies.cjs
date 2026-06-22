'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    const [industryTable] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Industries'`
    );
    if (!industryTable.length) {
      await qi.createTable({ tableName: 'Industries', schema: 'dbo' }, {
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
        Slug: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        SortOrder: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
      });
      await qi.addIndex({ tableName: 'Industries', schema: 'dbo' }, ['Slug'], {
        unique: true,
        name: 'UQ_Industries_Slug',
      });
      await qi.addIndex({ tableName: 'Industries', schema: 'dbo' }, ['Name'], {
        unique: true,
        name: 'UQ_Industries_Name',
      });
    }

    const [linkTable] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanyIndustries'`
    );
    if (!linkTable.length) {
      await qi.createTable({ tableName: 'RemoteCompanyIndustries', schema: 'dbo' }, {
        RemoteCompanyId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'RemoteCompanies', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        IndustryId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Industries', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
      });
      await qi.addConstraint(
        { tableName: 'RemoteCompanyIndustries', schema: 'dbo' },
        {
          fields: ['RemoteCompanyId', 'IndustryId'],
          type: 'primary key',
          name: 'PK_RemoteCompanyIndustries',
        }
      );
      await qi.addIndex({ tableName: 'RemoteCompanyIndustries', schema: 'dbo' }, ['IndustryId'], {
        name: 'IX_RemoteCompanyIndustries_IndustryId',
      });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [linkTable] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RemoteCompanyIndustries'`
    );
    if (linkTable.length) {
      await qi.dropTable({ tableName: 'RemoteCompanyIndustries', schema: 'dbo' });
    }
    const [industryTable] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Industries'`
    );
    if (industryTable.length) {
      await qi.dropTable({ tableName: 'Industries', schema: 'dbo' });
    }
  },
};
