'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [notificationsRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AdminNotifications'`
    );
    if (notificationsRows.length === 0) {
      await qi.createTable({ tableName: 'AdminNotifications', schema: 'dbo' }, {
        Id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false,
        },
        RunId: {
          type: Sequelize.STRING(36),
          allowNull: true,
        },
        InitiatorChatId: {
          type: Sequelize.BIGINT,
          allowNull: false,
        },
        Text: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        ReceiverType: {
          type: Sequelize.STRING(10),
          allowNull: false,
        },
        ReceiverChatId: {
          type: Sequelize.BIGINT,
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
        CreatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
        UpdatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
        SentAt: {
          type: Sequelize.DATE,
          allowNull: true,
        },
      });
      await qi.addIndex({ tableName: 'AdminNotifications', schema: 'dbo' }, ['RunId', 'CreatedAt'], {
        name: 'AdminNotifications_RunId_CreatedAt_idx',
      });
      await qi.addIndex({ tableName: 'AdminNotifications', schema: 'dbo' }, ['InitiatorChatId', 'CreatedAt'], {
        name: 'AdminNotifications_InitiatorChatId_CreatedAt_idx',
      });
      await qi.addIndex({ tableName: 'AdminNotifications', schema: 'dbo' }, ['ReceiverChatId', 'CreatedAt'], {
        name: 'AdminNotifications_ReceiverChatId_CreatedAt_idx',
      });
      await qi.addIndex({ tableName: 'AdminNotifications', schema: 'dbo' }, ['Status', 'CreatedAt'], {
        name: 'AdminNotifications_Status_CreatedAt_idx',
      });
    }

    const [runsRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AdminNotificationRuns'`
    );
    if (runsRows.length === 0) {
      await qi.createTable({ tableName: 'AdminNotificationRuns', schema: 'dbo' }, {
        Id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false,
        },
        InitiatorChatId: {
          type: Sequelize.BIGINT,
          allowNull: false,
        },
        Text: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        Total: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        Processed: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        Sent: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        Failed: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        Status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'running',
        },
        StopRequestedAt: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        StartedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
        StoppedAt: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        FinishedAt: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        CreatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
        UpdatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
      });
      await qi.addIndex({ tableName: 'AdminNotificationRuns', schema: 'dbo' }, ['Status', 'StartedAt'], {
        name: 'AdminNotificationRuns_Status_StartedAt_idx',
      });
      await qi.addIndex({ tableName: 'AdminNotificationRuns', schema: 'dbo' }, ['InitiatorChatId', 'StartedAt'], {
        name: 'AdminNotificationRuns_InitiatorChatId_StartedAt_idx',
      });
      await qi.addIndex({ tableName: 'AdminNotificationRuns', schema: 'dbo' }, ['CreatedAt'], {
        name: 'AdminNotificationRuns_CreatedAt_idx',
      });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const targets = ['AdminNotifications', 'AdminNotificationRuns'];
    for (const name of targets) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${name}'`
      );
      if (rows.length > 0) {
        await qi.dropTable({ tableName: name, schema: 'dbo' });
      }
    }
  },
};
