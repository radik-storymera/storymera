import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {RowDataPacket} from 'mysql2/promise';
import {createPool} from '../server/db.ts';
import {createApp} from '../server/app.ts';
import {migrate} from '../server/migrate.ts';
import {advance,initialProgress} from '../src/progress.ts';
import type {Story} from '../src/story-model.ts';

test('a former demo scene is an ordinary stop in published reading and draft preview',async()=>{
 const pool=createPool(true);await migrate(pool);
 const server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,suffix=randomUUID().slice(0,8);
 const hero='scene-'+suffix,chapter='scene-chapter-'+suffix,adminEmail=`scene-admin-${suffix}@example.test`;
 let adminId='';const guests:{jar:Map<string,string>}[]=[];
 function client(){const jar=new Map<string,string>();let csrf='';return {jar,async call(url:string,method='GET',body?:unknown){
  const r=await fetch(base+url,{method,headers:{Origin:'http://localhost:5175','Content-Type':'application/json','X-CSRF-Token':csrf,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});
  for(const value of r.headers.getSetCookie()){const pair=value.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
  const data=await r.json();if(url==='/csrf')csrf=data.token;return {status:r.status,data};
 }};}
 const image=(alt:string)=>({type:'image' as const,src:'/media/jessica-city.jpg',alt});
 function document(revision:number,title:string):Story{return {chapter:{id:chapter,heroineId:hero,revision,title:'Chapter',description:'Test',subtitle:'Chapter 1',firstScene:'arrival',freeSteps:7},scenes:{
  arrival:{id:'arrival',step:1,title:'Arrival',text:'First scene',media:image('Arrival'),actions:[{id:'begin',label:'Explore',target:'crossroads'}]},
  crossroads:{id:'crossroads',step:2,title:'Choose a path',text:'Two paths',media:image('Paths'),actions:[{id:'cafe',label:'Cafe',target:'cafe',choice:{key:'afternoon',value:'cafe'}},{id:'walk',label:'Walk',target:'river',choice:{key:'afternoon',value:'walk'}}]},
  cafe:{id:'cafe',step:3,title:'Cafe',text:'Cafe path',media:image('Cafe'),actions:[{id:'to-square',label:'Go to square',target:'square'}]},
  river:{id:'river',step:3,title:'River',text:'River path',media:image('River'),actions:[{id:'to-square',label:'Go to square',target:'square'}]},
  square:{id:'square',step:4,title:'Something in common',text:'Shared point',media:image('Square'),variants:[{key:'afternoon',value:'cafe',text:'From the cafe'},{key:'afternoon',value:'walk',text:'From the river'}],actions:[{id:'home',label:'Follow the story',target:'demo'}]},
  demo:{id:'demo',step:5,kind:'demo',title,text:'Owner-authored scene text, not a subscription notice.',media:image('Owner-authored scene image'),actions:[{id:'owner-next',label:'Go home',target:'evening'}]},
  evening:{id:'evening',step:6,title:'A small beginning',text:'At home',media:image('Home'),actions:[{id:'finish',label:'Meet tomorrow',target:'tomorrow'}]},
  tomorrow:{id:'tomorrow',step:7,final:true,title:'A reason to go back',text:'Final scene',media:image('Tomorrow'),actions:[]},
 }};}
 try{
  const published=document(1,'There is more to her story'),draft=document(2,'Draft title for the same scene');
  await pool.execute('INSERT INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[hero,'Scene test','Test only',JSON.stringify(image('Portrait'))]);
  await pool.execute('INSERT INTO chapters(id,heroine_id,title,description,display_order,published_revision,key_cost,guest_free) VALUES(?,?,?,?,0,1,0,TRUE)',[chapter,hero,'Chapter','Test only']);
  await pool.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,1,'published',?)",[chapter,JSON.stringify(published)]);
  await pool.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,2,'draft',?)",[chapter,JSON.stringify(draft)]);
  for(let readerNumber=0;readerNumber<2;readerNumber++){
   const c=client();guests.push(c);await c.call('/csrf');await c.call('/reading/session','POST',{});
   let state=(await c.call('/reading/open','POST',{heroineId:hero})).data;
   assert.equal(state.progress.sceneId,'arrival');assert.equal(state.progress.revision,1);
   const served=await c.call('/reading/chapter/'+chapter);
   assert.equal(served.status,200);assert.deepEqual(served.data.scenes.demo,published.scenes.demo);
   assert.equal(served.data.scenes.square.actions[0].target,'demo');
   for(const expected of ['crossroads','cafe','river','square','demo']){
    const r=await c.call('/reading/advance','POST',{chapterId:chapter,actionId:'next',version:state.version});assert.equal(r.status,200);state=r.data;assert.equal(state.progress.sceneId,expected);
   }
   assert.equal(state.progress.sceneId,'demo');assert.deepEqual(state.progress.choices,{});
   assert.equal(state.progress.decisions.at(-1),'next');
   assert.equal((await c.call('/reading/finish','POST',{chapterId:chapter})).status,409);
   const reload=(await c.call('/reading/state')).data.stories[hero];
   assert.equal(reload.progress.sceneId,'demo');assert.equal(reload.version,state.version);
   const again=(await c.call('/reading/chapter/'+chapter)).data;
   assert.deepEqual(again.scenes.demo,published.scenes.demo);
   state=(await c.call('/reading/advance','POST',{chapterId:chapter,actionId:'next',version:reload.version})).data;
   assert.equal(state.progress.sceneId,'evening');
   assert.equal(state.progress.decisions.at(-1),'next');
   state=(await c.call('/reading/advance','POST',{chapterId:chapter,actionId:'next',version:state.version})).data;
   assert.equal(state.progress.sceneId,'tomorrow');
   assert.equal((await c.call('/reading/finish','POST',{chapterId:chapter})).data.state.mode,'complete');
   assert.equal((await c.call('/reading/chapter/'+chapter)).status,403);
   assert.equal((await c.call('/reading/open','POST',{heroineId:hero})).data.mode,'complete');
  }
  const old=client();guests.push(old);await old.call('/csrf');await old.call('/reading/session','POST',{});
  const token=old.jar.get('jessica_guest')!;
  const [session]=await pool.execute<RowDataPacket[]>('SELECT id FROM guest_sessions WHERE token_hash=?',[createHash('sha256').update(token).digest('hex')]);
  await pool.execute('INSERT INTO progress(guest_id,heroine_id,chapter_id,story_revision,scene_id,choices,decisions,save_version) VALUES(?,?,?,?,?,?,?,1)',[session[0].id,hero,chapter,1,'demo',JSON.stringify({afternoon:'walk'}),JSON.stringify(['begin','walk','to-square','home'])]);
  const restored=(await old.call('/reading/state')).data.stories[hero];
  assert.equal(restored.progress.sceneId,'demo');assert.equal(restored.progress.choices.afternoon,'walk');
  assert.equal((await old.call('/reading/chapter/'+chapter)).data.scenes.demo.title,published.scenes.demo.title);
  const [oldRows]=await pool.execute<RowDataPacket[]>('SELECT scene_id,decisions FROM progress WHERE guest_id=?',[session[0].id]);
  assert.equal(oldRows[0].scene_id,'demo');assert.equal(oldRows[0].decisions.at(-1),'home');
  const advanced=client();guests.push(advanced);await advanced.call('/csrf');await advanced.call('/reading/session','POST',{});
  const advancedToken=advanced.jar.get('jessica_guest')!;
  const [advancedSession]=await pool.execute<RowDataPacket[]>('SELECT id FROM guest_sessions WHERE token_hash=?',[createHash('sha256').update(advancedToken).digest('hex')]);
  await pool.execute('INSERT INTO progress(guest_id,heroine_id,chapter_id,story_revision,scene_id,choices,decisions,save_version) VALUES(?,?,?,?,?,?,?,1)',[advancedSession[0].id,hero,chapter,1,'tomorrow',JSON.stringify({afternoon:'cafe'}),JSON.stringify(['begin','cafe','to-square','home','owner-next','finish'])]);
  assert.equal((await advanced.call('/reading/state')).data.stories[hero].progress.sceneId,'tomorrow');
  const admin=client();await admin.call('/csrf');const registered=await admin.call('/auth/register','POST',{email:adminEmail,password:randomUUID()});assert.equal(registered.status,200);adminId=registered.data.user.id;
  await pool.execute('UPDATE users SET role=? WHERE id=?',['admin',adminId]);
  const preview=await admin.call(`/admin/chapters/${chapter}/preview/2`);assert.equal(preview.status,200);
  assert.deepEqual(preview.data.scenes.demo,draft.scenes.demo);
  assert.equal(preview.data.scenes.square.actions[0].target,'demo');
  let previewPath=initialProgress(draft);for(let i=0;i<5;i++)previewPath=advance(previewPath,'next',draft);
  assert.equal(previewPath.sceneId,'demo');assert.equal(advance(previewPath,'next',draft).sceneId,'evening');
  const [adminProgress]=await pool.execute<RowDataPacket[]>('SELECT id FROM progress WHERE user_id=?',[adminId]);assert.equal(adminProgress.length,0);
  const [draftRows]=await pool.execute<RowDataPacket[]>('SELECT status,document FROM chapter_versions WHERE chapter_id=? AND revision=2',[chapter]);
  assert.equal(draftRows[0].status,'draft');assert.deepEqual(draftRows[0].document.scenes.demo,draft.scenes.demo);
 }finally{
  if(adminId)await pool.execute('DELETE FROM users WHERE id=?',[adminId]);
  for(const c of guests){const token=c.jar.get('jessica_guest');if(token)await pool.execute('DELETE FROM guest_sessions WHERE token_hash=?',[createHash('sha256').update(token).digest('hex')]);}
  await pool.execute('DELETE FROM chapter_versions WHERE chapter_id=?',[chapter]);await pool.execute('DELETE FROM chapters WHERE id=?',[chapter]);await pool.execute('DELETE FROM heroines WHERE id=?',[hero]);
  await new Promise<void>(r=>server.close(()=>r()));await pool.end();
 }
});
