import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Router,type Request} from 'express';
import {rateLimit} from 'express-rate-limit';
import type {Pool,PoolConnection,RowDataPacket} from 'mysql2/promise';

type SessionUser={id:string;role:string}|null;
type SessionLookup=(req:Request)=>Promise<SessionUser>;
const visitorCookie='storymera_visitor';
const clickCookie='storymera_source_click';
const thirtyMinutes=30*60*1000;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const clean=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
const nullable=(value:unknown,max:number)=>clean(value,max)||null;
const matchKey=(source:string,campaign:string|null,publication:string|null)=>[source.toLowerCase(),campaign?.toLowerCase()??'',publication?.toLowerCase()??''].join('|');
const validTarget=(value:unknown):value is string=>typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\x00-\x1f]/.test(value)&&value.length<=500;
const validCode=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
const stableId=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(value)?value:null;
const eventTypes=new Set(['reading_started','scene_reached','chapter_completed']);
const trackingEnabled=()=>process.env.SOURCE_ANALYTICS_ENABLED!=='false';

function publicUrl(req:Request){return (process.env.PUBLIC_SITE_URL?.trim()||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');}
function safeHost(value:unknown){
 try{if(typeof value!=='string'||!value)return null;const url=new URL(value);return url.protocol==='http:'||url.protocol==='https:'?url.hostname.toLowerCase():null;}catch{return null;}
}
function recognizedSource(host:string|null){
 if(!host)return null;
 const rules:[RegExp,string][]=[[/^(?:www\.)?(?:youtube\.com|youtu\.be)$/,'youtube'],[/^(?:www\.)?instagram\.com$/,'instagram'],[/^(?:www\.)?(?:pinterest\.[a-z.]+)$/,'pinterest'],[/^(?:www\.)?(?:facebook\.com|fb\.com)$/,'facebook'],[/^(?:www\.)?(?:tiktok\.com)$/,'tiktok']];
 return rules.find(([pattern])=>pattern.test(host))?.[1]??null;
}
async function visitor(pool:Pool|PoolConnection,req:Request,res?:any){
 let raw=typeof req.cookies[visitorCookie]==='string'&&/^[a-f0-9]{64}$/.test(req.cookies[visitorCookie])?req.cookies[visitorCookie]:'';
 if(!raw){raw=randomBytes(32).toString('hex');res?.cookie(visitorCookie,raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:365*24*60*60*1000});}
 return {raw,key:sha(raw)};
}
async function findSource(pool:Pool|PoolConnection,source:string,campaign:string|null,publication:string|null){
 const [rows]=await pool.execute<RowDataPacket[]>('SELECT id FROM source_tracking_sources WHERE match_key=? AND archived=FALSE',[matchKey(source,campaign,publication)]);
 return rows[0]?String(rows[0].id):null;
}
async function resolveAttribution(pool:PoolConnection,req:Request){
 const token=typeof req.cookies[clickCookie]==='string'?req.cookies[clickCookie]:'';
 if(/^[a-f0-9]{64}$/.test(token)){
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT source_id FROM source_tracking_clicks WHERE token_hash=? AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY) FOR UPDATE',[sha(token)]);
  if(rows[0])return {kind:'short',key:'short:'+rows[0].source_id,sourceId:String(rows[0].source_id),utmSource:null,utmMedium:null,utmCampaign:null,utmContent:null,referrerHost:null,clickHash:sha(token)};
 }
 const utmSource=nullable(req.body?.utmSource,100),utmMedium=nullable(req.body?.utmMedium,100),utmCampaign=nullable(req.body?.utmCampaign,160),utmContent=nullable(req.body?.utmContent,160);
 if(utmSource){const sourceId=await findSource(pool,utmSource,utmCampaign,utmContent);return {kind:sourceId?'utm':'unassigned_utm',key:`utm:${matchKey(utmSource,utmCampaign,utmContent)}`,sourceId,utmSource,utmMedium,utmCampaign,utmContent,referrerHost:null,clickHash:null};}
 const referrerHost=safeHost(req.body?.referrer),recognized=recognizedSource(referrerHost);
 if(recognized){const sourceId=await findSource(pool,recognized,null,null);return {kind:'referrer',key:`referrer:${recognized}`,sourceId,utmSource:null,utmMedium:null,utmCampaign:null,utmContent:null,referrerHost,clickHash:null};}
 return {kind:'direct',key:'direct',sourceId:null,utmSource:null,utmMedium:null,utmCampaign:null,utmContent:null,referrerHost:null,clickHash:null};
}

