import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {RowDataPacket} from 'mysql2/promise';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {createApp} from '../server/app.ts';

test('chapter IDs and catalog order are managed on the test database',async()=>{
 const pool=createPool(true);await migrate(pool);
 const server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
 const suffix=randomUUID().slice(0,8),heroId='chapter-order-'+suffix;
 let userId='';const ids:string[]=[];const cookies=new Map<string,string>();let token='';
 async function call(url:string,method='GET',body?:unknown){
  const response=await fetch(base+url,{method,headers:{Origin:'http://localhost:5175','Content-Type':'application/json','X-CSRF-Token':token,cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
  const data=await response.json();if(url==='/csrf')token=data.token;
  return {status:response.status,data};
 }
 try{
  await call('/csrf');
  const registration=await call('/auth/register','POST',{email:`order-${suffix}@example.test`,password:randomUUID()});
  assert.equal(registration.status,200);userId=registration.data.user.id;
  await pool.execute("UPDATE users SET role='admin' WHERE id=?",[userId]);
  await pool.execute('INSERT INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[heroId,'Chapter order test','Test only',JSON.stringify({type:'image',src:'/media/jessica-city.jpg',alt:'Test'})]);
  for(const title of ['Same title','Same title','Last chapter']){
   const result=await call('/admin/chapters','POST',{heroineId:heroId,title});
   assert.equal(result.status,201,JSON.stringify(result.data));ids.push(result.data.id);
   assert.equal(result.data.display_order,ids.length-1);
  }
  assert.equal(new Set(ids).size,3);
  const initial=(await call('/admin/chapters?heroine='+heroId)).data;
  assert.deepEqual(initial.map((row:any)=>[row.id,row.display_order]),ids.map((id,index)=>[id,index]));
  const draft=await call(`/admin/chapters/${ids[0]}/draft`,'POST',{});
  draft.data.document.chapter.title='Renamed chapter';
  const saved=await call(`/admin/chapters/${ids[0]}/draft/1`,'PUT',{version:draft.data.edit_version,document:draft.data.document});
  assert.equal(saved.status,200,JSON.stringify(saved.data));
  const renamed=(await call('/admin/chapters?heroine='+heroId)).data;
  assert.equal(renamed[0].id,ids[0]);assert.equal(renamed[0].title,'Renamed chapter');
  const before=(await pool.execute<RowDataPacket[]>('SELECT chapter_id,revision,document FROM chapter_versions WHERE chapter_id IN (?,?,?) ORDER BY chapter_id,revision',ids))[0];
  assert.equal((await call(`/admin/chapters/${ids[2]}/move`,'PUT',{direction:-1})).status,200);
  const afterRefresh=(await call('/admin/chapters?heroine='+heroId)).data;
  assert.deepEqual(afterRefresh.map((row:any)=>[row.id,row.display_order]),[[ids[0],0],[ids[2],1],[ids[1],2]]);
  const after=(await pool.execute<RowDataPacket[]>('SELECT chapter_id,revision,document FROM chapter_versions WHERE chapter_id IN (?,?,?) ORDER BY chapter_id,revision',ids))[0];
  assert.deepEqual(after,before);
 }finally{
  for(const id of ids){await pool.execute('DELETE FROM chapter_versions WHERE chapter_id=?',[id]);await pool.execute('DELETE FROM chapters WHERE id=?',[id]);}
  await pool.execute('DELETE FROM heroines WHERE id=?',[heroId]);
  if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);
  await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();
 }
});
