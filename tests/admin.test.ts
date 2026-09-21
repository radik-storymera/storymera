import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import type {RowDataPacket} from 'mysql2/promise';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {createApp} from '../server/app.ts';
import {initialProgress,advance} from '../src/progress.ts';
import type {Story} from '../src/story-model.ts';

test('Admin: roles, private uploads, branches, validation, immutable publications, CAS and range',async()=>{
 const pool=createPool(true);await migrate(pool);const server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,suffix=randomUUID().slice(0,8),hid='qa-'+suffix,cid='chapter-'+suffix,users:string[]=[],media:string[]=[];
 function client(){const jar=new Map<string,string>();let token='';return {async call(url:string,method='GET',body?:unknown,range?:string){
  const isFile=body instanceof FormData;
  const r=await fetch(base+url,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),Origin:'http://localhost:5175','X-CSRF-Token':token,...(body&&!isFile?{'Content-Type':'application/json'}:{}),...(range?{Range:range}:{})},body:body===undefined?undefined:isFile?body:JSON.stringify(body)});
  for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],n=pair.indexOf('=');jar.set(pair.slice(0,n),pair.slice(n+1));}
  const data=r.headers.get('content-type')?.includes('application/json')?await r.json():await r.arrayBuffer();if(url==='/csrf')token=data.token;return {status:r.status,data,headers:r.headers};
 }};}
 const guest=client(),reader=client(),admin=client();let draft:any;
 try{
  for(const [c,kind]of [[reader,'reader'],[admin,'admin']]as const){await c.call('/csrf');const r=await c.call('/auth/register','POST',{email:`${kind}-${suffix}@example.test`,password:randomUUID(),role:'admin'});assert.equal(r.status,200);assert.equal(r.data.user.role,'reader');users.push(r.data.user.id);}
  assert.equal((await guest.call('/admin/heroines')).status,401);assert.equal((await reader.call('/admin/heroines')).status,403);
  assert.equal((await reader.call('/admin/media','POST',{})).status,403);
  await pool.execute("UPDATE users SET role='admin' WHERE id=?",[users[1]]);
  async function upload(file:string,mime:string){const form=new FormData();form.append('file',new Blob([await fs.readFile(file)],{type:mime}),path.basename(file));const r=await admin.call('/admin/media','POST',form);assert.equal(r.status,201,JSON.stringify(r.data));media.push(r.data.id);return r.data.src;}
  const photo=await upload('public/media/jessica-city.jpg','image/jpeg'),video=await upload('public/media/jessica-walk.mp4','video/mp4'),poster=await upload('public/media/jessica-walk-poster.jpg','image/jpeg');
  const bad=new FormData();bad.append('file',new Blob(['not an image'],{type:'image/jpeg'}),'fake.jpg');assert.equal((await admin.call('/admin/media','POST',bad)).status,400);
  assert.equal((await guest.call(photo.replace('/api',''))).status,404);assert.equal((await reader.call(photo.replace('/api',''))).status,404);assert.equal((await admin.call(photo.replace('/api',''))).status,200);
  assert.equal((await admin.call('/admin/heroines','POST',{id:hid,name:'QA heroine',description:'Test only',media:{type:'image',src:photo,alt:'Test portrait'}})).status,201);
  const emptyHero=(await admin.call('/admin/heroines')).data.find((h:any)=>h.id===hid);
  assert.deepEqual([emptyHero.chapter_count,emptyHero.published_count,emptyHero.draft_count],[0,0,0]);
  assert.equal((await admin.call('/admin/chapters','POST',{id:cid,heroineId:hid,title:'Branching test'})).status,201);
  const draftHero=(await admin.call('/admin/heroines')).data.find((h:any)=>h.id===hid);
  assert.deepEqual([draftHero.chapter_count,draftHero.published_count,draftHero.draft_count],[1,0,1]);
  draft=(await admin.call(`/admin/chapters/${cid}/draft`,'POST',{})).data;
  const doc:Story=draft.document;doc.chapter.firstScene='start';doc.chapter.keyCost=0;
  const image={type:'image' as const,src:photo,alt:'Local test image'};
  doc.scenes={start:{id:'start',title:'Start',text:'Choose a route.',step:1,final:false,media:image,actions:[{id:'left',label:'Left',target:'left'},{id:'right',label:'Right',target:'right'}]},left:{id:'left',title:'Left path',text:'A quiet walk.',step:2,final:false,media:image,actions:[{id:'finish',label:'Continue',target:'end'}]},right:{id:'right',title:'Right path',text:'At the café.',step:3,final:false,media:image,actions:[{id:'finish',label:'Continue',target:'end'}]},end:{id:'end',title:'The end',text:'End of this test.',step:4,final:true,media:{type:'video',src:video,poster,alt:'Video'},actions:[]}};
  doc.scenes.start.text='<p class="MsoNormal" style="color:red">Choose a <strong>route</strong>.</p><script>alert(1)</script>';
  const save=await admin.call(`/admin/chapters/${cid}/draft/1`,'PUT',{version:1,document:doc});assert.equal(save.status,200);assert.equal(save.data.edit_version,2);
  assert.equal(save.data.document.scenes.start.text,'<p>Choose a <strong>route</strong>.</p>');
  doc.scenes.start.text=save.data.document.scenes.start.text;
  assert.equal((await admin.call(`/admin/chapters/${cid}/draft/1`,'PUT',{version:1,document:doc})).status,409);
  const reopened=await admin.call(`/admin/chapters/${cid}/draft`,'POST',{});assert.deepEqual(reopened.data.document,doc);
  assert.equal((await reader.call(`/admin/chapters/${cid}/preview/1`)).status,403);assert.equal((await guest.call(`/content/chapters/${cid}`)).status,403);
  assert.equal((await reader.call(`/admin/chapters/${cid}/check/1`,'POST',{document:doc})).status,403);
  const checked=await admin.call(`/admin/chapters/${cid}/check/1`,'POST',{document:doc});assert.equal(checked.status,200);assert.deepEqual(checked.data.errors,[]);
  const listed=await admin.call('/admin/chapters?heroine='+hid);assert.equal(listed.data[0].draft_revision,1);
  const before=await pool.query<RowDataPacket[]>('SELECT * FROM progress WHERE user_id=?',[users[1]]);
  assert.equal((await admin.call(`/admin/chapters/${cid}/preview/1`)).status,200);
  const after=await pool.query<RowDataPacket[]>('SELECT * FROM progress WHERE user_id=?',[users[1]]);assert.deepEqual(after[0],before[0]);
  for(const mutate of [
   (s:Story)=>{s.chapter.firstScene='missing';},
   (s:Story)=>{s.scenes.left.pollId=-1;},
   (s:Story)=>{s.scenes.left.media.src='';},
   (s:Story)=>{s.chapter.finalPollId=999999;},
  ]){const broken=structuredClone(doc);mutate(broken);const current=(await admin.call(`/admin/chapters/${cid}/draft`,'POST',{})).data;const saved=await admin.call(`/admin/chapters/${cid}/draft/1`,'PUT',{version:current.edit_version,document:broken});if(broken.scenes.left.pollId===-1||broken.chapter.finalPollId===999999){assert.equal(saved.status,400);continue;}assert.equal(saved.status,200);const result=await admin.call(`/admin/chapters/${cid}/publish/1`,'POST',{version:saved.data.edit_version});assert.equal(result.status,422);assert.ok(result.data.errors.length);}
  const latest=(await admin.call(`/admin/chapters/${cid}/draft`,'POST',{})).data;
  const saved=await admin.call(`/admin/chapters/${cid}/draft/1`,'PUT',{version:latest.edit_version,document:doc});assert.equal(saved.status,200);
  assert.equal((await admin.call(`/admin/chapters/${cid}/publish/1`,'POST',{version:saved.data.edit_version})).status,200);
  const publishedHero=(await admin.call('/admin/heroines')).data.find((h:any)=>h.id===hid);
  assert.deepEqual([publishedHero.chapter_count,publishedHero.published_count,publishedHero.draft_count],[1,1,0]);
  assert.ok(!(await guest.call('/content/catalog')).data.some((h:any)=>h.id===hid));
  assert.ok((await admin.call('/content/catalog')).data.some((h:any)=>h.id===hid&&h.chapters.some((c:any)=>c.id===cid)));
  const range=await reader.call(video.replace('/api',''),'GET',undefined,'bytes=0-99');assert.equal(range.status,206);assert.equal(range.data.byteLength,100);assert.match(range.headers.get('content-range')??'',/^bytes 0-99\//);
  const oldPath=advance(initialProgress(doc),'next',doc);
  assert.equal((await reader.call('/reading/open','POST',{heroineId:hid})).data.chapterId,cid);
  assert.deepEqual((await reader.call('/reading/advance','POST',{chapterId:cid,actionId:'next',version:1})).data.progress,oldPath);
  const d2=(await admin.call(`/admin/chapters/${cid}/draft`,'POST',{})).data;assert.equal(d2.revision,2);d2.document.scenes.left.text='Changed only in version two.';
  const newDraftHero=(await admin.call('/admin/heroines')).data.find((h:any)=>h.id===hid);
  assert.deepEqual([newDraftHero.chapter_count,newDraftHero.published_count,newDraftHero.draft_count],[1,1,1]);
  const s2=await admin.call(`/admin/chapters/${cid}/draft/2`,'PUT',{version:d2.edit_version,document:d2.document});assert.equal(s2.status,200);
  assert.equal((await admin.call(`/admin/chapters/${cid}/publish/2`,'POST',{version:s2.data.edit_version})).status,200);
  const old=await reader.call('/reading/state');assert.deepEqual(old.data.stories[hid].progress,oldPath);
  const versions=(await admin.call(`/content/chapters/${cid}`)).data;assert.equal(versions.length,2);assert.equal(versions[0].scenes.left.text,'A quiet walk.');
  assert.equal((await reader.call('/reading/chapter/'+cid)).data.chapter.revision,1);
  const protectedFiles=await admin.call('/admin/media/inspect','POST',{ids:media});assert.equal(protectedFiles.status,200);assert.ok(protectedFiles.data.files.every((f:any)=>f.status==='blocked'));
  assert.ok(protectedFiles.data.files.find((f:any)=>f.id===media[0]).archivedUses.some((u:string)=>u.includes('version 1')));
  assert.equal((await admin.call('/admin/media/'+media[1]+'/poster','PUT',{posterId:media[2]})).status,200);
  const posterCheck=await admin.call('/admin/media/inspect','POST',{ids:[media[2]]});assert.ok(posterCheck.data.files[0].uses.some((u:string)=>u.includes('Default poster')));
  assert.equal((await admin.call('/admin/media/'+media[1]+'/poster','PUT',{posterId:media[0]})).status,409);
  assert.equal((await reader.call('/admin/media/delete','POST',{ids:media})).status,403);
  const rejectedDelete=await admin.call('/admin/media/delete','POST',{ids:[media[0]]});assert.equal(rejectedDelete.data.files[0].status,'blocked');
  const unused=new FormData();unused.append('file',new Blob([await fs.readFile('public/media/jessica-city.jpg')],{type:'image/jpeg'}),'Джессика 01.jpg');
  const cyrillic=await admin.call('/admin/media','POST',unused);assert.equal(cyrillic.status,201,JSON.stringify(cyrillic.data));media.push(cyrillic.data.id);
  const listedMedia=await admin.call('/admin/media');assert.equal(listedMedia.data.find((a:any)=>a.id===cyrillic.data.id).original_name,'Джессика 01.jpg');
  const mixed=await admin.call('/admin/media/inspect','POST',{ids:[media[0],cyrillic.data.id]});assert.deepEqual(mixed.data.files.map((f:any)=>f.status),['blocked','eligible']);
  const deleted=await admin.call('/admin/media/delete','POST',{ids:[media[0],cyrillic.data.id]});assert.deepEqual(deleted.data.files.map((f:any)=>f.status),['blocked','deleted']);
  assert.equal((await admin.call(cyrillic.data.src.replace('/api',''))).status,404);
  assert.equal((await admin.call('/admin/media/restore','POST',{id:cyrillic.data.id})).status,200);
  assert.equal((await admin.call(cyrillic.data.src.replace('/api',''))).status,200);
  const gifForm=new FormData();gifForm.append('file',new Blob([Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64')],{type:'image/gif'}),'tiny.gif');
  const gif=await admin.call('/admin/media','POST',gifForm);assert.equal(gif.status,201,JSON.stringify(gif.data));media.push(gif.data.id);
  assert.equal((await admin.call(gif.data.src.replace('/api',''))).status,200);
  assert.equal((await admin.call(`/admin/chapters/${cid}/draft/1`,'PUT',{version:3,document:doc})).status,409);
  const nextOld=advance(oldPath,'next',doc);assert.deepEqual((await reader.call('/reading/advance','POST',{chapterId:cid,actionId:'next',version:2})).data.progress,nextOld);
  const finalOld=advance(nextOld,'next',doc);assert.deepEqual((await reader.call('/reading/advance','POST',{chapterId:cid,actionId:'next',version:3})).data.progress,finalOld);
  assert.equal((await reader.call('/reading/finish','POST',{chapterId:cid})).data.state.mode,'complete');
  assert.equal((await reader.call('/reading/chapter/'+cid)).status,403);
 }finally{
  // Delete only this run's generated test fixtures, never seeded stories or the working database.
  for(const id of users)await pool.execute('DELETE FROM progress WHERE user_id=?',[id]);
  await pool.execute('DELETE FROM version_media WHERE chapter_id=?',[cid]);await pool.execute('DELETE FROM chapter_versions WHERE chapter_id=?',[cid]);await pool.execute('DELETE FROM chapters WHERE id=?',[cid]);await pool.execute('DELETE FROM heroines WHERE id=?',[hid]);
  for(const id of media){const [r]=await pool.execute<RowDataPacket[]>('SELECT filename FROM media_assets WHERE id=?',[id]);await pool.execute('DELETE FROM media_assets WHERE id=?',[id]);if(r[0])await fs.unlink(path.resolve('.local/media',r[0].filename));}
  for(const id of users)await pool.execute('DELETE FROM users WHERE id=?',[id]);
  await new Promise<void>(r=>server.close(()=>r()));await pool.end();
 }
});