export function sourceLinkRouter(pool:Pool){
 const router=Router();
 router.get('/go/:code',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!validCode(req.params.code)){res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Link unavailable</title><p>This link is unavailable. <a href="/">Return to stories</a>.</p>');return;}
  try{
   const [rows]=await pool.execute<RowDataPacket[]>('SELECT id,target_path FROM source_tracking_sources WHERE short_code=? AND archived=FALSE',[req.params.code]);
   if(!rows[0]||!validTarget(rows[0].target_path)){res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Link unavailable</title><p>This link is unavailable. <a href="/">Return to stories</a>.</p>');return;}
   if(trackingEnabled()){try{const token=randomBytes(32).toString('hex');await pool.execute('INSERT INTO source_tracking_clicks(token_hash,source_id,created_at) VALUES(?,?,UTC_TIMESTAMP(3))',[sha(token),rows[0].id]);res.cookie(clickCookie,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:24*60*60*1000});}catch{/* A tracking write must never block a valid configured redirect. */}}res.redirect(307,String(rows[0].target_path));
  }catch{res.status(503).type('html').send('<!doctype html><meta charset="utf-8"><title>Temporarily unavailable</title><p>The link is temporarily unavailable. <a href="/">Return to stories</a>.</p>');}
 });
 return router;
}

