import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { decodeProgress, initialProgress } from '../src/progress.ts';
import {storyFromDb} from './content.ts';
import {adminRouter,mediaRoot} from './admin.ts';
import {guestIdentity,readingRouter,transferGuest} from './reading.ts';
import {readerPollRouter} from './polls.ts';
import {recordEvent} from './analytics.ts';
import {billingRouter} from './billing.ts';
import path from 'node:path';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const cookieName = 'jessica_session';
const ttl = 7 * 24 * 60 * 60 * 1000;
export function createApp(pool: Pool, origin: string, production = false) {
 const app=express();
 app.disable('x-powered-by');
 if(production)app.set('trust proxy',1);
 app.use(helmet()); app.use(express.json({limit:'1mb'})); app.use(cookieParser());
 app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const cookie = { httpOnly:true, secure:production, sameSite:'lax' as const, path:'/api' };
 const csrfSecret=randomBytes(32);
 const csrfSignature=(random:string)=>createHmac('sha256',csrfSecret).update(random).digest('hex');
 app.get('/api/health',async(_req,res)=>{
  try{await pool.query('SELECT 1');res.json({status:'ok'});}
  catch{res.status(503).json({status:'unavailable'});}
 });
 app.get('/api/csrf',(req,res)=>{
  const random=randomBytes(32).toString('hex');
  res.json({token:random+'.'+csrfSignature(random)});
 });
 app.use('/api',(req,res,next)=>{
  if(['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const token=req.get('X-CSRF-Token');const match=typeof token==='string'?token.match(/^([a-f0-9]{64})\.([a-f0-9]{64})$/):null;
  const valid=match&&timingSafeEqual(Buffer.from(match[2]),Buffer.from(csrfSignature(match[1])));
  if(req.get('Origin')!==origin || !valid) {res.status(403).json({error:'Request verification failed. Refresh and try again.'});return;}
  next();
 });
 const authLimit=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many attempts. Please try again later.'}});
 const credentials=(body:unknown,minimum=1)=>{
  if(!body||typeof body!=='object')return null;
  const {email,password}=body as Record<string,unknown>;
  if(typeof email!=='string'||typeof password!=='string')return null;
  const normalized=email.trim().toLowerCase();
  if(normalized.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(normalized)||password.length<minimum||password.length>128)return null;
  return {email:normalized,password};
 };
 async function session(req:Request) {
  const token=req.cookies[cookieName];if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return null;
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT u.id,u.email,u.role,u.key_balance FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)',[hash(token)]);
  return rows[0] ? {id:String(rows[0].id),email:String(rows[0].email),role:String(rows[0].role),keyBalance:Number(rows[0].key_balance)} : null;
 }
 async function issue(req:Request,res:Response,id:string,email:string) {
  const token=randomBytes(32).toString('hex');
  if(typeof req.cookies[cookieName]==='string')await pool.execute('DELETE FROM sessions WHERE token_hash=?',[hash(req.cookies[cookieName])]);
  await pool.execute('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',[hash(token),id,new Date(Date.now()+ttl)]);
   const [roles]=await pool.execute<RowDataPacket[]>('SELECT role,key_balance FROM users WHERE id=?',[id]);
   res.cookie(cookieName,token,{...cookie,maxAge:ttl});res.json({user:{id,email,role:roles[0].role,keyBalance:Number(roles[0].key_balance)}});
 }
 app.post('/api/auth/register',authLimit,async(req,res)=>{
  const password=(req.body as {password?:unknown})?.password;if(typeof password!=='string'||password.length<6){res.status(400).json({error:'Password must be at least 6 characters long.'});return;}
  const data=credentials(req.body,6);if(!data){res.status(400).json({error:password.length>128?'Password must be no more than 128 characters long.':'Use a valid email address.'});return;}
  const passwordHash=await argon2.hash(data.password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  const id=randomUUID();
   try {const c=await pool.getConnection();try{await c.beginTransaction();await c.execute('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)',[id,data.email,passwordHash]);const moved=await transferGuest(c,req,id);await recordEvent(c,'registration_completed',{userId:id,guestId:moved.guestId},{source:'guest-registration'});await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}}
  catch(e){if((e as {code?:string}).code==='ER_DUP_ENTRY'){res.status(409).json({error:'Unable to register with these details. Try signing in.'});return;}throw e;}
  await issue(req,res,id,data.email);
 });
 const dummyHash=argon2.hash(randomBytes(32),{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
 app.post('/api/auth/login',authLimit,async(req,res)=>{
  const data=credentials(req.body);if(!data){res.status(401).json({error:'Email or password is incorrect.'});return;}
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT id,email,password_hash FROM users WHERE email=?',[data.email]);
  const valid=await argon2.verify(rows[0]?.password_hash ?? await dummyHash,data.password);
  if(!rows[0]||!valid){res.status(401).json({error:'Email or password is incorrect.'});return;}
  await issue(req,res,String(rows[0].id),String(rows[0].email));
 });
 app.get('/api/auth/me',async(req,res)=>{res.json({user:await session(req)});});
 app.post('/api/auth/logout',async(req,res)=>{const token=req.cookies[cookieName];if(typeof token==='string')await pool.execute('DELETE FROM sessions WHERE token_hash=?',[hash(token)]);res.clearCookie(cookieName,cookie);res.json({ok:true});});
 app.use('/api/admin',async(req,res,next)=>{const user=await session(req);if(!user||user.role!=='admin'){res.status(user?403:401).json({error:'Administrator access required.'});return;}res.locals.user=user;next();},adminRouter(pool));
 app.use('/api/billing',billingRouter(pool,session));
 app.use('/api/polls',readerPollRouter(pool,session));
 app.use('/api/reading',readingRouter(pool,session,production));
 app.get('/api/content/catalog',async(req,res)=>{
  const user=await session(req);
  const [heroines]=await pool.query<RowDataPacket[]>(`SELECT id,name,description,media FROM heroines h WHERE archived=FALSE ${user?'':'AND EXISTS(SELECT 1 FROM chapters c WHERE c.heroine_id=h.id AND c.archived=FALSE AND c.published_revision IS NOT NULL AND c.guest_free=TRUE)'} ORDER BY name`);
  const [chapters]=user
   ?await pool.execute<RowDataPacket[]>('SELECT c.id,c.heroine_id,c.title,c.description,c.published_revision AS revision,c.key_cost,c.guest_free,(c.key_cost=0 OR EXISTS(SELECT 1 FROM chapter_unlocks u WHERE u.user_id=? AND u.chapter_id=c.id)) AS unlocked FROM chapters c WHERE c.archived=FALSE AND c.published_revision IS NOT NULL ORDER BY c.display_order,c.id',[user.id])
   :await pool.query<RowDataPacket[]>('SELECT id,heroine_id,title,description,published_revision AS revision FROM chapters WHERE archived=FALSE AND published_revision IS NOT NULL AND guest_free=TRUE ORDER BY display_order,id');
  res.json(heroines.map(h=>({...h,chapters:chapters.filter(c=>c.heroine_id===h.id).map(c=>user?{id:c.id,title:c.title,description:c.description,revision:Number(c.revision),keyCost:Number(c.key_cost),guestFree:!!c.guest_free,unlocked:!!c.unlocked}:{id:c.id,title:c.title,description:c.description,revision:Number(c.revision)})})).filter(h=>h.chapters.length));
 });
 app.get('/api/content/home',async(_req,res)=>{
  const [stories]=await pool.query<RowDataPacket[]>("SELECT h.id,h.name,h.description,h.media,COUNT(c.id) AS published_chapters,MAX(c.guest_free) AS has_free_chapter FROM heroines h JOIN chapters c ON c.heroine_id=h.id AND c.archived=FALSE AND c.published_revision IS NOT NULL WHERE h.archived=FALSE GROUP BY h.id,h.name,h.description,h.media ORDER BY h.name");
  const [versions]=await pool.query<RowDataPacket[]>("SELECT v.document FROM chapter_versions v JOIN chapters c ON c.id=v.chapter_id AND c.published_revision=v.revision WHERE v.status='published' AND c.archived=FALSE");
  let illustratedScenes=0;const publishedPollIds=new Set<number>();
  for(const row of versions){const document=row.document as {chapter?:{finalPollId?:number|null};scenes?:Record<string,{media?:unknown;pollId?:number|null}>};for(const scene of Object.values(document.scenes??{})){if(scene.media)illustratedScenes++;if(Number.isSafeInteger(scene.pollId)&&Number(scene.pollId)>0)publishedPollIds.add(Number(scene.pollId));}if(Number.isSafeInteger(document.chapter?.finalPollId)&&Number(document.chapter?.finalPollId)>0)publishedPollIds.add(Number(document.chapter?.finalPollId));}
  let activePolls=0;if(publishedPollIds.size){const placeholders=[...publishedPollIds].map(()=>'?').join(',');const [polls]=await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM polls WHERE id IN (${placeholders}) AND status='active' AND (open_at IS NULL OR open_at<=UTC_TIMESTAMP(3)) AND (close_at IS NULL OR close_at>UTC_TIMESTAMP(3))`,[...publishedPollIds]);activePolls=Number(polls[0].count);}
  res.json({stories:stories.map(row=>({id:String(row.id),name:String(row.name),description:String(row.description),media:row.media,publishedChapters:Number(row.published_chapters),hasFreeChapter:!!row.has_free_chapter})),stats:{publishedChapters:stories.reduce((sum,row)=>sum+Number(row.published_chapters),0),illustratedScenes,activePolls,firstChapterFree:stories.some(row=>!!row.has_free_chapter)},contactEmail:process.env.CONTACT_EMAIL?.trim()||null});
 });
 app.get('/api/content/chapters/:id',async(req,res)=>{
  // Historical versions are for administrators; readers only receive their active pinned version.
  if((await session(req))?.role!=='admin'){res.status(403).json({error:'Open the active chapter from Stories.'});return;}
  const [rows]=await pool.execute<RowDataPacket[]>("SELECT document FROM chapter_versions WHERE chapter_id=? AND status='published' ORDER BY revision",[req.params.id]);
  if(!rows.length){res.status(404).json({error:'Published chapter not found.'});return;}res.json(rows.map(r=>r.document));
 });
 app.get('/api/media/:id',async(req,res)=>{
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT * FROM media_assets WHERE id=?',[req.params.id]);if(!rows[0]){res.status(404).end();return;}
  const row=rows[0],user=await session(req),guestId=user?null:await guestIdentity(pool,req);let allowed=user?.role==='admin'&&!row.trashed_at;
  if(!allowed&&user?.role==='admin'&&row.trashed_at){const [history]=await pool.execute<RowDataPacket[]>('SELECT 1 FROM version_media WHERE media_id=? LIMIT 1',[req.params.id]);allowed=history.length>0;}
  if(!allowed&&user){const [links]=await pool.execute<RowDataPacket[]>("SELECT 1 FROM version_media m JOIN chapter_versions v ON v.chapter_id=m.chapter_id AND v.revision=m.revision JOIN chapters c ON c.id=v.chapter_id WHERE m.media_id=? AND v.status='published' AND (c.key_cost=0 OR EXISTS(SELECT 1 FROM chapter_unlocks u WHERE u.user_id=? AND u.chapter_id=c.id) OR EXISTS(SELECT 1 FROM progress p WHERE p.user_id=? AND p.chapter_id=c.id)) LIMIT 1",[req.params.id,user.id,user.id]);const [portraits]=await pool.execute<RowDataPacket[]>("SELECT 1 FROM heroines h WHERE h.archived=FALSE AND JSON_UNQUOTE(JSON_EXTRACT(h.media,'$.src'))=? AND EXISTS(SELECT 1 FROM chapters c WHERE c.heroine_id=h.id AND c.archived=FALSE AND c.published_revision IS NOT NULL) LIMIT 1",['/api/media/'+req.params.id]);allowed=!!(links.length||portraits.length);}
  if(!allowed&&!user){const [links]=await pool.execute<RowDataPacket[]>("SELECT 1 FROM version_media m JOIN chapter_versions v ON v.chapter_id=m.chapter_id AND v.revision=m.revision JOIN chapters c ON c.id=v.chapter_id WHERE m.media_id=? AND v.status='published' AND c.guest_free=TRUE LIMIT 1",[req.params.id]);const [portraits]=await pool.execute<RowDataPacket[]>("SELECT 1 FROM heroines h JOIN chapters c ON c.heroine_id=h.id WHERE h.archived=FALSE AND c.archived=FALSE AND c.published_revision IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(h.media,'$.src'))=? LIMIT 1",['/api/media/'+req.params.id]);allowed=!!(links.length||portraits.length);}
  if(!allowed){res.status(404).end();return;}
  if(!/^[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4|webm)$/.test(row.filename)){res.status(404).end();return;}
  const root=row.trashed_at?path.resolve('.local/media-trash'):mediaRoot;
  res.type(row.mime);res.set('X-Content-Type-Options','nosniff');res.sendFile(row.filename,{root,acceptRanges:true,cacheControl:false});
 });
 app.all('/api/progress',(_req,res)=>res.status(410).json({error:'Use the sequential reading API. Saved paths remain intact.'}));
 app.use('/api',(_req,res)=>{res.status(404).json({error:'Not found.'});});
 app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  if((err as {type?:string}).type==='entity.parse.failed'){res.status(400).json({error:'Invalid request.'});return;}
  res.status(503).json({error:'Server unavailable. Your current path is kept on this device. Try again.'});
 });
 return app;
}

