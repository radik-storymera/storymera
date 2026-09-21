import 'dotenv/config';
import mysql from 'mysql2/promise';
export function createPool(test = false) {
  const name = test ? process.env.TEST_DB_NAME : process.env.DB_NAME;
  if (!name || (test && (!name.endsWith('_test') || name === process.env.DB_NAME))) throw new Error('Invalid database configuration');
  return mysql.createPool({ host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 3307), database: name, user: test ? process.env.TEST_DB_USER : process.env.DB_USER, password: test ? process.env.TEST_DB_PASSWORD : process.env.DB_PASSWORD, connectionLimit: 5, timezone: 'Z', multipleStatements: false });
}
