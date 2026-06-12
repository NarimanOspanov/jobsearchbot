'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = { tableName: 'Applications', schema: 'dbo' };

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Applications' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    if (!(await hasColumn('AgentUserId'))) {
      await qi.addColumn(table, 'AgentUserId', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    const [idxRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM sys.indexes i
       INNER JOIN sys.tables t ON i.object_id = t.object_id
       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = 'dbo' AND t.name = 'Applications'
         AND i.name = 'Applications_AgentUserId_AppliedAt_idx'`
    );
    if (idxRows.length === 0) {
      await qi.addIndex(table, ['AgentUserId', 'AppliedAt'], {
        name: 'Applications_AgentUserId_AppliedAt_idx',
      });
    }

    // Best-effort backfill for legacy applied rows (current assignment at migration time).
    await qi.sequelize.query(`
      UPDATE a
      SET a.AgentUserId = ac.AgentUserId
      FROM dbo.Applications AS a
      INNER JOIN dbo.AgentClients AS ac ON ac.ClientUserId = a.UserId
      WHERE a.AgentUserId IS NULL
        AND LOWER(LTRIM(RTRIM(a.Status))) = 'applied'
    `);
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const table = { tableName: 'Applications', schema: 'dbo' };

    async function hasColumn(columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Applications' AND COLUMN_NAME = :columnName`,
        { replacements: { columnName } }
      );
      return rows.length > 0;
    }

    const [idxRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM sys.indexes i
       INNER JOIN sys.tables t ON i.object_id = t.object_id
       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = 'dbo' AND t.name = 'Applications'
         AND i.name = 'Applications_AgentUserId_AppliedAt_idx'`
    );
    if (idxRows.length > 0) {
      await qi.removeIndex(table, 'Applications_AgentUserId_AppliedAt_idx');
    }

    if (await hasColumn('AgentUserId')) {
      await qi.removeColumn(table, 'AgentUserId');
    }
  },
};
