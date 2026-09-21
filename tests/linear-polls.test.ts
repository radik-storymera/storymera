import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {RowDataPacket} from 'mysql2/promise';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {createApp} from '../server/app.ts';
import {validateStory} from '../src/story-model.ts';
import {mediaErrors} from '../server/admin.ts';
import type {Story} from '../src/story-model.ts';

test('linear reading, opinion and canonical polls, official snapshot and admin rights',async()=>{
 const pool=createPool(true);await migrate(pool);
 const suffix=randomUUID().slice(0,8),hero='linear-'+suffix,chapter='linear-ch-'+suffix;
 const server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
 const users:string[]=[],polls:number[]=[];
 function client(){const jar=new Map<string,string>();let csrf='';return {async call(path:string,method='GET',body?:unknown){const response=await fetch(base+path,{method,headers:{Origin:'http://localhost:5175','Content-Type':'application/json','X-CSRF-Token':csrf,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}const data=await response.json();if(path==='/csrf')csrf=data.token;return {status:response.status,data};}};}
 const admin=client(),reader=client(),second=client(),guest=client();
 const option=(text:string)=>({text,description:''});
 try{
  for(const c of [admin,reader,second,guest])await c.call('/csrf');
  const a=await admin.call('/auth/register','POST',{email:`poll-admin-${suffix}@example.test`,password:randomUUID()});users.push(a.data.user.id);
  await pool.execute("UPDATE users SET role='admin' WHERE id=?",[a.data.user.id]);
  const [adminSession]=await pool.execute<RowDataPacket[]>('SELECT token_hash FROM sessions WHERE user_id=?',[a.data.user.id]);
  assert.equal(adminSession.length,1);
  const r=await reader.call('/auth/register','POST',{email:`poll-reader-${suffix}@example.test`,password:randomUUID()});users.push(r.data.user.id);
  assert.equal((await reader.call('/admin/polls')).status,403);
  // The test admin registers as a reader, then signs out and signs back in after role elevation.
  // The session resolver reads the current database role on every request.
  const opinion=await admin.call('/admin/polls','POST',{adminTitle:'First meeting',question:'What do you think?',description:'',type:'opinion',status:'draft',allowSkip:true,showResults:true,allowVoteChange:true,openAt:null,closeAt:null,options:[option('Warm'),option('Reserved')]});assert.equal(opinion.status,201);polls.push(opinion.data.id);
  const canonical=await admin.call('/admin/polls','POST',{adminTitle:'Next chapter',question:'Where next?',description:'',type:'canonical',status:'draft',allowSkip:false,showResults:true,allowVoteChange:false,openAt:null,closeAt:null,options:[option('Square'),option('Museum')]});assert.equal(canonical.status,201);polls.push(canonical.data.id);
  const activate=async(id:number)=>{const data=(await admin.call('/admin/polls/'+id)).data;return admin.call('/admin/polls/'+id,'PATCH',{...data,status:'active'});};
  assert.equal((await activate(opinion.data.id)).status,200);assert.equal((await activate(canonical.data.id)).status,200);
  const opinionOptions=(await admin.call('/admin/polls/'+opinion.data.id)).data.options,canonicalOptions=(await admin.call('/admin/polls/'+canonical.data.id)).data.options;
  await pool.execute('INSERT INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[hero,hero,'Test',JSON.stringify({type:'image',src:'/media/jessica-city.jpg',alt:'Test'})]);
  await pool.execute('INSERT INTO chapters(id,heroine_id,title,description,display_order,published_revision) VALUES(?,?,?,?,1,1)',[chapter,hero,'Linear','Test']);
  const media={type:'image',src:'/media/jessica-city.jpg',alt:'Test'};
  const document:Story={chapter:{id:chapter,heroineId:hero,revision:1,title:'Linear',description:'Test',subtitle:'',firstScene:'a',freeSteps:4,finalPollId:canonical.data.id},scenes:{a:{id:'a',type:'story',step:1,title:'A',text:'A',final:false,media,pollId:null,actions:[{id:'old-skip',label:'Skip',target:'c'}]},b:{id:'b',type:'story',step:2,title:'B',text:'B',final:false,media,pollId:null,actions:[{id:'old-go',label:'Go',target:'c'}]},question:{id:'question',type:'poll',step:3,title:'Your opinion',text:'',final:false,pollId:opinion.data.id,actions:[]},c:{id:'c',type:'story',step:4,title:'C',text:'C',final:true,media,pollId:null,actions:[]}}};
  assert.deepEqual(validateStory(document),[]);
  document.scenes.question.media=media;
  assert.deepEqual(validateStory(document),[]);
  assert.deepEqual(await mediaErrors(pool,document),[]);
  document.scenes.question.media={type:'image',src:'/api/media/00000000-0000-0000-0000-000000000000',alt:'Missing'};
  assert.match((await mediaErrors(pool,document)).join(' '),/choose an uploaded image file/);
  document.scenes.question.media=media;
  await pool.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,1,'published',?)",[chapter,JSON.stringify(document)]);
  assert.equal((await guest.call('/reading/session','POST',{})).status,200);
  assert.equal((await guest.call('/polls/'+opinion.data.id)).status,403);
  let state=(await reader.call('/reading/open','POST',{heroineId:hero})).data;assert.equal(state.progress.sceneId,'a');
  assert.equal((await reader.call('/polls/'+opinion.data.id)).status,403);
  assert.equal((await reader.call('/reading/advance','POST',{chapterId:chapter,actionId:'old-skip',version:state.version})).status,400);
  state=(await reader.call('/reading/advance','POST',{chapterId:chapter,actionId:'next',version:state.version})).data;assert.equal(state.progress.sceneId,'b');assert.deepEqual(state.progress.choices,{});
  assert.equal((await reader.call('/polls/'+opinion.data.id)).status,403);
  state=(await reader.call('/reading/advance','POST',{chapterId:chapter,actionId:'next',version:state.version})).data;assert.equal(state.progress.sceneId,'question');
  assert.equal((await reader.call('/polls/'+opinion.data.id)).status,200);
  assert.equal((await reader.call('/polls/'+opinion.data.id+'/results')).data.resultsHidden,true);
  assert.equal((await reader.call('/polls/'+opinion.data.id+'/view','POST',{})).status,200);
  assert.equal((await guest.call('/polls/'+opinion.data.id+'/vote','POST',{optionId:opinionOptions[0].id})).status,401);
  assert.equal((await reader.call('/polls/'+opinion.data.id+'/vote','POST',{optionId:canonicalOptions[0].id})).status,400);
  assert.equal((await reader.call('/polls/'+opinion.data.id+'/vote','POST',{optionId:opinionOptions[0].id})).status,200);
  assert.equal((await reader.call('/polls/'+opinion.data.id+'/vote','POST',{optionId:opinionOptions[1].id})).status,200);
  const result=(await reader.call('/polls/'+opinion.data.id+'/results')).data;assert.equal(result.total,1);assert.equal(result.options.find((x:any)=>x.id===opinionOptions[1].id).percent,100);
  const statistics=(await admin.call('/admin/polls/'+opinion.data.id+'/stats')).data;assert.equal(statistics.views,1);assert.equal(statistics.uniqueViewers,1);assert.equal(statistics.changedVotes,1);
  assert.equal((await reader.call('/polls/'+canonical.data.id)).status,403);
  state=(await reader.call('/reading/advance','POST',{chapterId:chapter,actionId:'next',version:state.version})).data;assert.equal(state.progress.sceneId,'c');
  assert.equal((await reader.call('/polls/'+canonical.data.id)).status,403);
  const finished=(await reader.call('/reading/finish','POST',{chapterId:chapter})).data;assert.equal(finished.state.finalPollId,canonical.data.id);
  assert.equal((await reader.call('/polls/'+canonical.data.id)).status,200);
  assert.equal((await reader.call('/polls/'+canonical.data.id+'/vote','POST',{optionId:canonicalOptions[0].id})).status,200);
  assert.equal((await reader.call('/polls/'+canonical.data.id+'/vote','POST',{optionId:canonicalOptions[1].id})).status,409);
  const secondAccount=await second.call('/auth/register','POST',{email:`poll-second-${suffix}@example.test`,password:randomUUID()});users.push(secondAccount.data.user.id);
  let other=(await second.call('/reading/open','POST',{heroineId:hero})).data;for(let i=0;i<3;i++)other=(await second.call('/reading/advance','POST',{chapterId:chapter,actionId:'next',version:other.version})).data;
  await second.call('/reading/finish','POST',{chapterId:chapter});assert.equal((await second.call('/polls/'+canonical.data.id+'/vote','POST',{optionId:canonicalOptions[1].id})).status,200);
  const closed=await admin.call('/admin/polls/'+canonical.data.id+'/close','POST',{});assert.equal(closed.status,200);assert.equal(closed.data.tie,true);assert.equal(closed.data.canonicalOptionId,null);
  assert.equal((await admin.call('/admin/polls/'+canonical.data.id+'/canonical-option','POST',{optionId:canonicalOptions[0].id})).status,200);
  assert.equal((await reader.call('/polls/'+canonical.data.id+'/vote','POST',{optionId:canonicalOptions[0].id})).status,409);
  assert.equal((await admin.call('/admin/polls/'+canonical.data.id+'/archive','POST',{})).status,409);
  assert.equal((await admin.call('/admin/polls/'+canonical.data.id+'/archive','POST',{confirmAttached:true})).status,200);
  assert.equal((await reader.call('/polls/'+canonical.data.id+'/results')).data.total,2);
 }finally{
  await pool.execute('DELETE FROM progress WHERE chapter_id=?',[chapter]);await pool.execute('DELETE FROM chapter_versions WHERE chapter_id=?',[chapter]);await pool.execute('DELETE FROM chapters WHERE id=?',[chapter]);await pool.execute('DELETE FROM heroines WHERE id=?',[hero]);
  for(const id of polls){await pool.execute('DELETE FROM poll_progress WHERE poll_id=?',[id]);await pool.execute('DELETE FROM poll_views WHERE poll_id=?',[id]);await pool.execute('DELETE FROM poll_result_snapshots WHERE poll_id=?',[id]);await pool.execute('DELETE FROM poll_votes WHERE poll_id=?',[id]);await pool.execute('UPDATE polls SET canonical_option_id=NULL WHERE id=?',[id]);await pool.execute('DELETE FROM poll_options WHERE poll_id=?',[id]);await pool.execute('DELETE FROM polls WHERE id=?',[id]);}
  for(const id of users)await pool.execute('DELETE FROM users WHERE id=?',[id]);
  await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();
 }
});
