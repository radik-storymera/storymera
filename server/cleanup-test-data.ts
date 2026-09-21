import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolConnection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {createPool} from './db.ts';

const ADMIN_EMAIL='od.radik@gmail.com';
const TABLES=['users','sessions','guest_sessions','progress','heroines','chapters','chapter_versions','version_media','media_assets','media_trash','polls','poll_options','poll_votes','poll_views','poll_result_snapshots','poll_progress','chapter_unlocks','analytics_events','plan_analytics_events','key_transactions'] as const;
const testDatabase=process.argv.includes('--test');
const mediaDir=testDatabase?path.resolve('.local/test-cleanup-media'):path.resolve('.local/media'),trashDir=testDatabase?path.resolve('.local/test-cleanup-trash'):path.resolve('.local/media-trash');

type Db=Pool|PoolConnection;
type Analysis={admin:RowDataPacket;jessica:RowDataPacket;stories:RowDataPacket[];deletedStoryIds:string[];deletedChapterIds:string[];keptPollIds:number[];deletedPollIds:number[];adminForeignProgress:number;adminBalance:number;projectedLastBalance:number|null;counts:Record<string,number>;polls:RowDataPacket[];unusedMedia:RowDataPacket[];legacyTrash:RowDataPacket[];jessicaFingerprint:string;adminFingerprint:string};

const placeholders=(values:unknown[])=>values.map(()=>'?').join(',');
const parsed=<T>(value:T|string):T=>typeof value==='string'?JSON.parse(value) as T:value;
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function rows(db:Db,sql:string,values:any[]=[]){const [result]=await db.execute(sql,values);return result as RowDataPacket[];}
async function count(db:Db,table:string){const result=await rows(db,`SELECT COUNT(*) AS n FROM \`${table}\``);return Number(result[0].n);}
async function counts(db:Db){return Object.fromEntries(await Promise.all(TABLES.map(async table=>[table,await count(db,table)])));}
function pollReferences(docValue:unknown){const doc=parsed<any>(docValue as any),ids:number[]=[];const final=Number(doc?.chapter?.finalPollId);if(Number.isSafeInteger(final)&&final>0)ids.push(final);for(const scene of Object.values<any>(doc?.scenes??{})){const id=Number(scene?.pollId);if(Number.isSafeInteger(id)&&id>0)ids.push(id);}return ids;}
function mediaId(src:unknown){return typeof src==='string'?src.match(/^\/api\/media\/([a-f0-9-]{36})$/)?.[1]??null:null;}
async function fingerprints(db:Db,jessicaId:string,adminId:string){
 const [hero,chapters,versions,links,admin,progress,sessions]=await Promise.all([
  rows(db,'SELECT id,name,description,media,archived,edit_version FROM heroines WHERE id=?',[jessicaId]),
  rows(db,'SELECT * FROM chapters WHERE heroine_id=? ORDER BY display_order,id',[jessicaId]),
  rows(db,'SELECT v.* FROM chapter_versions v JOIN chapters c ON c.id=v.chapter_id WHERE c.heroine_id=? ORDER BY v.chapter_id,v.revision',[jessicaId]),
  rows(db,'SELECT vm.* FROM version_media vm JOIN chapters c ON c.id=vm.chapter_id WHERE c.heroine_id=? ORDER BY vm.chapter_id,vm.revision,vm.media_id',[jessicaId]),
  rows(db,'SELECT id,email,password_hash,role,key_balance,created_at FROM users WHERE id=?',[adminId]),
  rows(db,'SELECT * FROM progress WHERE user_id=? ORDER BY id',[adminId]),
  rows(db,'SELECT token_hash,user_id,expires_at FROM sessions WHERE user_id=? ORDER BY token_hash',[adminId]),
 ]);
 return {jessica:sha({hero,chapters,versions,links}),admin:sha({admin,progress,sessions})};
}

