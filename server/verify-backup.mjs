import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
const root=process.cwd(), bin=path.join(root,'.runtime/mysql-8.4.11-winx64/bin');
const source=process.env.DB_NAME;
if(!source || !/^[a-zA-Z0-9_]+$/.test(source))throw Error('Invalid database name');
const stamp=Date.now(), target=`jessica_restore_${stamp}`;
fs.mkdirSync('.local/backups',{recursive:true});
const dump=path.resolve(`.local/backups/verified-${stamp}.sql`),config=path.resolve(`.local/backups/client-${randomUUID()}.cnf`);
const password=fs.readFileSync('.local/mysql-root.txt','utf8').trim();
let connection;
async function run(exe,args,input,output){
 await new Promise((resolve,reject)=>{const p=spawn(path.join(bin,exe),[`--defaults-extra-file=${config}`,...args],{stdio:[input,output,'ignore'],windowsHide:true});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error('Database backup/restore command failed')));});
}
try{
 fs.writeFileSync(config,`[client]\nuser=root\npassword=${password}\nhost=127.0.0.1\nport=3307\n`,{flag:'wx'});
 connection=await mysql.createConnection({host:'127.0.0.1',port:3307,user:'root',password});
 const out=fs.openSync(dump,'wx');
 try{await run('mysqldump.exe',['--single-transaction','--set-gtid-purged=OFF','--skip-add-locks',source],'ignore',out);}finally{fs.closeSync(out);}
 await connection.query(`CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4`);
 const input=fs.openSync(dump,'r');try{await run('mysql.exe',[target],input,'ignore');}finally{fs.closeSync(input);}
 const [tables]=await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=? ORDER BY TABLE_NAME',[source,'BASE TABLE']);
 for(const table of tables){
  const name=table.TABLE_NAME;if(!/^[a-zA-Z0-9_]+$/.test(name))throw Error('Unsupported table name');
  const hashes=[];
  for(const db of [source,target]){
   const [rows]=await connection.query(`SELECT * FROM \`${db}\`.\`${name}\``);
   hashes.push(createHash('sha256').update(JSON.stringify(rows.map(r=>JSON.stringify(r)).sort())).digest('hex'));
  }
  if(hashes[0]!==hashes[1])throw Error('Restore verification mismatch; do not migrate');
 }
 await connection.query(`DROP DATABASE \`${target}\``);
 fs.writeFileSync('.local/backups/last-verified.json',JSON.stringify({dump,restoreDatabase:target,temporaryDatabaseRemoved:true,tables:tables.length,verifiedAt:new Date().toISOString()},null,2));
 console.log(`Backup and independent restore verified: ${tables.length} tables. Temporary database removed; backup kept in .local/backups.`);
}catch{console.error('Backup/restore verification failed. No working schema was changed. Do not migrate.');process.exitCode=1;}
finally{if(connection)await connection.end();if(fs.existsSync(config))fs.unlinkSync(config);}
