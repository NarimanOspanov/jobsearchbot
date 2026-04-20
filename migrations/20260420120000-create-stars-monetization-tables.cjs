'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    const [plansRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Plans'`
    );
    if (plansRows.length === 0) {
      await qi.createTable({ tableName: 'Plans', schema: 'dbo' }, {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        Code: {
          type: Sequelize.STRING(32),
          allowNull: false,
        },
        Name: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        PriceInStars: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        DurationDays: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 30,
        },
        JobOpenMonthlyLimit: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        IncludesAiTools: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
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
      });
      await qi.addIndex({ tableName: 'Plans', schema: 'dbo' }, ['Code'], {
        unique: true,
        name: 'UQ_Plans_Code',
      });
      await qi.addIndex({ tableName: 'Plans', schema: 'dbo' }, ['IsActive', 'SortOrder'], {
        name: 'Plans_IsActive_SortOrder_idx',
      });
    }

    // Idempotent default plans for Silver/Gold.
    await qi.sequelize.query(
      `IF NOT EXISTS (SELECT 1 FROM dbo.Plans WHERE Code = 'silver')
         INSERT INTO dbo.Plans (Code, Name, PriceInStars, DurationDays, JobOpenMonthlyLimit, IncludesAiTools, IsActive, SortOrder)
         VALUES ('silver', 'Silver', 500, 30, 300, 0, 1, 10);`
    );
    await qi.sequelize.query(
      `IF NOT EXISTS (SELECT 1 FROM dbo.Plans WHERE Code = 'gold')
         INSERT INTO dbo.Plans (Code, Name, PriceInStars, DurationDays, JobOpenMonthlyLimit, IncludesAiTools, IsActive, SortOrder)
         VALUES ('gold', 'Gold', 1000, 30, 1000, 1, 1, 20);`
    );

    const [paymentsRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TelegramPayments'`
    );
    if (paymentsRows.length === 0) {
      await qi.createTable({ tableName: 'TelegramPayments', schema: 'dbo' }, {
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
        PlanId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Plans', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'NO ACTION',
        },
        TelegramPaymentChargeId: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        ProviderPaymentChargeId: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        InvoicePayload: {
          type: Sequelize.STRING(500),
          allowNull: false,
        },
        StarsAmount: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        Currency: {
          type: Sequelize.STRING(10),
          allowNull: false,
          defaultValue: 'XTR',
        },
        Status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'completed',
        },
        PaidAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
      });
      await qi.addIndex({ tableName: 'TelegramPayments', schema: 'dbo' }, ['TelegramPaymentChargeId'], {
        unique: true,
        name: 'UQ_TelegramPayments_TelegramPaymentChargeId',
      });
      await qi.addIndex({ tableName: 'TelegramPayments', schema: 'dbo' }, ['UserId', 'PaidAt'], {
        name: 'TelegramPayments_UserId_PaidAt_idx',
      });
      await qi.addIndex({ tableName: 'TelegramPayments', schema: 'dbo' }, ['PlanId', 'PaidAt'], {
        name: 'TelegramPayments_PlanId_PaidAt_idx',
      });
    }

    const [subscriptionsRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserSubscriptions'`
    );
    if (subscriptionsRows.length === 0) {
      await qi.createTable({ tableName: 'UserSubscriptions', schema: 'dbo' }, {
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
        PlanId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Plans', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'NO ACTION',
        },
        TelegramPaymentId: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: { tableName: 'TelegramPayments', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        StartsAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        EndsAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        Status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'active',
        },
        CreatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
      });
      await qi.addIndex({ tableName: 'UserSubscriptions', schema: 'dbo' }, ['UserId', 'Status', 'EndsAt'], {
        name: 'UserSubscriptions_UserId_Status_EndsAt_idx',
      });
      await qi.addIndex({ tableName: 'UserSubscriptions', schema: 'dbo' }, ['PlanId', 'Status'], {
        name: 'UserSubscriptions_PlanId_Status_idx',
      });
    }

    const [bonusRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserBonusOpens'`
    );
    if (bonusRows.length === 0) {
      await qi.createTable({ tableName: 'UserBonusOpens', schema: 'dbo' }, {
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
        Source: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        OpensGranted: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        Note: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        CreatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
      });
      await qi.addIndex({ tableName: 'UserBonusOpens', schema: 'dbo' }, ['UserId', 'CreatedAt'], {
        name: 'UserBonusOpens_UserId_CreatedAt_idx',
      });
      await qi.addIndex({ tableName: 'UserBonusOpens', schema: 'dbo' }, ['Source', 'CreatedAt'], {
        name: 'UserBonusOpens_Source_CreatedAt_idx',
      });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const targets = ['UserBonusOpens', 'UserSubscriptions', 'TelegramPayments', 'Plans'];
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