async function analyze(db:Db):Promise<Analysis>{
 const admins=await rows(db,'SELECT id,email,role,key_balance,password_hash FROM users WHERE LOWER(TRIM(email))=?',[ADMIN_EMAIL]);
 if(admins.length!==1)throw Error(`Expected exactly one ${ADMIN_EMAIL} account, found ${admins.length}.`);
 if(admins[0].role!=='admin')throw Error(`${ADMIN_EMAIL} exists but does not have the admin role.`);
 const stories=await rows(db,'SELECT id,name,archived FROM heroines ORDER BY name,id'),matches=stories.filter(story=>String(story.id).trim().toLowerCase()==='jessica'&&/^jessica(?:\s+story)?$/i.test(String(story.name).trim()));
 if(matches.length!==1)throw Error(`Expected exactly one Jessica story identified by both stable ID and name, found ${matches.length}. Candidates: ${stories.map(story=>`${story.id}=${story.name}`).join(', ')}`);
 const admin=admins[0],jessica=matches[0];
 const deletedStoryIds=stories.filter(story=>story.id!==jessica.id).map(story=>String(story.id));
 const deletedChapters=deletedStoryIds.length?await rows(db,`SELECT id FROM chapters WHERE heroine_id IN (${placeholders(deletedStoryIds)})`,deletedStoryIds):[];
 const deletedChapterIds=deletedChapters.map(chapter=>String(chapter.id));
 const documents=await rows(db,'SELECT v.document FROM chapter_versions v JOIN chapters c ON c.id=v.chapter_id WHERE c.heroine_id=?',[jessica.id]);
 const keptPollIds=[...new Set(documents.flatMap(document=>pollReferences(document.document)))].sort((a,b)=>a-b);
 const polls=await rows(db,'SELECT id,admin_title,type,status,canonical_option_id,official_total FROM polls ORDER BY id');
 const deletedPollIds=polls.map(poll=>Number(poll.id)).filter(id=>!keptPollIds.includes(id));
 const adminForeign=await rows(db,'SELECT COUNT(*) AS n FROM progress WHERE user_id=? AND heroine_id<>?',[admin.id,jessica.id]);
 const projectedLedger=await rows(db,`SELECT balance_after FROM key_transactions WHERE user_id=? ${deletedChapterIds.length?`AND (chapter_id IS NULL OR chapter_id NOT IN (${placeholders(deletedChapterIds)}))`:''} AND (admin_id IS NULL OR admin_id=?) ORDER BY created_at DESC,id DESC LIMIT 1`,[admin.id,...deletedChapterIds,admin.id]);
 const projectedLastBalance=projectedLedger[0]?Number(projectedLedger[0].balance_after):null,adminBalance=Number(admin.key_balance);
 if(Number(adminForeign[0].n)>0)throw Error('Administrator reading progress exists outside Jessica; cleanup stopped to preserve it.');
 if(projectedLastBalance!==null&&projectedLastBalance!==adminBalance)throw Error(`Administrator balance ${adminBalance} would not match the remaining ledger balance ${projectedLastBalance}.`);
 const keptMedia=new Set<string>();
 const linkRows=await rows(db,'SELECT DISTINCT vm.media_id FROM version_media vm JOIN chapters c ON c.id=vm.chapter_id WHERE c.heroine_id=?',[jessica.id]);for(const item of linkRows)keptMedia.add(String(item.media_id));
 for(const item of documents){const document=parsed<any>(item.document);for(const scene of Object.values<any>(document?.scenes??{})){const source=mediaId(scene?.media?.src),poster=mediaId(scene?.media?.poster);if(source)keptMedia.add(source);if(poster)keptMedia.add(poster);}}
 const portrait=mediaId(parsed<any>(jessica.media)?.src);if(portrait)keptMedia.add(portrait);
 const assets=await rows(db,'SELECT id,filename,poster_id,trashed_at FROM media_assets ORDER BY id');let changed=true;while(changed){changed=false;for(const asset of assets)if(keptMedia.has(String(asset.id))&&asset.poster_id&&!keptMedia.has(String(asset.poster_id))){keptMedia.add(String(asset.poster_id));changed=true;}}
 const unusedMedia=assets.filter(asset=>!keptMedia.has(String(asset.id))),legacyTrash=await rows(db,'SELECT id,filename FROM media_trash ORDER BY id');
 const fp=await fingerprints(db,String(jessica.id),String(admin.id));
 return {admin,jessica,stories,deletedStoryIds,deletedChapterIds,keptPollIds,deletedPollIds,adminForeignProgress:Number(adminForeign[0].n),adminBalance,projectedLastBalance,counts:await counts(db),polls,unusedMedia,legacyTrash,jessicaFingerprint:fp.jessica,adminFingerprint:fp.admin};
}

function publicAnalysis(value:Analysis){return {
 admin:{id:value.admin.id,email:String(value.admin.email).toLowerCase(),role:value.admin.role,keyBalance:value.adminBalance},
 jessica:{id:value.jessica.id,name:value.jessica.name,archived:!!value.jessica.archived,fingerprint:value.jessicaFingerprint},
 stories:value.stories.map(story=>({id:story.id,name:story.name,action:story.id===value.jessica.id?'keep':'delete'})),
 chaptersToDelete:value.deletedChapterIds,pollsToKeep:value.keptPollIds,pollsToDelete:value.deletedPollIds,
 pollStatus:value.polls.map(poll=>({id:Number(poll.id),title:poll.admin_title,status:poll.status,action:value.keptPollIds.includes(Number(poll.id))?'keep and reset results':'delete'})),
 unusedManagedMedia:value.unusedMedia.map(media=>({id:media.id,filename:media.filename,location:media.trashed_at?'trash':'library'})),legacyTrashFiles:value.legacyTrash.length,
 counts:value.counts,
};}

