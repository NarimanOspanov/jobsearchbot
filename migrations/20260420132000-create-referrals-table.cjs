'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Referrals'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'Referrals', schema: 'dbo' }, {
      Id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      ReferrerUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ReferredUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ReferredAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'Referrals', schema: 'dbo' }, ['ReferrerUserId'], {
      name: 'Referrals_ReferrerUserId_idx',
    });
    await qi.addIndex({ tableName: 'Referrals', schema: 'dbo' }, ['ReferredUserId'], {
      name: 'Referrals_ReferredUserId_idx',
    });
    await qi.addIndex({ tableName: 'Referrals', schema: 'dbo' }, ['ReferrerUserId', 'ReferredUserId'], {
      unique: true,
      name: 'UQ_Referrals_ReferrerUserId_ReferredUserId',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Referrals'`
    );
    if (rows.length === 0) return;
    await qi.dropTable({ tableName: 'Referrals', schema: 'dbo' });
  },
};
