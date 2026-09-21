import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
if (fs.existsSync('.env') || fs.existsSync('.local/mysql-data')) throw new Error('Local setup already exists; refusing to overwrite.');
const root=randomBytes(32).toString('hex'), app=randomBytes(32).toString('hex'), test=randomBytes(32).toString('hex');
fs.writeFileSync('.local/mysql-root.txt',root,{flag:'wx'});
fs.writeFileSync('.env',`DB_HOST=127.0.0.1\nDB_PORT=3307\nDB_NAME=jessica_stories\nDB_USER=jessica_app\nDB_PASSWORD=${app}\nTEST_DB_NAME=jessica_stories_test\nTEST_DB_USER=jessica_test\nTEST_DB_PASSWORD=${test}\nAPP_ORIGIN=http://localhost:5173\nAPI_PORT=3001\nNODE_ENV=development\n`,{flag:'wx'});
fs.writeFileSync('.local/mysql-init.sql',`ALTER USER 'root'@'localhost' IDENTIFIED BY '${root}';\nCREATE DATABASE jessica_stories CHARACTER SET utf8mb4;\nCREATE DATABASE jessica_stories_test CHARACTER SET utf8mb4;\nCREATE USER 'jessica_app'@'localhost' IDENTIFIED BY '${app}';\nCREATE USER 'jessica_test'@'localhost' IDENTIFIED BY '${test}';\nGRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON jessica_stories.* TO 'jessica_app'@'localhost';\nGRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON jessica_stories_test.* TO 'jessica_test'@'localhost';\n`,{flag:'wx'});
console.log('Local credentials created without printing secrets.');
