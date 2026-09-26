import fs from 'node:fs';
import {createPool} from './db.ts';

export async function migrateSourceAnalytics(test=process.argv.includes('--test')){
 const pool=createPool(test);
 try{
  const sql=fs.readFileSync('analytics-migrations/001_source_behavior_analytics.sql','utf8');
  for(const statement of sql.split(/;\s*(?:\r?\n|$)/).map(value=>value.trim()).filter(Boolean))await pool.query(statement);
 }finally{await pool.end();}
}
if(process.argv[1]?.endsWith('migrate-source-analytics.ts')||process.argv[1]?.endsWith('migrate-source-analytics.js'))await migrateSourceAnalytics();
