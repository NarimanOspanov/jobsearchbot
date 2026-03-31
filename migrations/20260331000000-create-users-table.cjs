'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'Users', schema: 'dbo' },
      {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        TelegramUserName: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        TelegramChatId: {
          type: Sequelize.BIGINT,
          allowNull: false,
          unique: true,
        },
        DateJoined: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        Promocode: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        IsBlocked: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        MuteBotUntil: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        Timezone: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        HhEnabled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        LinkedInEnabled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        IndeedEnabled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        CompanySitesEnabled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        EmailFoundersEnabled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        EmailRecruitersEnabled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      }
    );

    await queryInterface.addIndex(
      { tableName: 'Users', schema: 'dbo' },
      ['TelegramChatId'],
      { unique: true, name: 'Users_TelegramChatId_unique' }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'Users', schema: 'dbo' });
  },
};