async function deleteIn(db:Db,table:string,column:string,ids:any[]){if(!ids.length)return 0;const [result]=await db.execute(`DELETE FROM \`${table}\` WHERE \`${column}\` IN (${placeholders(ids)})`,ids) as [ResultSetHeader,unknown];return result.affectedRows;}
async function quarantineFiles(items:{file:string;root:string}[],runId:string){const dir=path.resolve('.local/cleanup-quarantine',runId),moved:{from:string;to:string}[]=[];await fs.mkdir(dir,{recursive:true});try{for(const [index,item] of items.entries()){const from=path.join(item.root,item.file);try{await fs.access(from);}catch{continue;}const to=path.join(dir,`${index}-${path.basename(item.file)}`);await fs.rename(from,to);moved.push({from,to});}return {dir,moved};}catch(error){for(const item of moved.reverse())await fs.rename(item.to,item.from).catch(()=>{});throw error;}}

async function applyCleanup(connection:PoolConnection,before:Analysis){
 const runId=`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`,moved:{from:string;to:string}[]=[];let quarantine='';
 try{
  await connection.beginTransaction();
  await connection.query('SELECT id FROM users FOR UPDATE');await connection.query('SELECT id FROM heroines FOR UPDATE');await connection.query('SELECT id FROM chapters FOR UPDATE');await connection.query('SELECT id FROM polls FOR UPDATE');await connection.query('SELECT id FROM media_assets FOR UPDATE');
  const locked=await analyze(connection);if(locked.jessicaFingerprint!==before.jessicaFingerprint||locked.adminFingerprint!==before.adminFingerprint)throw Error('Protected Jessica or administrator data changed after preflight. Retry from a fresh backup.');

  await connection.execute('DELETE FROM poll_result_snapshots');await connection.execute('DELETE FROM poll_views');await connection.execute('DELETE FROM poll_votes');await connection.execute('DELETE FROM poll_progress');
  await connection.execute('UPDATE polls SET canonical_option_id=NULL,official_total=NULL,closed_at=NULL');
  await connection.execute('DELETE FROM plan_analytics_events');await connection.execute("DELETE FROM analytics_events WHERE event_type='billing_page_opened' OR poll_id IS NOT NULL OR event_type IN ('guest_poll_seen','guest_poll_skipped')");

  const otherUsers=await rows(connection,'SELECT id FROM users WHERE id<>?',[locked.admin.id]),otherUserIds=otherUsers.map(user=>String(user.id));
  if(otherUserIds.length){
   await deleteIn(connection,'sessions','user_id',otherUserIds);await deleteIn(connection,'progress','user_id',otherUserIds);await deleteIn(connection,'chapter_unlocks','user_id',otherUserIds);
   await connection.execute(`DELETE FROM key_transactions WHERE user_id IN (${placeholders(otherUserIds)}) OR admin_id IN (${placeholders(otherUserIds)})`,[...otherUserIds,...otherUserIds]);
   await deleteIn(connection,'analytics_events','user_id',otherUserIds);
   await connection.execute(`UPDATE media_assets SET created_by=? WHERE created_by IN (${placeholders(otherUserIds)})`,[locked.admin.id,...otherUserIds]);
   await connection.execute(`UPDATE media_assets SET trashed_by=NULL WHERE trashed_by IN (${placeholders(otherUserIds)})`,otherUserIds);
   await deleteIn(connection,'users','id',otherUserIds);
  }

  if(locked.deletedChapterIds.length){
   await deleteIn(connection,'progress','chapter_id',locked.deletedChapterIds);await deleteIn(connection,'chapter_unlocks','chapter_id',locked.deletedChapterIds);await deleteIn(connection,'key_transactions','chapter_id',locked.deletedChapterIds);
   await connection.execute(`DELETE FROM analytics_events WHERE chapter_id IN (${placeholders(locked.deletedChapterIds)}) OR heroine_id IN (${placeholders(locked.deletedStoryIds)})`,[...locked.deletedChapterIds,...locked.deletedStoryIds]);
   await deleteIn(connection,'version_media','chapter_id',locked.deletedChapterIds);await deleteIn(connection,'chapter_versions','chapter_id',locked.deletedChapterIds);await deleteIn(connection,'chapters','id',locked.deletedChapterIds);
  }else if(locked.deletedStoryIds.length)await connection.execute(`DELETE FROM analytics_events WHERE heroine_id IN (${placeholders(locked.deletedStoryIds)})`,locked.deletedStoryIds);
  if(locked.deletedPollIds.length){await deleteIn(connection,'poll_options','poll_id',locked.deletedPollIds);await deleteIn(connection,'polls','id',locked.deletedPollIds);}
  await deleteIn(connection,'heroines','id',locked.deletedStoryIds);

  const remaining=await analyze(connection);
  const files=[...remaining.unusedMedia.map(media=>({file:String(media.filename),root:media.trashed_at?trashDir:mediaDir})),...remaining.legacyTrash.map(media=>({file:String(media.filename),root:trashDir}))];
  const q=await quarantineFiles(files,runId);quarantine=q.dir;moved.push(...q.moved);
  if(remaining.unusedMedia.length){const ids=remaining.unusedMedia.map(media=>String(media.id));await connection.execute(`UPDATE media_assets SET poster_id=NULL WHERE id IN (${placeholders(ids)})`,ids);await deleteIn(connection,'media_assets','id',ids);}
  await connection.execute('DELETE FROM media_trash');

  const after=await analyze(connection);if(after.stories.length!==1||after.jessica.id!==locked.jessica.id)throw Error('Story cleanup verification failed.');
  const users=await rows(connection,'SELECT id,email,role,key_balance FROM users');if(users.length!==1||users[0].id!==locked.admin.id||users[0].role!=='admin')throw Error('User cleanup verification failed.');
  if(after.jessicaFingerprint!==locked.jessicaFingerprint||after.adminFingerprint!==locked.adminFingerprint)throw Error('Protected Jessica or administrator data changed during cleanup.');
  if(await count(connection,'poll_votes')||await count(connection,'poll_views')||await count(connection,'poll_result_snapshots')||await count(connection,'poll_progress'))throw Error('Poll result cleanup verification failed.');
  if(await count(connection,'plan_analytics_events'))throw Error('Billing analytics cleanup verification failed.');
  await connection.commit();if(quarantine)await fs.rm(quarantine,{recursive:true,force:true});return after;
 }catch(error){await connection.rollback();for(const item of moved.reverse())await fs.rename(item.to,item.from).catch(()=>{});if(quarantine)await fs.rm(quarantine,{recursive:true,force:true}).catch(()=>{});throw error;}
}

