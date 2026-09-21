import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
const env=dotenv.parse(fs.readFileSync('.env'));
const secrets=[env.DB_PASSWORD,env.TEST_DB_PASSWORD,fs.readFileSync('.local/mysql-root.txt','utf8')].filter(Boolean);
function scan(dir){for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())scan(p);else if(/\.(js|html|css|map)$/.test(name)){const text=fs.readFileSync(p,'utf8');if(secrets.some(s=>text.includes(s)))throw new Error('Secret found in client build.');}}}
scan('dist');console.log('Client build secret scan passed. No secret values printed.');
