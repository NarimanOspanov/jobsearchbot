'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const uaTable = { tableName: 'UserApplications', schema: 'dbo' };

    async function uaHasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserApplications' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (!(await uaHasColumn('Status'))) {
      await qi.addColumn(uaTable, 'Status', {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'pending_screening',
      });
    }

    if (!(await uaHasColumn('ScreeningResponseDueAt'))) {
      await qi.addColumn(uaTable, 'ScreeningResponseDueAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    const [statusIdx] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM sys.indexes i
       INNER JOIN sys.tables t ON i.object_id = t.object_id
       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = 'dbo' AND t.name = 'UserApplications'
         AND i.name = 'UserApplications_Status_ScreeningResponseDueAt_idx'`
    );
    if (statusIdx.length === 0) {
      await qi.addIndex(uaTable, ['Status', 'ScreeningResponseDueAt'], {
        name: 'UserApplications_Status_ScreeningResponseDueAt_idx',
      });
    }

    const [outreachExists] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserApplicationOutreach'`
    );
    if (outreachExists.length === 0) {
      await qi.createTable({ tableName: 'UserApplicationOutreach', schema: 'dbo' }, {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        UserApplicationId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'UserApplications', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        UserId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        MessageType: {
          type: Sequelize.STRING(32),
          allowNull: false,
        },
        Language: {
          type: Sequelize.STRING(10),
          allowNull: false,
        },
        Text: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        ReplyMarkupJson: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        Status: {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        Error: {
          type: Sequelize.STRING(500),
          allowNull: true,
        },
        TelegramMessageId: {
          type: Sequelize.BIGINT,
          allowNull: true,
        },
        SentAt: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        CreatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
      });

      await qi.addIndex(
        { tableName: 'UserApplicationOutreach', schema: 'dbo' },
        ['UserApplicationId', 'MessageType'],
        { unique: true, name: 'UQ_UserApplicationOutreach_App_MessageType' }
      );
      await qi.addIndex(
        { tableName: 'UserApplicationOutreach', schema: 'dbo' },
        ['CreatedAt'],
        { name: 'UserApplicationOutreach_CreatedAt_idx' }
      );
    }

    const [configRows] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM dbo.Configs WHERE [Key] = 'PositionApplyScreeningResponseDays'`
    );
    if (configRows.length === 0) {
      await qi.bulkInsert(
        { tableName: 'Configs', schema: 'dbo' },
        [
          {
            Key: 'PositionApplyScreeningResponseDays',
            Value: '3',
            Description: 'Days until default screening response (rejection) is sent to applicants',
            UpdatedAt: new Date(),
          },
        ]
      );
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;

    await qi.bulkDelete(
      { tableName: 'Configs', schema: 'dbo' },
      { Key: 'PositionApplyScreeningResponseDays' }
    );

    const [outreachExists] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserApplicationOutreach'`
    );
    if (outreachExists.length > 0) {
      await qi.dropTable({ tableName: 'UserApplicationOutreach', schema: 'dbo' });
    }

    const uaTable = { tableName: 'UserApplications', schema: 'dbo' };
    const [statusIdx] = await qi.sequelize.query(
      `SELECT 1 AS ok FROM sys.indexes i
       INNER JOIN sys.tables t ON i.object_id = t.object_id
       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = 'dbo' AND t.name = 'UserApplications'
         AND i.name = 'UserApplications_Status_ScreeningResponseDueAt_idx'`
    );
    if (statusIdx.length > 0) {
      await qi.removeIndex(uaTable, 'UserApplications_Status_ScreeningResponseDueAt_idx');
    }

    async function uaHasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserApplications' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }
    if (await uaHasColumn('ScreeningResponseDueAt')) {
      await qi.removeColumn(uaTable, 'ScreeningResponseDueAt');
    }
    if (await uaHasColumn('Status')) {
      await qi.removeColumn(uaTable, 'Status');
    }
  },
};
