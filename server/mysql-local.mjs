import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';
const root=process.cwd(),base=path.join(root,'.runtime/mysql-8.4.11-winx64'),data=path.join(root,'.local/mysql-data');
if(!fs.existsSync(path.join(base,'bin/mysqld.exe'))||!fs.existsSync(data))throw new Error('Local MySQL has not been initialized. See README.');
const action=process.argv[2];
if(action==='start'){
 const child=spawn(path.join(base,'bin/mysqld.exe'),['--no-defaults',`--basedir=${base}`,`--datadir=${data}`,'--bind-address=127.0.0.1','--port=3307','--mysqlx=0',`--log-error=${path.join(root,'.local/mysql.log')}`],{stdio:'inherit',windowsHide:true});
 child.on('exit',code=>{process.exitCode=code??1;});
}else if(action==='stop'){
 const connection=await mysql.createConnection({host:'127.0.0.1',port:3307,user:'root',password:fs.readFileSync('.local/mysql-root.txt','utf8')});
 try{await connection.query('SHUTDOWN');console.log('Local MySQL stopped.');}finally{await connection.end();}
}else if(action==='backup'){
 fs.mkdirSync('.local/backups',{recursive:true});
 const config=path.join(root,'.local/backup-client.cnf');
 if(fs.existsSync(config))throw new Error('Temporary backup configuration already exists.');
 fs.writeFileSync(config,`[client]\nuser=root\npassword=${fs.readFileSync('.local/mysql-root.txt','utf8')}\nhost=127.0.0.1\nport=3307\n`,{flag:'wx'});
 const output=path.join(root,'.local/backups',new Date().toISOString().replace(/[:.]/g,'-')+'.sql');
 const file=fs.openSync(output,'wx');
 const child=spawn(path.join(base,'bin/mysqldump.exe'),[`--defaults-extra-file=${config}`,'--single-transaction','--set-gtid-purged=OFF','--databases','jessica_stories'],{stdio:['ignore',file,'ignore'],windowsHide:true});
 child.on('exit',code=>{fs.closeSync(file);fs.unlinkSync(config);if(code){console.error('Backup failed; inspect the incomplete backup file.');process.exitCode=1;}else console.log('Backup created in .local/backups.');});
}else throw new Error('Use start, stop or backup.');
