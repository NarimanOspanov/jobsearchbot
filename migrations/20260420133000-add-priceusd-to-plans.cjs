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
    if (plansRows.length === 0) return;

    const [columnRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Plans' AND COLUMN_NAME = 'PriceUsd'`
    );
    if (columnRows.length === 0) {
      await qi.addColumn(
        { tableName: 'Plans', schema: 'dbo' },
        'PriceUsd',
        {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: true,
        }
      );
    }

    await qi.sequelize.query(
      `UPDATE dbo.Plans
       SET PriceUsd = CASE
         WHEN PriceUsd IS NULL AND LOWER(Code) = 'silver' THEN CAST(10.00 AS DECIMAL(10,2))
         WHEN PriceUsd IS NULL AND LOWER(Code) = 'gold' THEN CAST(20.00 AS DECIMAL(10,2))
         WHEN PriceUsd IS NULL AND LOWER(Code) = 'premium' THEN CAST(20.00 AS DECIMAL(10,2))
         WHEN PriceUsd IS NULL THEN CAST(ROUND(CAST(PriceInStars AS DECIMAL(10,2)) / 50.0, 2) AS DECIMAL(10,2))
         ELSE PriceUsd
       END`
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const [columnRows] = await qi.sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Plans' AND COLUMN_NAME = 'PriceUsd'`
    );
    if (columnRows.length > 0) {
      await qi.removeColumn({ tableName: 'Plans', schema: 'dbo' }, 'PriceUsd');
    }
  },
};