async function orphanCounts(db:Db){const checks:Record<string,string>={
 progressOwner:"SELECT COUNT(*) n FROM progress p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN guest_sessions g ON g.id=p.guest_id WHERE (p.user_id IS NOT NULL AND u.id IS NULL) OR (p.guest_id IS NOT NULL AND g.id IS NULL)",
 progressStory:'SELECT COUNT(*) n FROM progress p LEFT JOIN heroines h ON h.id=p.heroine_id LEFT JOIN chapters c ON c.id=p.chapter_id LEFT JOIN chapter_versions v ON v.chapter_id=p.chapter_id AND v.revision=p.story_revision WHERE h.id IS NULL OR c.id IS NULL OR v.chapter_id IS NULL',
 unlocks:'SELECT COUNT(*) n FROM chapter_unlocks x LEFT JOIN users u ON u.id=x.user_id LEFT JOIN chapters c ON c.id=x.chapter_id WHERE u.id IS NULL OR c.id IS NULL',
 votes:'SELECT COUNT(*) n FROM poll_votes v LEFT JOIN polls p ON p.id=v.poll_id LEFT JOIN poll_options o ON o.id=v.option_id LEFT JOIN users u ON u.id=v.user_id WHERE p.id IS NULL OR o.id IS NULL OR u.id IS NULL',
 keyLedger:'SELECT COUNT(*) n FROM key_transactions t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN users a ON a.id=t.admin_id LEFT JOIN chapters c ON c.id=t.chapter_id WHERE u.id IS NULL OR (t.admin_id IS NOT NULL AND a.id IS NULL) OR (t.chapter_id IS NOT NULL AND c.id IS NULL)',
 mediaOwners:'SELECT COUNT(*) n FROM media_assets m LEFT JOIN users u ON u.id=m.created_by WHERE u.id IS NULL',
 };const result:Record<string,number>={};for(const [name,sql] of Object.entries(checks))result[name]=Number((await rows(db,sql))[0].n);return result;}

const apply=process.argv.includes('--apply'),pool=createPool(testDatabase);
try{
 const before=await analyze(pool);console.log(JSON.stringify({database:testDatabase?'test':'working',mode:apply?'apply':'dry-run',before:publicAnalysis(before)},null,2));
 if(!apply){console.log('Dry run only. Use --apply after creating and verifying a backup.');process.exitCode=0;}
 else{const connection=await pool.getConnection();try{const after=await applyCleanup(connection,before);console.log(JSON.stringify({after:publicAnalysis(after),orphans:await orphanCounts(connection)},null,2));}finally{connection.release();}}
}finally{await pool.end();}
