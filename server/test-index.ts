// Local browser verification only: isolated test database and localhost.
import {createApp} from './app.ts';
import {createPool} from './db.ts';
const pool=createPool(true);
createApp(pool,'http://localhost:5175').listen(3002,'127.0.0.1',()=>console.log('Test API listening on http://127.0.0.1:3002'));
