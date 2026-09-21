import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server/app.ts';
import { createPool } from '../server/db.ts';
import { migrate } from '../server/migrate.ts';
import type { AddressInfo } from 'node:net';
import type { RowDataPacket } from 'mysql2/promise';
import {legacyFixture} from './legacy-fixture.ts';
legacyFixture();

test('production API trusts exactly one reverse-proxy hop',async()=>{
 const pool=createPool(true);try{const app=createApp(pool,'https://storymera.com',true);assert.equal(app.get('trust proxy'),1);}finally{await pool.end();}
});

test('MySQL integration: accounts, security, progress and concurrent writes',async()=>{
 const pool=createPool(true);await migrate(pool);
 const app=createApp(pool,'http://localhost:5173');
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const ids:string[]=[];
 function client(){const jar=new Map<string,string>();let csrf='';return {jar,async call(path:string,method='GET',body?:unknown,options:{origin?:string;csrf?:string}={}){
   const response=await fetch(base+'/api'+path,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'Content-Type':'application/json',Origin:options.origin??'http://localhost:5173','X-CSRF-Token':options.csrf??csrf},body:body===undefined?undefined:JSON.stringify(body)});
   for(const c of response.headers.getSetCookie()){const pair=c.split(';')[0];const at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
   const data=await response.json();if(path==='/csrf')csrf=data.token;return {status:response.status,data,headers:response.headers};
 }};}
 const a=client(),b=client(),otherBrowser=client();
 const suffix=randomBytes(6).toString('hex'),email=`reader-${suffix}@example.test`,password=randomBytes(20).toString('base64url');
 try{
  const health=await fetch(base+'/api/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});
  await a.call('/csrf');await b.call('/csrf');await otherBrowser.call('/csrf');
  // Refreshing CSRF in another tab must not invalidate the first tab's token.
  await b.call('/csrf');
  assert.equal((await a.call('/auth/register','POST',{email,password},{origin:'https://attacker.invalid'})).status,403);
  assert.equal((await a.call('/auth/register','POST',{email,password},{csrf:'bad'})).status,403);
  assert.equal((await a.call('/auth/register','POST',{email:'bad',password:'short'})).status,400);
  const tooShort=await a.call('/auth/register','POST',{email:`short-${suffix}@example.test`,password:'12345'});assert.equal(tooShort.status,400);assert.equal(tooShort.data.error,'Password must be at least 6 characters long.');
  const six=await a.call('/auth/register','POST',{email:`six-${suffix}@example.test`,password:'123456'});assert.equal(six.status,200);ids.push(six.data.user.id);await a.call('/auth/logout','POST',{});
  const registered=await a.call('/auth/register','POST',{email:` ${email.toUpperCase()} `,password});assert.equal(registered.status,200);const uid=registered.data.user.id;ids.push(uid);
  assert.equal(registered.data.user.email,email);assert.match(registered.headers.get('set-cookie')??'',/HttpOnly/i);
  assert.equal((await b.call('/auth/register','POST',{email,password})).status,409);
  assert.equal((await b.call('/auth/login','POST',{email,password:'incorrect-password'})).status,401);
  const second=await b.call('/auth/register','POST',{email:`other-${suffix}@example.test`,password});assert.equal(second.status,200);const bid=second.data.user.id;ids.push(bid);
  assert.equal((await a.call('/auth/me')).data.user.id,uid);
  assert.equal((await a.call('/progress','PUT',{account:uid,version:0,reset:true})).status,410);
  assert.equal((await a.call('/reading/state')).data.stories.jessica.mode,'unstarted');
  const opened=await a.call('/reading/open','POST',{heroineId:'jessica'});assert.equal(opened.status,200);assert.equal(opened.data.mode,'active');
  assert.equal((await b.call('/reading/chapter/first-day')).status,403);
  assert.equal((await a.call('/reading/advance','POST',{chapterId:'first-day',actionId:'next',version:1})).status,200);
  const cafe=(await a.call('/reading/advance','POST',{chapterId:'first-day',actionId:'next',version:2})).data.progress;
  assert.equal((await a.call('/reading/finish','POST',{chapterId:'first-day'})).status,409);
  assert.equal((await a.call('/reading/state')).data.stories.jessica.mode,'active');
  assert.equal((await a.call('/reading/advance','POST',{chapterId:'first-day',actionId:'missing',version:3})).status,400);
  assert.equal((await otherBrowser.call('/auth/login','POST',{email,password})).status,200);
  const restored=await otherBrowser.call('/reading/state');assert.deepEqual(restored.data.stories.jessica.progress,cafe);
  assert.equal((await a.call('/reading/advance','POST',{chapterId:'first-day',actionId:'next',version:3})).status,200);
  assert.equal((await otherBrowser.call('/reading/advance','POST',{chapterId:'first-day',actionId:'next',version:3})).status,409);
  assert.equal((await otherBrowser.call('/reading/state')).data.stories.jessica.version,4);
  const [rows]=await pool.query<RowDataPacket[]>('SELECT password_hash FROM users WHERE id=?',[uid]);assert.match(rows[0].password_hash,/^\$argon2id\$/);assert.notEqual(rows[0].password_hash,password);
  const stolenSession=a.jar.get('jessica_session')!;assert.equal((await a.call('/auth/logout','POST',{})).status,200);a.jar.set('jessica_session',stolenSession);assert.equal((await a.call('/auth/me')).data.user,null);
  assert.equal((await a.call('/reading/chapter/first-day')).status,401);
  assert.equal((await otherBrowser.call('/auth/me')).data.user.id,uid);
  for(let i=0;i<16;i++)await b.call('/auth/login','POST',{email,password:'wrong-password-long'});
  assert.equal((await b.call('/auth/login','POST',{email,password})).status,429);
 }finally{
  // Only generated users in the explicitly isolated test database are removed.
  for(const id of ids)await pool.execute('DELETE FROM users WHERE id=?',[id]);
  await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await pool.end();
 }
});

test('Unavailable DB returns a safe 503, without configuration or SQL',async()=>{
 const pool=createPool(true);await pool.end();const app=createApp(pool,'http://localhost:5173');const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const health=await fetch(base+'/api/health');assert.equal(health.status,503);assert.deepEqual(await health.json(),{status:'unavailable'});const res=await fetch(base+'/api/auth/me',{headers:{cookie:`jessica_session=${'a'.repeat(64)}`}});assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'Server unavailable. Your current path is kept on this device. Try again.'});}
 finally{await new Promise<void>(r=>server.close(()=>r()));}
});