export function sourceTrackingRouter(pool:Pool,session:SessionLookup){
 const router=Router(),limit=rateLimit({windowMs:60_000,limit:120,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many analytics requests.'}});
 router.use(limit);
 router.post('/confirm',async(req,res)=>{
  if(!trackingEnabled()){res.status(202).json({visitId:null});return;}
  try{
   const c=await pool.getConnection();try{await c.beginTransaction();const identity=await visitor(c,req,res),attribution=await resolveAttribution(c,req),user=await session(req);
    await c.execute('INSERT INTO source_tracking_visitors(visitor_key,first_source_id,user_id,first_seen_at,last_seen_at) VALUES(?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE last_seen_at=UTC_TIMESTAMP(3),first_source_id=COALESCE(first_source_id,VALUES(first_source_id)),user_id=COALESCE(user_id,VALUES(user_id))',[identity.key,attribution.sourceId,user?.id??null]);
    const requested=stableId(req.body?.visitId);let visitId='';
    if(requested){const [rows]=await c.execute<RowDataPacket[]>('SELECT id,attribution_key,last_activity_at FROM source_tracking_visits WHERE id=? AND visitor_key=? FOR UPDATE',[requested,identity.key]);if(rows[0]&&Date.now()-new Date(rows[0].last_activity_at).getTime()<thirtyMinutes&&(attribution.kind==='direct'||String(rows[0].attribution_key)===attribution.key))visitId=String(rows[0].id);}
    if(!visitId){const [rows]=await c.execute<RowDataPacket[]>('SELECT id,attribution_key,last_activity_at FROM source_tracking_visits WHERE visitor_key=? ORDER BY last_activity_at DESC LIMIT 1 FOR UPDATE',[identity.key]);if(rows[0]&&Date.now()-new Date(rows[0].last_activity_at).getTime()<thirtyMinutes&&(attribution.kind==='direct'||String(rows[0].attribution_key)===attribution.key))visitId=String(rows[0].id);}
    if(visitId)await c.execute('UPDATE source_tracking_visits SET last_activity_at=UTC_TIMESTAMP(3),user_id=COALESCE(user_id,?) WHERE id=?',[user?.id??null,visitId]);
    else{visitId=randomUUID();await c.execute('INSERT INTO source_tracking_visits(id,visitor_key,source_id,attribution_kind,attribution_key,utm_source,utm_medium,utm_campaign,utm_content,referrer_host,user_id,started_at,last_activity_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[visitId,identity.key,attribution.sourceId,attribution.kind,attribution.key,attribution.utmSource,attribution.utmMedium,attribution.utmCampaign,attribution.utmContent,attribution.referrerHost,user?.id??null]);}
    if(attribution.clickHash)await c.execute('UPDATE source_tracking_clicks SET confirmed_at=COALESCE(confirmed_at,UTC_TIMESTAMP(3)) WHERE token_hash=?',[attribution.clickHash]);
    await c.commit();res.clearCookie(clickCookie,{path:'/'});res.json({visitId});
   }catch(error){await c.rollback();throw error;}finally{c.release();}
  }catch{res.status(202).json({visitId:null});}
 });
 router.post('/event',async(req,res)=>{
  if(!trackingEnabled()){res.status(202).json({accepted:false});return;}
  try{
   if(!eventTypes.has(req.body?.type)){res.status(400).json({error:'Unknown analytics event.'});return;}
   const user=await session(req);if(user?.role==='admin'){res.status(202).json({accepted:true});return;}
   const visitId=stableId(req.body?.visitId),eventKey=stableId(req.body?.eventKey);if(!visitId||!eventKey){res.status(400).json({error:'Invalid analytics event.'});return;}
   const identity=await visitor(pool,req,res),heroineId=stableId(req.body?.heroineId),chapterId=stableId(req.body?.chapterId),sceneId=stableId(req.body?.sceneId);
   const [visits]=await pool.execute<RowDataPacket[]>('SELECT id FROM source_tracking_visits WHERE id=? AND visitor_key=?',[visitId,identity.key]);if(!visits[0]){res.status(202).json({accepted:false});return;}
   const dedupe=[identity.key,visitId,req.body.type,heroineId??'',chapterId??'',sceneId??''].join(':');
   await pool.execute('INSERT IGNORE INTO source_tracking_events(event_key,dedupe_key,visitor_key,visit_id,user_id,event_type,heroine_id,chapter_id,scene_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',[eventKey,dedupe,identity.key,visitId,user?.id??null,req.body.type,heroineId,chapterId,sceneId]);
   await pool.execute('UPDATE source_tracking_visits SET last_activity_at=UTC_TIMESTAMP(3),user_id=COALESCE(user_id,?) WHERE id=?',[user?.id??null,visitId]);res.status(202).json({accepted:true});
  }catch{res.status(202).json({accepted:false});}
 });
 return router;
}

export async function linkSourceRegistration(pool:Pool,req:Request,userId:string){
 if(!trackingEnabled())return;
 try{const identity=await visitor(pool,req);const [rows]=await pool.execute<RowDataPacket[]>('SELECT id FROM source_tracking_visits WHERE visitor_key=? ORDER BY last_activity_at DESC LIMIT 1',[identity.key]);if(!rows[0])return;
  const visitId=String(rows[0].id),dedupe=[identity.key,visitId,'registration_completed',userId].join(':');
  await pool.execute('UPDATE source_tracking_visitors SET user_id=? WHERE visitor_key=?',[userId,identity.key]);await pool.execute('UPDATE source_tracking_visits SET user_id=? WHERE id=?',[userId,visitId]);
  await pool.execute('INSERT IGNORE INTO source_tracking_events(event_key,dedupe_key,visitor_key,visit_id,user_id,event_type,created_at) VALUES(?,?,?,?,?,\'registration_completed\',UTC_TIMESTAMP(3))',[randomUUID(),dedupe,identity.key,visitId,userId]);
 }catch{/* Analytics never blocks registration. */}
}

const metrics=['reading_started','chapter_completed','registration_completed','goal'];
function sourceInput(body:any){
 const displayName=clean(body?.displayName,160),sourceName=clean(body?.source,100).toLowerCase(),campaign=nullable(body?.campaign,160),publication=nullable(body?.publication,160),shortCode=clean(body?.shortCode,64).toLowerCase(),targetPath=clean(body?.targetPath,500);
 if(!displayName||!sourceName||!validCode(shortCode)||!validTarget(targetPath))throw Error('Fill in a name, source, valid short code and internal target path.');
 const visibleMetrics=Array.isArray(body?.visibleMetrics)?body.visibleMetrics.filter((x:unknown)=>typeof x==='string'&&metrics.includes(x)):[];
 const goalType=['none','scene','chapter_complete'].includes(body?.goalType)?body.goalType:'none';
 const goalHeroineId=stableId(body?.goalHeroineId),goalChapterId=stableId(body?.goalChapterId),goalSceneId=stableId(body?.goalSceneId);
 if(goalType==='scene'&&(!goalHeroineId||!goalChapterId||!goalSceneId))throw Error('Choose a story, chapter and scene for the goal.');
 if(goalType==='chapter_complete'&&(!goalHeroineId||!goalChapterId))throw Error('Choose a story and chapter for the goal.');
 return {displayName,sourceName,campaign,publication,shortCode,targetPath,visibleMetrics,goalType,goalHeroineId,goalChapterId,goalSceneId};
}
function rowSource(row:any,base:string){return {id:row.id,displayName:row.display_name,source:row.source_name,campaign:row.campaign,publication:row.publication,shortCode:row.short_code,targetPath:row.target_path,shortUrl:`${base}/go/${row.short_code}`,visibleMetrics:typeof row.visible_metrics==='string'?JSON.parse(row.visible_metrics):row.visible_metrics,goalType:row.goal_type,goalHeroineId:row.goal_heroine_id,goalChapterId:row.goal_chapter_id,goalSceneId:row.goal_scene_id,archived:!!row.archived};}
function kyivDate(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function utcBoundary(localDate:string){let guess=Date.parse(localDate+'T00:00:00Z');for(let i=0;i<2;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));const represented=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);guess-=represented-Date.parse(localDate+'T00:00:00Z');}return new Date(guess);}
function addDays(value:string,days:number){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function period(body:any){const today=kyivDate(),kind=String(body?.period??'7');let from=kind==='today'?today:kind==='30'?addDays(today,-29):kind==='custom'?String(body?.from??''):addDays(today,-6),to=kind==='custom'?String(body?.to??''):today;if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Choose a valid date range.');return {from,to,start:utcBoundary(from),end:utcBoundary(addDays(to,1))};}

export function adminSourceAnalyticsRouter(pool:Pool){
 const router=Router();
 router.get('/sources',async(req,res)=>{const filter=String(req.query.status??'active'),where=filter==='archived'?'WHERE archived=TRUE':filter==='all'?'':'WHERE archived=FALSE';const [rows]=await pool.query<RowDataPacket[]>(`SELECT * FROM source_tracking_sources ${where} ORDER BY archived,display_name`);res.json(rows.map(r=>rowSource(r,publicUrl(req))));});
 router.post('/sources',async(req,res)=>{try{const v=sourceInput(req.body),id=randomUUID();await pool.execute('INSERT INTO source_tracking_sources(id,display_name,source_name,campaign,publication,match_key,short_code,target_path,visible_metrics,goal_type,goal_heroine_id,goal_chapter_id,goal_scene_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,v.displayName,v.sourceName,v.campaign,v.publication,matchKey(v.sourceName,v.campaign,v.publication),v.shortCode,v.targetPath,JSON.stringify(v.visibleMetrics),v.goalType,v.goalHeroineId,v.goalChapterId,v.goalSceneId]);res.status(201).json({id});}catch(e){res.status((e as any).code==='ER_DUP_ENTRY'?409:400).json({error:e instanceof Error?e.message:'Invalid source.'});}});
 router.patch('/sources/:id',async(req,res)=>{try{const v=sourceInput({...req.body,shortCode:req.body?.shortCode});const [existing]=await pool.execute<RowDataPacket[]>('SELECT short_code FROM source_tracking_sources WHERE id=?',[req.params.id]);if(!existing[0]){res.status(404).json({error:'Source not found.'});return;}if(v.shortCode!==existing[0].short_code){res.status(409).json({error:'The short code is permanent. Create a new source for a different code.'});return;}await pool.execute('UPDATE source_tracking_sources SET display_name=?,source_name=?,campaign=?,publication=?,match_key=?,target_path=?,visible_metrics=?,goal_type=?,goal_heroine_id=?,goal_chapter_id=?,goal_scene_id=? WHERE id=?',[v.displayName,v.sourceName,v.campaign,v.publication,matchKey(v.sourceName,v.campaign,v.publication),v.targetPath,JSON.stringify(v.visibleMetrics),v.goalType,v.goalHeroineId,v.goalChapterId,v.goalSceneId,req.params.id]);res.json({ok:true});}catch(e){res.status((e as any).code==='ER_DUP_ENTRY'?409:400).json({error:e instanceof Error?e.message:'Invalid source.'});}});
 router.post('/sources/:id/archive',async(req,res)=>{await pool.execute('UPDATE source_tracking_sources SET archived=? WHERE id=?',[req.body?.archived!==false,req.params.id]);res.json({ok:true});});
 router.get('/options',async(_req,res)=>{const [heroines]=await pool.query<RowDataPacket[]>('SELECT id,name FROM heroines ORDER BY name'),[chapters]=await pool.query<RowDataPacket[]>('SELECT id,heroine_id,title,published_revision FROM chapters WHERE archived=FALSE ORDER BY display_order,id'),[versions]=await pool.query<RowDataPacket[]>("SELECT chapter_id,document FROM chapter_versions WHERE status='published' OR status='draft' ORDER BY chapter_id,status='draft' DESC,revision DESC");const documents=new Map<string,any>();for(const row of versions)if(!documents.has(String(row.chapter_id)))documents.set(String(row.chapter_id),typeof row.document==='string'?JSON.parse(row.document):row.document);res.json({heroines,chapters,scenes:[...documents.entries()].flatMap(([chapterId,doc])=>Object.values(doc?.scenes??{}).sort((a:any,b:any)=>a.step-b.step).map((s:any)=>({id:s.id,title:s.title,chapterId}))) });});
 router.get('/report',async(req,res)=>{try{const range=period(req.query),status=String(req.query.status??'active'),where=status==='archived'?'WHERE archived=TRUE':status==='all'?'':'WHERE archived=FALSE';const [sources]=await pool.query<RowDataPacket[]>(`SELECT * FROM source_tracking_sources ${where} ORDER BY archived,display_name`);
  const [visits]=await pool.execute<RowDataPacket[]>(`SELECT v.source_id,v.attribution_kind,COUNT(*) visits,COUNT(DISTINCT v.visitor_key) visitors FROM source_tracking_visits v LEFT JOIN users u ON u.id=v.user_id WHERE v.started_at>=? AND v.started_at<? AND (u.id IS NULL OR u.role<>'admin') GROUP BY v.source_id,v.attribution_kind`,[range.start,range.end]);
  const [events]=await pool.execute<RowDataPacket[]>(`SELECT v.source_id,v.attribution_kind,e.event_type,e.heroine_id,e.chapter_id,e.scene_id,COUNT(*) count_value FROM source_tracking_events e JOIN source_tracking_visits v ON v.id=e.visit_id LEFT JOIN users u ON u.id=COALESCE(e.user_id,v.user_id) WHERE e.created_at>=? AND e.created_at<? AND (u.id IS NULL OR u.role<>'admin') GROUP BY v.source_id,v.attribution_kind,e.event_type,e.heroine_id,e.chapter_id,e.scene_id`,[range.start,range.end]);
  const sourceRows=sources.map(source=>{const id=String(source.id),matchingVisits=visits.filter(v=>String(v.source_id??'')===id),enabled=typeof source.visible_metrics==='string'?JSON.parse(source.visible_metrics):source.visible_metrics;const sums=(type:string,predicate=(e:any)=>true)=>events.filter(e=>String(e.source_id??'')===id&&e.event_type===type&&predicate(e)).reduce((n,e)=>n+Number(e.count_value),0);const goal=source.goal_type==='scene'?sums('scene_reached',e=>e.heroine_id===source.goal_heroine_id&&e.chapter_id===source.goal_chapter_id&&e.scene_id===source.goal_scene_id):source.goal_type==='chapter_complete'?sums('chapter_completed',e=>e.heroine_id===source.goal_heroine_id&&e.chapter_id===source.goal_chapter_id):null;return {...rowSource(source,publicUrl(req)),visits:matchingVisits.reduce((n,v)=>n+Number(v.visits),0),visitors:matchingVisits.reduce((n,v)=>n+Number(v.visitors),0),started:enabled.includes('reading_started')?sums('reading_started'):null,completed:enabled.includes('chapter_completed')?sums('chapter_completed'):null,registrations:enabled.includes('registration_completed')?sums('registration_completed'):null,goal:enabled.includes('goal')?goal:null};});
  const labels:Record<string,string>={direct:'Direct traffic',unassigned_utm:'Unassigned UTM',referrer:'Unconfigured referrer'};for(const v of visits.filter(row=>row.source_id===null)){const kind=String(v.attribution_kind),sum=(type:string)=>events.filter(e=>e.source_id===null&&e.attribution_kind===kind&&e.event_type===type).reduce((n,e)=>n+Number(e.count_value),0);sourceRows.push({id:'unassigned:'+kind,displayName:labels[kind]??'Unassigned traffic',source:kind,campaign:null,publication:null,shortCode:'',targetPath:'',shortUrl:'',visibleMetrics:metrics,goalType:'none',goalHeroineId:null,goalChapterId:null,goalSceneId:null,archived:false,synthetic:true,visits:Number(v.visits),visitors:Number(v.visitors),started:sum('reading_started'),completed:sum('chapter_completed'),registrations:sum('registration_completed'),goal:null} as any);}
  const [total]=await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) visits,COUNT(DISTINCT v.visitor_key) visitors FROM source_tracking_visits v LEFT JOIN users u ON u.id=v.user_id WHERE v.started_at>=? AND v.started_at<? AND (u.id IS NULL OR u.role<>'admin')`,[range.start,range.end]);const totalEvent=(type:string,predicate=(e:any)=>true)=>events.filter(e=>e.event_type===type&&predicate(e)).reduce((n,e)=>n+Number(e.count_value),0);const goalSignatures=[...new Set(sources.map(s=>[s.goal_type,s.goal_heroine_id??'',s.goal_chapter_id??'',s.goal_scene_id??''].join('|')))];let totalGoal:number|null=null;if(goalSignatures.length===1&&sources.length&&sources[0].goal_type!=='none')totalGoal=sources[0].goal_type==='scene'?totalEvent('scene_reached',e=>e.heroine_id===sources[0].goal_heroine_id&&e.chapter_id===sources[0].goal_chapter_id&&e.scene_id===sources[0].goal_scene_id):totalEvent('chapter_completed',e=>e.heroine_id===sources[0].goal_heroine_id&&e.chapter_id===sources[0].goal_chapter_id);res.json({timezone:'Europe/Kyiv',from:range.from,to:range.to,rows:sourceRows,total:{visits:Number(total[0].visits),visitors:Number(total[0].visitors),started:totalEvent('reading_started'),completed:totalEvent('chapter_completed'),registrations:totalEvent('registration_completed'),goal:totalGoal}});
 }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Unable to build report.'});}});
 return router;
}
