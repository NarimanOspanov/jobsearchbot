'use strict';

/**
 * Per-user opt-in preferences for remote-first companies:
 *   UserRemoteCompanyNotifies   — notify when matching positions appear
 *   UserRemoteCompanyAutoApplies — auto-apply on the user's behalf
 * Both are Users <-> RemoteCompanies join tables (composite PK).
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    const createJoinTable = async (tableName, pkName, ixName) => {
      const [exists] = await qi.sequelize.query(
        `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${tableName}'`
      );
      if (exists.length) return;
      await qi.createTable({ tableName, schema: 'dbo' }, {
        UserId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        RemoteCompanyId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'RemoteCompanies', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        CreatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
      });
      await qi.addConstraint(
        { tableName, schema: 'dbo' },
        { fields: ['UserId', 'RemoteCompanyId'], type: 'primary key', name: pkName }
      );
      await qi.addIndex({ tableName, schema: 'dbo' }, ['RemoteCompanyId'], { name: ixName });
    };

    await createJoinTable(
      'UserRemoteCompanyNotifies',
      'PK_UserRemoteCompanyNotifies',
      'IX_UserRemoteCompanyNotifies_RemoteCompanyId'
    );
    await createJoinTable(
      'UserRemoteCompanyAutoApplies',
      'PK_UserRemoteCompanyAutoApplies',
      'IX_UserRemoteCompanyAutoApplies_RemoteCompanyId'
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const dropIfExists = async (tableName) => {
      const [exists] = await qi.sequelize.query(
        `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${tableName}'`
      );
      if (exists.length) await qi.dropTable({ tableName, schema: 'dbo' });
    };
    await dropIfExists('UserRemoteCompanyAutoApplies');
    await dropIfExists('UserRemoteCompanyNotifies');
  },
};
