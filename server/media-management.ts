import fs from 'node:fs';
import path from 'node:path';
import type {Pool,RowDataPacket} from 'mysql2/promise';
import type {Media,Story} from '../src/story-model.ts';

const managed=(id:string)=>'/api/media/'+id;
const safeName=(name:string)=>/^[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4|webm)$/.test(name);
const mediaDir=path.resolve('.local/media'),trashDir=path.resolve('.local/media-trash');
export type MediaCheck={id:string;name:string;status:'eligible'|'blocked'|'missing';uses:string[];archivedUses:string[]};

export async function inspectMedia(pool:Pool,ids:string[]):Promise<MediaCheck[]>{
 const [assets]=await pool.query<RowDataPacket[]>('SELECT id,original_name,poster_id,trashed_at FROM media_assets');
 const [trash]=await pool.query<RowDataPacket[]>('SELECT id,poster_id FROM media_trash');
 const [heroines]=await pool.query<RowDataPacket[]>('SELECT id,name,media FROM heroines');
 const [versions]=await pool.query<RowDataPacket[]>('SELECT chapter_id,revision,status,document FROM chapter_versions');
 const [chapters]=await pool.query<RowDataPacket[]>('SELECT id,published_revision FROM chapters');
 const activePublished=new Map(chapters.map(chapter=>[String(chapter.id),Number(chapter.published_revision)]));
 return ids.map(id=>{
  const asset=assets.find(a=>a.id===id&&!a.trashed_at);if(!asset)return {id,name:id,status:'missing',uses:[],archivedUses:[]};
  const uses:string[]=[],archivedUses:string[]=[];const src=managed(id);
  for(const h of heroines)if((h.media as Media)?.src===src)uses.push(`Story: ${h.name} (${h.id}) portrait`);
  for(const v of versions)for(const s of Object.values((v.document as Story).scenes??{})){
   const current=v.status==='draft'||Number(v.revision)===activePublished.get(String(v.chapter_id));
   const target=current?uses:archivedUses;
   if(s.media?.src===src)target.push(`Chapter ${v.chapter_id} · version ${v.revision} (${v.status}) · ${s.title}: media`);
   if(s.media?.type==='video'&&s.media.poster===src)target.push(`Chapter ${v.chapter_id} · version ${v.revision} (${v.status}) · ${s.title}: video poster`);
  }
  for(const a of assets)if(!a.trashed_at&&a.poster_id===id)uses.push(`Default poster for video: ${a.original_name}`);
  for(const t of trash)if(t.poster_id===id)uses.push(`Poster for recoverable video: ${t.id}`);
  return {id,name:asset.original_name,status:uses.length?'blocked':'eligible',uses,archivedUses};
 });
}

export async function moveMediaToTrash(pool:Pool,ids:string[],actor:string){
 const checks=await inspectMedia(pool,ids);const result=[];
 fs.mkdirSync(trashDir,{recursive:true});
 for(const item of checks){
  if(item.status!=='eligible'){result.push(item);continue;}
  const cx=await pool.getConnection();let from='',to='',moved=false;
  try{
   await cx.beginTransaction();const [rows]=await cx.execute<RowDataPacket[]>('SELECT * FROM media_assets WHERE id=? AND trashed_at IS NULL FOR UPDATE',[item.id]);const row=rows[0];
   if(!row||!safeName(row.filename))throw Error('Managed file is unavailable.');
   from=path.join(mediaDir,row.filename);to=path.join(trashDir,row.filename);
   if(!fs.existsSync(from)||fs.existsSync(to))throw Error('File missing or already in trash.');
   fs.renameSync(from,to);moved=true;
   await cx.execute('UPDATE media_assets SET trashed_at=UTC_TIMESTAMP(3),trashed_by=? WHERE id=?',[actor,row.id]);await cx.commit();
   result.push({...item,status:'deleted'});
  }catch(e){await cx.rollback();if(moved&&fs.existsSync(to))fs.renameSync(to,from);result.push({...item,status:'error',error:e instanceof Error?e.message:'Delete failed.'});}
  finally{cx.release();}
 }
 return result;
}

export async function restoreMedia(pool:Pool,id:string){
 const cx=await pool.getConnection();let from='',to='',moved=false;
 try{
  await cx.beginTransaction();const [softRows]=await cx.execute<RowDataPacket[]>('SELECT * FROM media_assets WHERE id=? AND trashed_at IS NOT NULL FOR UPDATE',[id]);
  const soft=softRows[0];
  if(soft){
   if(!safeName(soft.filename))throw Error('File is not in the recoverable trash.');
   from=path.join(trashDir,soft.filename);to=path.join(mediaDir,soft.filename);
   if(!fs.existsSync(from)||fs.existsSync(to))throw Error('Stored file is unavailable or already restored.');
   fs.renameSync(from,to);moved=true;
   await cx.execute('UPDATE media_assets SET trashed_at=NULL,trashed_by=NULL WHERE id=?',[id]);await cx.commit();return {id,status:'restored'};
  }
  const [rows]=await cx.execute<RowDataPacket[]>('SELECT * FROM media_trash WHERE id=? FOR UPDATE',[id]);const row=rows[0];
  if(!row||!safeName(row.filename))throw Error('File is not in the recoverable trash.');
  from=path.join(trashDir,row.filename);to=path.join(mediaDir,row.filename);
  if(!fs.existsSync(from)||fs.existsSync(to))throw Error('Stored file is unavailable or already restored.');
  const [poster]=row.poster_id?await cx.execute<RowDataPacket[]>('SELECT id FROM media_assets WHERE id=?',[row.poster_id]):[[]];
  fs.renameSync(from,to);moved=true;
  await cx.execute('INSERT INTO media_assets(id,filename,mime,size_bytes,original_name,created_by,poster_id) VALUES(?,?,?,?,?,?,?)',[row.id,row.filename,row.mime,row.size_bytes,row.original_name,row.created_by,poster[0]?.id??null]);
  await cx.execute('DELETE FROM media_trash WHERE id=?',[id]);await cx.commit();return {id,status:'restored'};
 }catch(e){await cx.rollback();if(moved&&fs.existsSync(to))fs.renameSync(to,from);throw e;}
 finally{cx.release();}
}
