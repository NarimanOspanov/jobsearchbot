'use strict';

require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });

const db = {
  host: process.env.DB_HOST || 'sql-hr-prod.database.windows.net',
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  database: process.env.DB_NAME || 'sql-job-search',
  username: process.env.DB_USER || 'hradmin',
  password: process.env.DB_PASSWORD || 'QUESTZXC123asd',
  dialect: 'mssql',
  dialectOptions: {
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  },
  logging: false,
};

module.exports = {
  development: db,
  test: db,
  production: db,
};
