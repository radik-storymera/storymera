import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPool } from './db.ts';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import {importContent} from './import-content.ts';
export async function migrate(pool: Pool) {
 const connection = await pool.getConnection();
 try {
  const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(), ':migrate'), 30) AS acquired");
  if (lock[0]?.acquired !== 1) throw new Error('Migration lock unavailable');
  await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  for (const name of (await readdir('migrations')).filter(n => n.endsWith('.sql')).sort()) {
   const sql = await readFile(`migrations/${name}`, 'utf8');
   const checksum = createHash('sha256').update(sql).digest('hex');
   const [rows] = await connection.query<RowDataPacket[]>('SELECT checksum FROM schema_migrations WHERE name=?', [name]);
   if (rows.length) { if (rows[0].checksum !== checksum) throw new Error('Applied migration was modified'); continue; }
   for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(statement);
   if(name==='002_content.sql')await importContent(pool);
   await connection.query('INSERT INTO schema_migrations(name,checksum) VALUES(?,?)',[name,checksum]);
  }
 } finally { await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':migrate'))"); connection.release(); }
}
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
 const pool = createPool(process.argv.includes('--test'));
 try { await migrate(pool); console.log('Migrations applied.'); } catch { console.error('Migration failed. Check local DB configuration.'); process.exitCode=1; } finally { await pool.end(); }
}
