import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {createApp} from '../server/app.ts';
import {countsFromChapterRows} from '../src/adminSummary.ts';

test('story summaries count chapters and retain published status with a new draft',async()=>{
 const pool=createPool(true);await migrate(pool);
 const server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
 const suffix=randomUUID().slice(0,8),heroes=[0,1,2,3].map(i=>`summary-${suffix}-${i}`),chapters=heroes.slice(1).map((_,i)=>`summary-chapter-${suffix}-${i}`);
 const cookies=new Map<string,string>();let token='',userId='';
 async function call(url:string,method='GET',body?:unknown){
  const response=await fetch(base+url,{method,headers:{Origin:'http://localhost:5175','Content-Type':'application/json','X-CSRF-Token':token,cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
  const data=await response.json();if(url==='/csrf')token=data.token;
  assert.equal(response.status,200,JSON.stringify(data));return data;
 }
 try{
  await call('/csrf');
  const registration=await call('/auth/register','POST',{email:`summary-${suffix}@example.test`,password:randomUUID()});
  userId=registration.user.id;await pool.execute("UPDATE users SET role='admin' WHERE id=?",[userId]);
  for(const id of heroes)await pool.execute('INSERT INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[id,id,'Test only',JSON.stringify({type:'image',src:'/media/jessica-city.jpg',alt:'Test'})]);
  for(let i=0;i<chapters.length;i++){
   const id=chapters[i],heroineId=heroes[i+1],published=i>0?1:null;
   await pool.execute('INSERT INTO chapters(id,heroine_id,title,description,published_revision) VALUES(?,?,?,?,?)',[id,heroineId,id,'Test only',published]);
   const doc={chapter:{id,heroineId,revision:1,title:id,description:'Test only',subtitle:'',firstScene:'',freeSteps:5},scenes:{}};
   await pool.execute('INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,?,?,?)',[id,1,i===0?'draft':'published',JSON.stringify(doc)]);
   if(i===0)await pool.execute('INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,?,?,?)',[id,2,'draft',JSON.stringify({...doc,chapter:{...doc.chapter,revision:2}})]);
   if(i===2)await pool.execute('INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,?,?,?)',[id,2,'draft',JSON.stringify({...doc,chapter:{...doc.chapter,revision:2}})]);
  }
  const expected=[[0,0,0],[1,0,1],[1,1,0],[1,1,1]];
  async function assertSummaries(){
   const all=await call('/admin/heroines');
   for(let i=0;i<heroes.length;i++){
    const summary=all.find((row:any)=>row.id===heroes[i]);
    const rows=await call('/admin/chapters?heroine='+heroes[i]);
    const counts=countsFromChapterRows(rows);
    assert.deepEqual([counts.chapter_count,counts.published_count,counts.draft_count],expected[i]);
    assert.deepEqual([summary.chapter_count,summary.published_count,summary.draft_count],expected[i]);
   }
  }
  await assertSummaries();
  await assertSummaries(); // A new request, as on page refresh or return from the editor.
  assert.throws(()=>countsFromChapterRows(null),/unavailable/);
  assert.throws(()=>countsFromChapterRows([{id:'partial'}]),/incomplete/);
 }finally{
  for(const id of chapters){await pool.execute('DELETE FROM chapter_versions WHERE chapter_id=?',[id]);await pool.execute('DELETE FROM chapters WHERE id=?',[id]);}
  for(const id of heroes)await pool.execute('DELETE FROM heroines WHERE id=?',[id]);
  if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);
  await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();
 }
});
