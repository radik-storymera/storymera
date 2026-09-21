import {createPool} from './db.ts';
import type {ResultSetHeader} from 'mysql2/promise';
const email=process.argv[2]?.trim().toLowerCase();
if(!email||!email.includes('@')){console.error('Usage: npm.cmd run admin:grant -- existing-email');process.exitCode=1;}
else {const pool=createPool();try{const [r]=await pool.execute<ResultSetHeader>("UPDATE users SET role='admin' WHERE email=?",[email]);console.log(r.affectedRows?'Administrator role assigned to the existing account.':'No existing account matched. Register locally first.');if(!r.affectedRows)process.exitCode=1;}catch{console.error('Role assignment failed. Check database/migrations.');process.exitCode=1;}finally{await pool.end();}}
