import test from 'node:test';
import assert from 'node:assert/strict';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {RowDataPacket} from 'mysql2/promise';
import argon2 from 'argon2';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {createApp} from '../server/app.ts';

const run=promisify(execFile),adminEmail='od.radik@gmail.com',password='123456';

test('idempotent cleanup keeps Jessica and the administrator while resetting test statistics',async()=>{
 let pool=createPool(true);await migrate(pool);const adminId=randomUUID(),readerId=randomUUID(),suffix=randomUUID().slice(0,8),hero=`cleanup-${suffix}`,chapter=`cleanup-chapter-${suffix}`,hash=await argon2.hash(password);
 try{
  await pool.execute("INSERT INTO users(id,email,password_hash,role,key_balance) VALUES(?,?,?,'admin',30) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),role='admin',key_balance=30",[adminId,adminEmail,hash]);
  const [admins]=await pool.execute<RowDataPacket[]>('SELECT id FROM users WHERE LOWER(email)=?',[adminEmail]);const actualAdmin=String(admins[0].id);
  await pool.execute("INSERT INTO users(id,email,password_hash,role) VALUES(?,?,?,'reader')",[readerId,`cleanup-${suffix}@example.test`,hash]);
  await pool.execute('INSERT INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[hero,'Cleanup fixture','Test only',JSON.stringify({type:'image',src:'/media/arrival.svg',alt:'Fixture'})]);
  await pool.execute('INSERT INTO chapters(id,heroine_id,title,description,published_revision) VALUES(?,?,?,?,1)',[chapter,hero,'Fixture chapter','Test only']);
  await pool.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,1,'published',?)",[chapter,JSON.stringify({chapter:{id:chapter,heroineId:hero,revision:1,title:'Fixture',subtitle:'',description:'',firstScene:'one',freeSteps:1},scenes:{one:{id:'one',step:1,type:'story',title:'One',text:'Test',final:true,media:{type:'image',src:'/media/arrival.svg',alt:'Fixture'},actions:[]}}})]);
  const [polls]=await pool.execute<RowDataPacket[]>('SELECT p.id,(SELECT id FROM poll_options WHERE poll_id=p.id ORDER BY sort_order,id LIMIT 1) option_id FROM polls p ORDER BY p.id LIMIT 1');
  if(polls[0]?.option_id){await pool.execute('DELETE FROM poll_votes WHERE poll_id=? AND user_id=?',[polls[0].id,actualAdmin]);await pool.execute('INSERT INTO poll_votes(poll_id,option_id,user_id) VALUES(?,?,?)',[polls[0].id,polls[0].option_id,actualAdmin]);await pool.execute('INSERT INTO poll_views(poll_id,user_id) VALUES(?,?)',[polls[0].id,actualAdmin]);}
  await pool.execute("INSERT INTO plan_analytics_events(id,user_id,event_type,user_key_balance,source) VALUES(?,?,'plans_page_viewed',30,'profile')",[randomUUID(),actualAdmin]);
  await pool.end();
  const result=await run('C:\\Program Files\\nodejs\\node.exe',['--experimental-strip-types','server/cleanup-test-data.ts','--test','--apply'],{cwd:process.cwd(),windowsHide:true});assert.match(result.stdout,/"database": "test"/);
  pool=createPool(true);
  const [[userCount],[storyCount],[admin],[votes],[views],[progress],[plans]]:any=await Promise.all([
   pool.query('SELECT COUNT(*) n FROM users'),pool.query('SELECT COUNT(*) n FROM heroines'),pool.query('SELECT id,email,role,key_balance FROM users'),pool.query('SELECT COUNT(*) n FROM poll_votes'),pool.query('SELECT COUNT(*) n FROM poll_views'),pool.query('SELECT COUNT(*) n FROM poll_progress'),pool.query('SELECT COUNT(*) n FROM plan_analytics_events'),
  ]);
  assert.equal(Number(userCount[0].n),1);assert.equal(Number(storyCount[0].n),1);assert.equal(String(admin[0].email).toLowerCase(),adminEmail);assert.equal(admin[0].role,'admin');assert.equal(Number(admin[0].key_balance),30);assert.equal(Number(votes[0].n)+Number(views[0].n)+Number(progress[0].n)+Number(plans[0].n),0);
  const server=createApp(pool,'http://localhost:5173').listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));try{const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,csrfResponse=await fetch(base+'/api/csrf'),csrf=(await csrfResponse.json() as any).token;const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:'http://localhost:5173'},body:JSON.stringify({email:adminEmail,password})});assert.equal(login.status,200);assert.equal((await login.json() as any).user.role,'admin');}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  const second=await run('C:\\Program Files\\nodejs\\node.exe',['--experimental-strip-types','server/cleanup-test-data.ts','--test','--apply'],{cwd:process.cwd(),windowsHide:true});assert.match(second.stdout,/"mode": "apply"/);
 }finally{await pool.end().catch(()=>{});}
});
