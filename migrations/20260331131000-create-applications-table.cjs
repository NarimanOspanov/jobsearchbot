'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'Applications', schema: 'dbo' },
      {
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
        VacancyTitle: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        CompanyName: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        Source: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        Status: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        AppliedAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        Notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        MetaJson: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
      }
    );

    await queryInterface.addIndex(
      { tableName: 'Applications', schema: 'dbo' },
      ['UserId', 'AppliedAt'],
      { name: 'Applications_UserId_AppliedAt_idx' }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'Applications', schema: 'dbo' });
  },
};
