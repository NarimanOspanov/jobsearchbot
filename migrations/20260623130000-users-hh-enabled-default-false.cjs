'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;
    await qi.sequelize.query(`
      DECLARE @constraintName NVARCHAR(200);
      DECLARE @sql NVARCHAR(400);

      SELECT @constraintName = dc.name
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.default_object_id = dc.object_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.Users')
        AND c.name = N'HhEnabled';

      IF @constraintName IS NOT NULL
      BEGIN
        SET @sql = N'ALTER TABLE dbo.Users DROP CONSTRAINT ' + QUOTENAME(@constraintName);
        EXEC sp_executesql @sql;
      END

      ALTER TABLE dbo.Users ADD CONSTRAINT DF_Users_HhEnabled DEFAULT (0) FOR HhEnabled;
    `);
  },

  async down(queryInterface) {
    const qi = queryInterface;
    await qi.sequelize.query(`
      DECLARE @constraintName NVARCHAR(200);
      DECLARE @sql NVARCHAR(400);

      SELECT @constraintName = dc.name
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.default_object_id = dc.object_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.Users')
        AND c.name = N'HhEnabled';

      IF @constraintName IS NOT NULL
      BEGIN
        SET @sql = N'ALTER TABLE dbo.Users DROP CONSTRAINT ' + QUOTENAME(@constraintName);
        EXEC sp_executesql @sql;
      END

      ALTER TABLE dbo.Users ADD CONSTRAINT DF_Users_HhEnabled DEFAULT (1) FOR HhEnabled;
    `);
  },
};
