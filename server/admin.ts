import {Router} from 'express';
import type {Pool,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import Busboy from 'busboy';
import {fileTypeFromFile} from 'file-type';
import {validateStory} from '../src/story-model.ts';
import {sanitizeSceneText} from '../src/sceneText.ts';
import type {Story} from '../src/story-model.ts';
import {linkMedia,storyFromDb} from './content.ts';
import {inspectMedia,moveMediaToTrash,restoreMedia} from './media-management.ts';
import {adminPollRouter,pollErrors} from './polls.ts';
import {adminBillingRouter} from './billing.ts';
import {adminUsersRouter} from './users.ts';
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(x);
const text=(x:unknown,n:number)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
export const mediaRoot=path.resolve('.local/media');
export const imageLimit=Number(process.env.MEDIA_IMAGE_MB??12)*1024*1024;
export const videoLimit=Number(process.env.MEDIA_VIDEO_MB??200)*1024*1024;
const sanitizeStoryText=(story:Story)=>{for(const scene of Object.values(story.scenes))scene.text=sanitizeSceneText(scene.text);return story;};
const types:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'};
export async function mediaErrors(pool:Pool,story:Story){
 const errors:string[]=[];
 for(const s of Object.values(story.scenes)){
  for(const [src,want] of [[s.media?.src,s.media?.type],[s.media?.type==='video'?s.media.poster:null,'image']]){
   if(!src)continue;
   if(/^\/media\/[a-zA-Z0-9-]+\.(jpg|png|webp|gif|svg|mp4|webm)$/.test(src)){
    // Existing local assets are kept as immutable legacy media, never accepted as upload paths.
    const file=path.resolve('public','.'+src);const ext=path.extname(file);
    if(!fs.existsSync(file)||((want==='video')!==['.mp4','.webm'].includes(ext)))errors.push(`${s.title}: legacy media unavailable or wrong type.`);
   }else{
    const id=src.match(/^\/api\/media\/([a-f0-9-]{36})$/)?.[1];
    const [rows]=id?await pool.execute<RowDataPacket[]>('SELECT filename,mime FROM media_assets WHERE id=? AND trashed_at IS NULL',[id]):[[]];
    if(!rows[0]||!rows[0].mime.startsWith(want+'/')||!fs.existsSync(path.join(mediaRoot,rows[0].filename)))errors.push(`${s.title}: choose an uploaded ${want} file.`);
   }
  }
 }
 return errors;
}
function safeDocument(value:any,id:string,revision:number):value is Story{
 if(!value||typeof value!=='object'||!value.chapter||value.chapter.id!==id||value.chapter.revision!==revision||!text(value.chapter.title,200)||typeof value.chapter.firstScene!=='string'||typeof value.chapter.subtitle!=='string'||typeof value.chapter.description!=='string'||!Number.isSafeInteger(value.chapter.freeSteps)||value.chapter.freeSteps<1||value.chapter.freeSteps>100||(value.chapter.displayOrder!==undefined&&!Number.isSafeInteger(value.chapter.displayOrder))||(value.chapter.keyCost!==undefined&&(!Number.isSafeInteger(value.chapter.keyCost)||value.chapter.keyCost<0||value.chapter.keyCost>10000))||(value.chapter.guestFree!==undefined&&typeof value.chapter.guestFree!=='boolean')||!value.scenes||typeof value.scenes!=='object'||Array.isArray(value.scenes))return false;
 const entries=Object.entries(value.scenes);if(entries.length>100)return false;
 return entries.every(([sid,s]:[string,any])=>validId(sid)&&s&&s.id===sid&&['story','poll'].includes(s.type??'story')&&typeof s.title==='string'&&s.title.length<=200&&typeof s.text==='string'&&s.text.length<=20000&&Number.isFinite(s.step)&&typeof s.final==='boolean'&&((s.type==='poll'&&!s.media)||s.media&&['image','video'].includes(s.media.type)&&typeof s.media.src==='string'&&s.media.src.length<300&&typeof s.media.alt==='string'&&(s.media.type!=='video'||typeof s.media.poster==='string'))&&Array.isArray(s.actions)&&s.actions.length<=20&&s.actions.every((a:any)=>validId(a.id)&&typeof a.label==='string'&&a.label.length<=200&&typeof a.target==='string'&&(!a.choice||(typeof a.choice.key==='string'&&typeof a.choice.value==='string')))&&(!s.variants||(Array.isArray(s.variants)&&s.variants.every((v:any)=>typeof v.key==='string'&&typeof v.value==='string'&&typeof v.text==='string'))));
}
export function adminRouter(pool:Pool){
 const router=Router();
 router.use('/polls',adminPollRouter(pool));
 router.use('/billing',adminBillingRouter(pool));
 router.use('/users',adminUsersRouter(pool));
 // Mutations that can add or remove media references share one database lock across API processes.
 router.use(async(req,res,next)=>{
  const protectedMutation=(req.method==='POST'&&req.path==='/heroines')||(req.method==='PUT'&&req.path.startsWith('/heroines/'))||
   (req.method==='PUT'&&/\/draft\//.test(req.path))||(req.method==='POST'&&(/\/draft$/.test(req.path)||/\/publish\//.test(req.path)))||
   (req.method==='POST'&&['/media/delete','/media/restore'].includes(req.path))||(req.method==='PUT'&&/\/media\/[^/]+\/poster$/.test(req.path));
  if(!protectedMutation)return next();
  const lock=await pool.getConnection();let released=false;
  try{const [rows]=await lock.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(), ':content-media'),30) AS acquired");if(rows[0]?.acquired!==1)throw Error('Media operation is busy. Try again.');
   const release=()=>{if(released)return;released=true;void lock.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':content-media'))").catch(()=>{}).finally(()=>lock.release());};
   res.once('finish',release);res.once('close',release);next();
  }catch(e){lock.release();next(e);}
 });
 router.get('/heroines',async(_req,res)=>{const [rows]=await pool.query("SELECT h.*,(SELECT COUNT(*) FROM chapters c WHERE c.heroine_id=h.id) AS chapter_count,(SELECT COUNT(*) FROM chapters c WHERE c.heroine_id=h.id AND c.published_revision IS NOT NULL AND c.archived=FALSE) AS published_count,(SELECT COUNT(DISTINCT c.id) FROM chapters c JOIN chapter_versions v ON v.chapter_id=c.id AND v.status='draft' WHERE c.heroine_id=h.id) AS draft_count FROM heroines h ORDER BY h.name");res.json(rows);});
 router.post('/heroines',async(req,res)=>{
  const {id,name,description,media}=req.body??{};
  if(!validId(id)||!text(name,120)||typeof description!=='string'||description.length>10000||!media||media.type!=='image'||typeof media.src!=='string'||typeof media.alt!=='string'){res.status(400).json({error:'Provide an ID, name, description and portrait.'});return;}
  const errors=await mediaErrors(pool,{scenes:{portrait:{title:name,media}}} as unknown as Story);if(!media.src||errors.length){res.status(400).json({error:errors.join(' ')||'Choose a portrait.'});return;}
  try{await pool.execute('INSERT INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[id,name,description,JSON.stringify(media)]);res.status(201).json({id});}catch(e){if((e as any).code==='ER_DUP_ENTRY'){res.status(409).json({error:'This heroine ID already exists.'});return;}throw e;}
 });
 router.put('/heroines/:id',async(req,res)=>{
  const {name,description,media,version,archived}=req.body??{};
  if(!text(name,120)||typeof description!=='string'||description.length>10000||!media||media.type!=='image'||!media.src||typeof media.alt!=='string'||!Number.isSafeInteger(version)){res.status(400).json({error:'Check heroine fields.'});return;}
  const errors=await mediaErrors(pool,{scenes:{portrait:{title:name,media}}} as unknown as Story);if(errors.length){res.status(400).json({error:errors.join(' ')});return;}
  const [r]=await pool.execute<ResultSetHeader>('UPDATE heroines SET name=?,description=?,media=?,archived=?,edit_version=edit_version+1 WHERE id=? AND edit_version=?',[name,description,JSON.stringify(media),!!archived,req.params.id,version]);
  res.status(r.affectedRows?200:409).json(r.affectedRows?{ok:true}:{error:'Heroine changed in another tab. Reload before editing.'});
 });
 router.get('/chapters',async(req,res)=>{const [rows]=await pool.execute("SELECT c.*,v.revision AS draft_revision FROM chapters c LEFT JOIN (SELECT chapter_id,MAX(revision) AS revision FROM chapter_versions WHERE status='draft' GROUP BY chapter_id) v ON v.chapter_id=c.id WHERE c.heroine_id=? ORDER BY c.display_order,c.id",[String(req.query.heroine??'')]);res.json(rows);});
 router.post('/chapters',async(req,res)=>{
  const {heroineId,title,description=''}=req.body??{};
  const id=req.body?.id??`chapter-${randomUUID()}`;
  if(!validId(id)||!validId(heroineId)||!text(title,200)||typeof description!=='string'||description.length>10000){res.status(400).json({error:'Check chapter heroine and title.'});return;}
  const c=await pool.getConnection();try{await c.beginTransaction();
   const [heroine]=await c.execute<RowDataPacket[]>('SELECT id FROM heroines WHERE id=? FOR UPDATE',[heroineId]);
   if(!heroine.length){await c.rollback();res.status(404).json({error:'Story not found.'});return;}
   const [last]=await c.execute<RowDataPacket[]>('SELECT MAX(display_order) AS last_order FROM chapters WHERE heroine_id=?',[heroineId]);
   const order=last[0].last_order===null?0:Number(last[0].last_order)+1;
   if(!Number.isSafeInteger(order)||order>2147483647){await c.rollback();res.status(409).json({error:'Chapter order limit reached.'});return;}
    await c.execute('INSERT INTO chapters(id,heroine_id,title,description,display_order,key_cost) VALUES(?,?,?,?,?,1)',[id,heroineId,title,description,order]);
    const document:Story={chapter:{id,heroineId,revision:1,title,description,subtitle:title,firstScene:'',freeSteps:5,displayOrder:order,keyCost:1,guestFree:false},scenes:{}};
   await c.execute('INSERT INTO chapter_versions(chapter_id,revision,document) VALUES(?,1,?)',[id,JSON.stringify(document)]);await c.commit();res.status(201).json({id,display_order:order});
  }catch(e){await c.rollback();if(['ER_DUP_ENTRY','ER_NO_REFERENCED_ROW_2'].includes((e as any).code)){res.status(409).json({error:'ID already exists or heroine is missing.'});return;}throw e;}finally{c.release();}
 });
 router.put('/chapters/:id/move',async(req,res)=>{
  const direction=req.body?.direction;
  if(direction!==-1&&direction!==1){res.status(400).json({error:'Choose Up or Down.'});return;}
  const c=await pool.getConnection();try{await c.beginTransaction();
   const [target]=await c.execute<RowDataPacket[]>('SELECT heroine_id FROM chapters WHERE id=?',[req.params.id]);
   if(!target.length){await c.rollback();res.status(404).json({error:'Chapter not found.'});return;}
   await c.execute('SELECT id FROM heroines WHERE id=? FOR UPDATE',[target[0].heroine_id]);
   const [rows]=await c.execute<RowDataPacket[]>('SELECT id FROM chapters WHERE heroine_id=? ORDER BY display_order,id FOR UPDATE',[target[0].heroine_id]);
   const index=rows.findIndex(row=>row.id===req.params.id),other=index+direction;
   if(index<0||other<0||other>=rows.length){await c.rollback();res.status(409).json({error:'Chapter is already at the end of the list.'});return;}
   [rows[index],rows[other]]=[rows[other],rows[index]];
   for(let i=0;i<rows.length;i++)await c.execute('UPDATE chapters SET display_order=? WHERE id=?',[i,rows[i].id]);
   await c.commit();res.json({ok:true});
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 });
 router.post('/chapters/:id/draft',async(req,res)=>{
  const c=await pool.getConnection();try{await c.beginTransaction();
   const [ch]=await c.execute<RowDataPacket[]>('SELECT * FROM chapters WHERE id=? FOR UPDATE',[req.params.id]);if(!ch[0]){res.status(404).json({error:'Chapter not found.'});return;}
   const [drafts]=await c.execute<RowDataPacket[]>("SELECT revision,edit_version,document FROM chapter_versions WHERE chapter_id=? AND status='draft'",[req.params.id]);
   if(drafts[0]){drafts[0].document.chapter.keyCost=Number(ch[0].key_cost);drafts[0].document.chapter.guestFree=!!ch[0].guest_free;await c.commit();res.json(drafts[0]);return;}
   const [latest]=await c.execute<RowDataPacket[]>('SELECT MAX(revision) AS n FROM chapter_versions WHERE chapter_id=?',[req.params.id]);
   const doc=await storyFromDb(c,String(req.params.id));if(!doc){res.status(409).json({error:'No published chapter to copy.'});return;}
   doc.chapter.revision=Number(latest[0].n)+1;doc.chapter.keyCost=Number(ch[0].key_cost);doc.chapter.guestFree=!!ch[0].guest_free;
   await c.execute('INSERT INTO chapter_versions(chapter_id,revision,document) VALUES(?,?,?)',[req.params.id,doc.chapter.revision,JSON.stringify(doc)]);await linkMedia(c,doc);await c.commit();res.json({revision:doc.chapter.revision,edit_version:1,document:doc});
  }catch(e){await c.rollback();throw e;}finally{await c.rollback();c.release();}
 });
 router.get('/chapters/:id/preview/:revision',async(req,res)=>{const story=await storyFromDb(pool,String(req.params.id),Number(req.params.revision),false);if(!story){res.status(404).json({error:'Version not found.'});return;}res.json(story);});
 router.post('/chapters/:id/check/:revision',async(req,res)=>{const id=String(req.params.id),revision=Number(req.params.revision),document=req.body?.document;
  if(!safeDocument(document,id,revision)){res.status(400).json({error:'Invalid chapter fields or scene structure.'});return;}
  sanitizeStoryText(document);
  const [rows]=await pool.execute<RowDataPacket[]>("SELECT 1 FROM chapter_versions WHERE chapter_id=? AND revision=? AND status='draft'",[id,revision]);
  if(!rows.length){res.status(409).json({error:'This draft was published or removed in another tab.'});return;}
  const errors=[...validateStory(document),...await mediaErrors(pool,document),...await pollErrors(pool,document)];res.json({errors:[...new Set(errors)]});
 });
 router.put('/chapters/:id/draft/:revision',async(req,res)=>{
  const id=String(req.params.id),revision=Number(req.params.revision),{document,version}=req.body??{};
  if(!Number.isSafeInteger(version)||!safeDocument(document,id,revision)){res.status(400).json({error:'Invalid chapter fields or scene structure.'});return;}
  sanitizeStoryText(document);
  const c=await pool.getConnection();try{await c.beginTransaction();
   const [rows]=await c.execute<RowDataPacket[]>("SELECT document,edit_version FROM chapter_versions WHERE chapter_id=? AND revision=? AND status='draft' FOR UPDATE",[id,revision]);
   if(!rows[0]||rows[0].edit_version!==version){res.status(409).json({error:'Draft changed or was published in another tab. Reopen it before saving.'});return;}
   const old=rows[0].document as Story;
   const mediaProblems=await mediaErrors(pool,document);if(mediaProblems.length){res.status(400).json({error:mediaProblems.join(' ')});return;}
   const pollProblems=await pollErrors(c,document);if(pollProblems.length){res.status(400).json({error:pollProblems.join(' ')});return;}
   // Heroine and chapter IDs cannot be moved by a stale/manipulated document.
   document.chapter.heroineId=old.chapter.heroineId;
    const cost=document.chapter.guestFree?0:Number(document.chapter.keyCost??1);document.chapter.keyCost=cost;document.chapter.guestFree=!!document.chapter.guestFree;
    if(document.chapter.guestFree)await c.execute('UPDATE chapters SET guest_free=FALSE WHERE id<>?',[id]);
    await c.execute('UPDATE chapters SET key_cost=?,guest_free=? WHERE id=?',[cost,document.chapter.guestFree,id]);
    await c.execute('UPDATE chapter_versions SET document=?,edit_version=edit_version+1 WHERE chapter_id=? AND revision=?',[JSON.stringify(document),id,revision]);
   await c.execute('UPDATE chapters SET title=?,description=? WHERE id=? AND published_revision IS NULL',[document.chapter.title,document.chapter.description??'',id]);
   await linkMedia(c,document);await c.commit();res.json({edit_version:version+1,document});
  }catch(e){await c.rollback();throw e;}finally{await c.rollback();c.release();}
 });
 router.post('/chapters/:id/publish/:revision',async(req,res)=>{
  const id=String(req.params.id),revision=Number(req.params.revision);const c=await pool.getConnection();
  try{await c.beginTransaction();const [chapters]=await c.execute<RowDataPacket[]>('SELECT id,published_revision FROM chapters WHERE id=? FOR UPDATE',[id]);
   if(!chapters.length){res.status(404).json({error:'Chapter not found.'});return;}
   const [rows]=await c.execute<RowDataPacket[]>("SELECT document,edit_version FROM chapter_versions WHERE chapter_id=? AND revision=? AND status='draft' FOR UPDATE",[id,revision]);
   if(!rows[0]||rows[0].edit_version!==req.body?.version){res.status(409).json({error:'Draft changed or was already published. Reopen it.'});return;}
   const story=sanitizeStoryText(rows[0].document as Story);const errors=[...validateStory(story),...await mediaErrors(pool,story),...await pollErrors(pool,story)];
   if(errors.length){res.status(422).json({error:'Fix these issues before publishing.',errors});return;}
   let publishedRevision=revision;
   if(revision<=Number(chapters[0].published_revision??0)){
    const [versions]=await c.execute<RowDataPacket[]>('SELECT MAX(revision) AS latest FROM chapter_versions WHERE chapter_id=?',[id]);
    publishedRevision=Number(versions[0].latest)+1;
    const copy=structuredClone(story);copy.chapter.revision=publishedRevision;
    await c.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,?,'published',?)",[id,publishedRevision,JSON.stringify(copy)]);
    await linkMedia(c,copy);
   }
   await linkMedia(c,story);await c.execute("UPDATE chapter_versions SET status='published',document=?,edit_version=edit_version+1 WHERE chapter_id=? AND revision=?",[JSON.stringify(story),id,revision]);
   await c.execute('UPDATE chapters SET published_revision=?,title=?,description=?,archived=FALSE WHERE id=?',[publishedRevision,story.chapter.title,story.chapter.description??'',id]);await c.commit();res.json({ok:true,revision:publishedRevision});
  }catch(e){await c.rollback();throw e;}finally{await c.rollback();c.release();}
 });
 router.put('/chapters/:id/archive',async(req,res)=>{const [r]=await pool.execute<ResultSetHeader>('UPDATE chapters SET archived=? WHERE id=? AND published_revision <=> ?',[!!req.body.archived,req.params.id,req.body.revision??null]);res.status(r.affectedRows?200:409).json(r.affectedRows?{ok:true}:{error:'Chapter changed. Refresh the list.'});});
 router.get('/media',async(_req,res)=>{const [rows]=await pool.query('SELECT m.id,m.mime,m.size_bytes,m.original_name,m.poster_id,IF(p.id IS NULL,NULL,CONCAT(?,p.id)) AS poster_src FROM media_assets m LEFT JOIN media_assets p ON p.id=m.poster_id AND p.trashed_at IS NULL WHERE m.trashed_at IS NULL ORDER BY m.created_at DESC',['/api/media/']);res.json(rows);});
 router.get('/media/trash',async(_req,res)=>{const [rows]=await pool.query("SELECT id,original_name,mime,trashed_at AS deleted_at FROM media_assets WHERE trashed_at IS NOT NULL UNION ALL SELECT id,original_name,mime,deleted_at FROM media_trash ORDER BY deleted_at DESC LIMIT 500");res.json(rows);});
 router.post('/media/inspect',async(req,res)=>{const ids=req.body?.ids;if(!Array.isArray(ids)||ids.length>100||ids.some((id:unknown)=>typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))){res.status(400).json({error:'Select up to 100 managed files.'});return;}res.json({files:await inspectMedia(pool,[...new Set(ids)])});});
 router.post('/media/delete',async(req,res)=>{const ids=req.body?.ids;if(!Array.isArray(ids)||ids.length>100||ids.some((id:unknown)=>typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))){res.status(400).json({error:'Select up to 100 managed files.'});return;}res.json({files:await moveMediaToTrash(pool,[...new Set(ids)],res.locals.user.id)});});
 router.post('/media/restore',async(req,res)=>{const id=req.body?.id;if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id)){res.status(400).json({error:'Choose a file in trash.'});return;}try{res.json(await restoreMedia(pool,id));}catch(e){res.status(409).json({error:e instanceof Error?e.message:'Restore failed.'});}});
 router.put('/media/:id/poster',async(req,res)=>{const id=req.params.id,posterId=req.body?.posterId,replace=req.body?.replace===true;
  if(! /^[a-f0-9-]{36}$/.test(id)||! /^[a-f0-9-]{36}$/.test(posterId)){res.status(400).json({error:'Choose a video and an image poster.'});return;}
  const [files]=await pool.execute<RowDataPacket[]>('SELECT id,mime FROM media_assets WHERE id IN (?,?) AND trashed_at IS NULL',[id,posterId]);
  if(files.find(f=>f.id===id)?.mime?.startsWith('video/')!==true||files.find(f=>f.id===posterId)?.mime?.startsWith('image/')!==true){res.status(400).json({error:'Poster must be an uploaded image for an uploaded video.'});return;}
  const [r]=await pool.execute<ResultSetHeader>('UPDATE media_assets SET poster_id=? WHERE id=? AND (poster_id IS NULL OR ?)',[posterId,id,replace]);
  if(!r.affectedRows){res.status(409).json({error:'This video already has a poster. Choose Replace poster explicitly.'});return;}res.json({id,posterId,poster:'/api/media/'+posterId});
 });
 router.post('/media',async(req,res)=>{
  fs.mkdirSync(mediaRoot,{recursive:true});const id=randomUUID(),temp=path.join(mediaRoot,id+'.part');
  let filename='',count=0,truncated=false,writeFailed=false;const writes:Promise<void>[]=[];
  try{
   const parser=Busboy({headers:req.headers,defParamCharset:'utf8',limits:{files:1,fileSize:Math.max(imageLimit,videoLimit),fields:0,parts:1}});
   parser.on('file',(_field,file,info)=>{count++;filename=path.basename(info.filename).slice(0,255);file.on('limit',()=>{truncated=true;});writes.push(pipeline(file,fs.createWriteStream(temp,{flags:'wx'})).catch(()=>{writeFailed=true;}));});
   parser.on('filesLimit',()=>{truncated=true;});parser.on('fieldsLimit',()=>{truncated=true;});
   await pipeline(req,parser);await Promise.all(writes);
   if(count!==1||truncated||writeFailed)throw Error('Upload one file within the size limit.');
   const detected=await fileTypeFromFile(temp);const stat=fs.statSync(temp);const ext=detected&&types[detected.mime];
   if(!detected||!ext||stat.size>(detected.mime.startsWith('image/')?imageLimit:videoLimit))throw Error('Unsupported file content or file too large. Use JPEG, PNG, WebP, GIF, MP4 or WebM.');
   const safe=id+'.'+ext;fs.renameSync(temp,path.join(mediaRoot,safe));
   await pool.execute('INSERT INTO media_assets(id,filename,mime,size_bytes,original_name,created_by) VALUES(?,?,?,?,?,?)',[id,safe,detected.mime,stat.size,filename,res.locals.user.id]);
   res.status(201).json({id,src:'/api/media/'+id,mime:detected.mime});
  }catch{await Promise.allSettled(writes);if(fs.existsSync(temp))fs.unlinkSync(temp);if(!res.headersSent)res.status(400).json({error:'Upload rejected. Use one JPEG/PNG/WebP/GIF (up to '+imageLimit/1024/1024+' MB) or MP4/WebM (up to '+videoLimit/1024/1024+' MB).'});}
 });
 return router;
}

