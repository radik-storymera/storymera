import { createPool } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { migrate } from '../server/migrate.ts';
const pool=createPool(true);await migrate(pool);
createApp(pool,'http://localhost:5175').listen(3002,'127.0.0.1',()=>console.log('Isolated test API: localhost:3002'));
