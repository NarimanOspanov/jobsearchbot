'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const [rows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ClientMentors'`
    );
    if (rows.length > 0) return;

    await qi.createTable({ tableName: 'ClientMentors', schema: 'dbo' }, {
      Id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      MentorUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ClientUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      CreatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('GETUTCDATE()'),
      },
    });

    await qi.addIndex({ tableName: 'ClientMentors', schema: 'dbo' }, ['MentorUserId'], {
      name: 'ClientMentors_MentorUserId_idx',
    });
    await qi.addIndex({ tableName: 'ClientMentors', schema: 'dbo' }, ['MentorUserId', 'ClientUserId'], {
      unique: true,
      name: 'UQ_ClientMentors_MentorUserId_ClientUserId',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'ClientMentors', schema: 'dbo' });
  },
};
