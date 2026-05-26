'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = { tableName: 'UserApplications', schema: 'dbo' };

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserApplications' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (!(await hasColumn('Publisher'))) {
      await qi.addColumn(table, 'Publisher', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    if (!(await hasColumn('PublishedIn'))) {
      await qi.addColumn(table, 'PublishedIn', {
        type: Sequelize.BIGINT,
        allowNull: true,
      });
    }

    const [idxRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM sys.indexes i
       INNER JOIN sys.tables t ON i.object_id = t.object_id
       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = 'dbo' AND t.name = 'UserApplications'
         AND i.name = 'UserApplications_Publisher_PublishedIn_DateTime_idx'`
    );
    if (idxRows.length === 0) {
      await qi.addIndex(table, ['Publisher', 'PublishedIn', 'DateTime'], {
        name: 'UserApplications_Publisher_PublishedIn_DateTime_idx',
      });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const table = { tableName: 'UserApplications', schema: 'dbo' };

    const [idxRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM sys.indexes i
       INNER JOIN sys.tables t ON i.object_id = t.object_id
       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = 'dbo' AND t.name = 'UserApplications'
         AND i.name = 'UserApplications_Publisher_PublishedIn_DateTime_idx'`
    );
    if (idxRows.length > 0) {
      await qi.removeIndex(table, 'UserApplications_Publisher_PublishedIn_DateTime_idx');
    }

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserApplications' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (await hasColumn('PublishedIn')) await qi.removeColumn(table, 'PublishedIn');
    if (await hasColumn('Publisher')) await qi.removeColumn(table, 'Publisher');
  },
};
