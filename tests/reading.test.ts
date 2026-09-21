import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {RowDataPacket} from 'mysql2/promise';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {createApp} from '../server/app.ts';

test('sequential guest reading, explicit completion, new publication and account transfer',async()=>{
 const pool=createPool(true);await migrate(pool);
 const server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,suffix=randomUUID().slice(0,8);
 const hero='read-'+suffix,other='other-'+suffix,first='one-'+suffix,second='two-'+suffix,third='three-'+suffix,otherChapter='other-chapter-'+suffix;
 let userId='',legacyUserId='';const chapters=[first,second,third,otherChapter];
 function client(){const jar=new Map<string,string>();let csrf='';return {jar,async call(url:string,method='GET',body?:unknown){
  const r=await fetch(base+url,{method,headers:{Origin:'http://localhost:5175','Content-Type':'application/json','X-CSRF-Token':csrf,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});
  for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
  const data=await r.json();if(url==='/csrf')csrf=data.token;return {status:r.status,data};
 }};}
 const guest=client(),anonymous=client(),returning=client(),legacy=client();
 async function publish(id:string,heroineId:string,order:number){
  await pool.execute('INSERT INTO chapters(id,heroine_id,title,description,display_order,published_revision,key_cost,guest_free) VALUES(?,?,?,?,?,1,0,TRUE)',[id,heroineId,id,'Test',order]);
  const document={chapter:{id,heroineId,revision:1,title:id,description:'Test',subtitle:'',firstScene:'end',freeSteps:1},scenes:{end:{id:'end',step:1,title:'Final',text:'A complete scene.',final:true,media:{type:'image',src:'/media/jessica-city.jpg',alt:'Test'},actions:[]}}};
  await pool.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,1,'published',?)",[id,JSON.stringify(document)]);
 }
 try{
  for(const id of [hero,other])await pool.execute('INSERT INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[id,id,'Test',JSON.stringify({type:'image',src:'/media/jessica-city.jpg',alt:'Test'})]);
  await publish(first,hero,0);await publish(second,hero,1);await publish(otherChapter,other,0);
  await guest.call('/csrf');await anonymous.call('/csrf');await returning.call('/csrf');
  assert.equal((await anonymous.call('/reading/chapter/'+second)).status,401);
  assert.equal((await guest.call('/reading/session','POST',{})).status,200);
  const initial=(await guest.call('/reading/state')).data.stories;
  assert.equal(initial[hero].mode,'unstarted');assert.equal(initial[hero].chapterId,first);
  assert.equal((await guest.call('/reading/chapter/'+second)).status,403);
  assert.equal((await guest.call('/content/chapters/'+second)).status,403);
  assert.equal((await guest.call('/progress','PUT',{reset:true})).status,410);
  const opened=(await guest.call('/reading/open','POST',{heroineId:hero})).data;
  assert.equal(opened.mode,'active');assert.equal(opened.chapterId,first);assert.equal(opened.progress.sceneId,'end');
  assert.equal((await guest.call('/reading/chapter/'+first)).status,200);
  assert.equal((await guest.call('/reading/finish','POST',{chapterId:second})).status,403);
  assert.equal((await guest.call('/reading/state')).data.stories[hero].mode,'active');
  const otherOpened=(await guest.call('/reading/open','POST',{heroineId:other})).data;
  assert.equal(otherOpened.chapterId,otherChapter);
  const finished=(await guest.call('/reading/finish','POST',{chapterId:first})).data;
  assert.equal(finished.state.mode,'awaiting');assert.equal(finished.state.chapterId,second);
  assert.equal((await guest.call('/reading/chapter/'+first)).status,403);
  const repeated=(await guest.call('/reading/finish','POST',{chapterId:first})).data;
  assert.equal(repeated.state.chapterId,second);assert.equal(repeated.state.mode,'awaiting');
  const secondOpened=(await guest.call('/reading/open','POST',{heroineId:hero})).data;
  assert.equal(secondOpened.chapterId,second);
  assert.equal((await guest.call('/reading/open','POST',{heroineId:hero})).data.chapterId,second);
  assert.equal((await guest.call('/reading/finish','POST',{chapterId:first})).data.state.mode,'active');
  assert.equal((await guest.call('/reading/finish','POST',{chapterId:second})).data.state.mode,'complete');
  assert.equal((await guest.call('/reading/open','POST',{heroineId:hero})).data.mode,'complete');
  assert.equal((await guest.call('/reading/chapter/'+second)).status,403);
  await publish(third,hero,2);
  assert.equal((await guest.call('/reading/state')).data.stories[hero].chapterId,third);
  assert.equal((await guest.call('/reading/state')).data.stories[other].mode,'active');
  const password=randomUUID();
  const registered=await guest.call('/auth/register','POST',{email:`reading-${suffix}@example.test`,password});
  assert.equal(registered.status,200);userId=registered.data.user.id;
  const transferred=(await guest.call('/reading/state')).data.stories;
  assert.equal(transferred[hero].chapterId,third);assert.equal(transferred[other].mode,'active');
  assert.equal((await guest.call('/auth/logout','POST',{})).status,200);
  assert.equal((await guest.call('/reading/state')).data.stories[hero].chapterId,third);
  const login=await returning.call('/auth/login','POST',{email:`reading-${suffix}@example.test`,password});
  assert.equal(login.status,200);
  assert.equal((await returning.call('/reading/state')).data.stories[hero].chapterId,third);
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT chapter_id,completed_at FROM progress WHERE user_id=?',[userId]);
  assert.equal(rows.length,3);assert.equal(rows.filter(row=>row.completed_at!==null).length,2);
  const oldAccount=await anonymous.call('/auth/register','POST',{email:`old-path-${suffix}@example.test`,password:randomUUID()});
  assert.equal(oldAccount.status,200);legacyUserId=oldAccount.data.user.id;
  for(const [id,updated] of [[first,'2020-01-01 00:00:00.000'],[second,'2021-01-01 00:00:00.000']]){
   await pool.execute('INSERT INTO progress(user_id,heroine_id,chapter_id,story_revision,scene_id,choices,decisions,save_version,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',[legacyUserId,hero,id,1,'end','{}','[]',1,updated]);
  }
  assert.equal((await anonymous.call('/reading/state')).data.stories[hero].chapterId,second);
  assert.equal((await anonymous.call('/reading/chapter/'+first)).status,403);
  assert.equal((await anonymous.call('/reading/finish','POST',{chapterId:second})).data.state.chapterId,third);
  assert.equal((await anonymous.call('/reading/chapter/'+first)).status,403);
  await legacy.call('/csrf');await legacy.call('/reading/session','POST',{});
  const oldPath={revision:1,sceneId:'end',choices:{},decisions:[]};
  assert.equal((await legacy.call('/reading/import','POST',{chapterId:first,progress:oldPath})).status,200);
  const revised={chapter:{id:first,heroineId:hero,revision:2,title:first,description:'Test',subtitle:'',firstScene:'end',freeSteps:1},scenes:{end:{id:'end',step:1,title:'Changed later',text:'A newer publication.',final:true,media:{type:'image',src:'/media/jessica-city.jpg',alt:'Test'},actions:[]}}};
  await pool.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,2,'published',?)",[first,JSON.stringify(revised)]);
  await pool.execute('UPDATE chapters SET published_revision=2,display_order=5 WHERE id=?',[first]);
  assert.equal((await anonymous.call('/reading/state')).data.stories[hero].chapterId,third);
  const pinned=(await legacy.call('/reading/state')).data.stories[hero];
  assert.equal(pinned.mode,'active');assert.equal(pinned.progress.revision,1);
  assert.equal((await legacy.call('/reading/chapter/'+first)).data.chapter.revision,1);
  assert.equal((await legacy.call('/reading/finish','POST',{chapterId:first})).data.state.chapterId,second);
 }finally{
  if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);
  if(legacyUserId)await pool.execute('DELETE FROM users WHERE id=?',[legacyUserId]);
  const {createHash}=await import('node:crypto');for(const jar of [guest.jar,legacy.jar]){const token=jar.get('jessica_guest');if(token)await pool.execute('DELETE FROM guest_sessions WHERE token_hash=?',[createHash('sha256').update(token).digest('hex')]);}
  for(const id of chapters){await pool.execute('DELETE FROM chapter_versions WHERE chapter_id=?',[id]);await pool.execute('DELETE FROM chapters WHERE id=?',[id]);}
  for(const id of [hero,other])await pool.execute('DELETE FROM heroines WHERE id=?',[id]);
  await new Promise<void>(r=>server.close(()=>r()));await pool.end();
 }
});
