'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    const [userColRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'HhCookies'`
    );
    if (!userColRows.length) {
      await qi.addColumn({ tableName: 'Users', schema: 'dbo' }, 'HhCookies', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    const [tableRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserHhSearchUrls'`
    );
    if (tableRows.length) return;

    await qi.createTable({ tableName: 'UserHhSearchUrls', schema: 'dbo' }, {
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
      SearchURL: {
        type: Sequelize.STRING(2048),
        allowNull: false,
      },
      CreatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'UserHhSearchUrls', schema: 'dbo' }, ['UserId'], {
      name: 'UserHhSearchUrls_UserId_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'UserHhSearchUrls', schema: 'dbo' });
    await queryInterface.removeColumn({ tableName: 'Users', schema: 'dbo' }, 'HhCookies');
  },
};
