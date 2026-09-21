import {Router,type Request,type Response} from 'express';
import type {Pool,PoolConnection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {guestIdentity} from './reading.ts';
import {storyFromDb} from './content.ts';
import {linearScenes} from '../src/linear.ts';
import type {Story} from '../src/story-model.ts';
import {recordEvent} from './analytics.ts';

type Db=Pool|PoolConnection;
type Session=(req:Request)=>Promise<{id:string;role:string}|null>;
const idNumber=(value:unknown)=>{const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;};
const dateValue=(value:unknown)=>value==null||value===''?null:typeof value==='string'&&!Number.isNaN(Date.parse(value))?new Date(value):undefined;
const validText=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const optionsOf=async(db:Db,id:number)=>{const [rows]=await db.execute<RowDataPacket[]>('SELECT id,poll_id AS pollId,text,description,sort_order AS sortOrder,created_at AS createdAt,updated_at AS updatedAt FROM poll_options WHERE poll_id=? ORDER BY sort_order,id',[id]);return rows;};
const pollOf=async(db:Db,id:number,lock=false)=>{const [rows]=await db.execute<RowDataPacket[]>(`SELECT * FROM polls WHERE id=?${lock?' FOR UPDATE':''}`,[id]);return rows[0]??null;};
const usable=(poll:RowDataPacket)=>poll.status==='active'&&(!poll.open_at||new Date(poll.open_at).getTime()<=Date.now())&&(!poll.close_at||new Date(poll.close_at).getTime()>Date.now());
const publicPoll=(poll:RowDataPacket,options:RowDataPacket[],selected:number|null,encounterStatus:'available'|'voted'|'skipped'|'not_reached'='not_reached',showRegistrationPrompt=false)=>({id:Number(poll.id),question:poll.question,description:poll.description,type:poll.type,status:poll.status,allowSkip:!!poll.allow_skip,showResults:!!poll.show_results,allowVoteChange:!!poll.allow_vote_change,canVote:usable(poll),selectedOptionId:selected,canonicalOptionId:poll.canonical_option_id==null?null:Number(poll.canonical_option_id),encounterStatus,showRegistrationPrompt,options:options.map(o=>({id:Number(o.id),text:o.text,description:o.description,sortOrder:o.sortOrder}))});

async function placements(db:Db,pollId:number){
 const [rows]=await db.query<RowDataPacket[]>("SELECT v.document,c.id AS chapterId,c.title AS chapterTitle,v.status AS versionStatus FROM chapter_versions v JOIN chapters c ON c.id=v.chapter_id WHERE (v.status='draft' OR v.revision=c.published_revision) AND c.archived=FALSE");
 return rows.flatMap(row=>{const story=row.document as Story;const found:{chapterId:string;chapterTitle:string;sceneId:string|null;sceneTitle:string|null;versionStatus:string}[]=[];
  if(story.chapter.finalPollId===pollId)found.push({chapterId:row.chapterId,chapterTitle:row.chapterTitle,sceneId:null,sceneTitle:null,versionStatus:row.versionStatus});
  for(const scene of Object.values(story.scenes))if(scene.pollId===pollId)found.push({chapterId:row.chapterId,chapterTitle:row.chapterTitle,sceneId:scene.id,sceneTitle:scene.title,versionStatus:row.versionStatus});
  return found;
 });
}
export async function pollErrors(db:Db,story:Story):Promise<string[]>{
 const errors:string[]=[];
 for(const scene of Object.values(story.scenes)){
  if(scene.type==='poll'&&(!Number.isSafeInteger(scene.pollId)||!scene.pollId||scene.pollId<1))errors.push(`${scene.title||scene.id}: choose a poll for this poll scene.`);
  if((scene.type??'story')==='story'&&scene.pollId!=null)errors.push(`${scene.title||scene.id}: move the poll into a separate poll scene.`);
 }
 const ids=[...new Set([story.chapter.finalPollId,...Object.values(story.scenes).map(s=>s.pollId)].filter((v):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0))];
 if(!ids.length)return errors;
 for(const id of ids){const poll=await pollOf(db,id);if(!poll){errors.push(`Poll #${id} does not exist.`);continue;}if(story.chapter.finalPollId===id&&poll.type!=='canonical')errors.push(`Final poll #${id} must be Canonical.`);}
 return errors;
}
async function eligible(db:Db,req:Request,pollId:number,session:Session){
 const user=await session(req),guestId=user?null:await guestIdentity(db,req);
  if(!user&&!guestId)return {allowed:false,user:null,guestId:null,context:{}};
 const column=user?'user_id':'guest_id',owner=user?.id??guestId;
 const [rows]=await db.execute<RowDataPacket[]>(`SELECT chapter_id,story_revision,scene_id,completed_at FROM progress WHERE ${column}=?`,[owner]);
 for(const row of rows){const story=await storyFromDb(db,row.chapter_id,row.story_revision,true);if(!story)continue;
   if(story.chapter.finalPollId===pollId&&row.completed_at!==null)return {allowed:true,user,guestId,context:{heroineId:story.chapter.heroineId,chapterId:String(row.chapter_id),sceneId:String(row.scene_id)}};
  const sequence=linearScenes(story),at=sequence.findIndex(s=>s.id===row.scene_id),pollAt=sequence.findIndex(s=>s.type==='poll'&&s.pollId===pollId);
   if(pollAt>=0&&(row.completed_at!==null||at>=pollAt))return {allowed:true,user,guestId,context:{heroineId:story.chapter.heroineId,chapterId:String(row.chapter_id),sceneId:sequence[pollAt].id}};
 }
  return {allowed:false,user,guestId,context:{}};
}
async function encounter(db:Db,pollId:number,userId:string|null,guestId:string|null){
 const column=userId?'user_id':'guest_id',id=userId??guestId;if(!id)return 'not_reached' as const;
 const [rows]=await db.execute<RowDataPacket[]>(`SELECT status FROM poll_progress WHERE poll_id=? AND ${column}=?`,[pollId,id]);
 return (rows[0]?.status??'not_reached') as 'available'|'voted'|'skipped'|'not_reached';
}
async function results(db:Db,poll:RowDataPacket){
 const options=await optionsOf(db,Number(poll.id));
 let rows:RowDataPacket[];
 if(poll.status==='active'||poll.status==='draft'){
  [rows]=await db.execute<RowDataPacket[]>('SELECT option_id AS optionId,COUNT(*) AS votes FROM poll_votes WHERE poll_id=? GROUP BY option_id',[poll.id]);
 }else{
  [rows]=await db.execute<RowDataPacket[]>('SELECT option_id AS optionId,vote_count AS votes,percent FROM poll_result_snapshots WHERE poll_id=?',[poll.id]);
 }
 const counts=new Map(rows.map(r=>[Number(r.optionId),Number(r.votes)]));
 const total=poll.official_total==null?[...counts.values()].reduce((a,b)=>a+b,0):Number(poll.official_total);
 return {total,options:options.map(o=>({id:Number(o.id),text:o.text,votes:counts.get(Number(o.id))??0,percent:rows.find(r=>Number(r.optionId)===Number(o.id))?.percent!=null?Number(rows.find(r=>Number(r.optionId)===Number(o.id))!.percent):total?Math.round((counts.get(Number(o.id))??0)*10000/total)/100:0})),canonicalOptionId:poll.canonical_option_id==null?null:Number(poll.canonical_option_id)};
}
async function closeLocked(db:PoolConnection,poll:RowDataPacket){
 if(poll.status!=='active')return {closed:false,tie:false};
 const tally=await results(db,poll),leaders=tally.options.filter(o=>o.votes===Math.max(...tally.options.map(x=>x.votes)));
 const winner=tally.total>0&&leaders.length===1?leaders[0].id:null;
 for(const option of tally.options)await db.execute('INSERT INTO poll_result_snapshots(poll_id,option_id,vote_count,percent) VALUES(?,?,?,?)',[poll.id,option.id,option.votes,option.percent]);
 await db.execute("UPDATE polls SET status='closed',official_total=?,canonical_option_id=?,closed_at=UTC_TIMESTAMP(3) WHERE id=?",[tally.total,winner,poll.id]);
 return {closed:true,tie:tally.total>0&&leaders.length>1,canonicalOptionId:winner};
}
async function closeIfDue(pool:Pool,id:number){
 const c=await pool.getConnection();try{await c.beginTransaction();const poll=await pollOf(c,id,true);if(poll?.status==='active'&&((poll.close_at&&new Date(poll.close_at).getTime()<=Date.now())||poll.type==='canonical'&&await nextChapterPublished(c,id)))await closeLocked(c,poll);await c.commit();}
 catch(e){await c.rollback();throw e;}finally{c.release();}
}
async function nextChapterPublished(db:Db,pollId:number){
 const linked=(await placements(db,pollId)).filter(p=>p.sceneId===null&&p.versionStatus==='published');
 for(const place of linked){const [rows]=await db.execute<RowDataPacket[]>("SELECT 1 FROM chapters current_chapter JOIN chapters next_chapter ON next_chapter.heroine_id=current_chapter.heroine_id AND next_chapter.display_order>current_chapter.display_order AND next_chapter.archived=FALSE AND next_chapter.published_revision IS NOT NULL WHERE current_chapter.id=? LIMIT 1",[place.chapterId]);if(rows.length)return true;}
 return false;
}

export function readerPollRouter(pool:Pool,session:Session){
 const router=Router();
  router.get('/:id',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}await closeIfDue(pool,id);const poll=await pollOf(pool,id);if(!poll||poll.status==='draft'){res.status(404).json({error:'Poll unavailable.'});return;}
   const access=await eligible(pool,req,id,session);if(!access.allowed){res.status(403).json({error:'Reach this poll in the chapter first.'});return;}
   const options=await optionsOf(pool,id);let selected:null|number=null;if(access.user){const [votes]=await pool.execute<RowDataPacket[]>('SELECT option_id FROM poll_votes WHERE poll_id=? AND user_id=?',[id,access.user.id]);selected=votes[0]?Number(votes[0].option_id):null;}
   const status=await encounter(pool,id,access.user?.id??null,access.guestId);let prompt=false;
   if(!access.user&&access.guestId){const [seen]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS count FROM poll_progress WHERE guest_id=?',[access.guestId]);prompt=Number(seen[0].count)===0;}
   res.json(publicPoll(poll,options,selected,status,prompt));
  });
  router.post('/:id/view',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}const poll=await pollOf(pool,id);if(!poll||poll.status==='draft'){res.status(404).json({error:'Poll unavailable.'});return;}const access=await eligible(pool,req,id,session);if(!access.allowed){res.status(403).json({error:'Reach this poll in the chapter first.'});return;}const userId=access.user?.id??null,guestId=access.guestId;await pool.execute('INSERT INTO poll_views(poll_id,user_id,guest_id) VALUES(?,?,?)',[id,userId,guestId]);if(userId)await pool.execute("INSERT INTO poll_progress(poll_id,user_id,status) VALUES(?,?,'available') ON DUPLICATE KEY UPDATE status=status",[id,userId]);else if(guestId){await pool.execute("INSERT INTO poll_progress(poll_id,guest_id,status) VALUES(?,?,'available') ON DUPLICATE KEY UPDATE status=status",[id,guestId]);await recordEvent(pool,'guest_poll_seen',{guestId},{...access.context,pollId:id});}res.json({ok:true,status:await encounter(pool,id,userId,guestId)});});
  router.post('/:id/skip',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}const poll=await pollOf(pool,id);if(!poll||poll.status==='draft'){res.status(404).json({error:'Poll unavailable.'});return;}const access=await eligible(pool,req,id,session);if(!access.allowed){res.status(403).json({error:'Reach this poll in the chapter first.'});return;}const userId=access.user?.id??null,guestId=access.guestId;if(userId&&!poll.allow_skip){res.status(409).json({error:'This poll cannot be skipped.'});return;}if(userId){const [votes]=await pool.execute<RowDataPacket[]>('SELECT 1 FROM poll_votes WHERE poll_id=? AND user_id=?',[id,userId]);if(votes.length){res.status(409).json({error:'A vote has already been saved.'});return;}await pool.execute("INSERT INTO poll_progress(poll_id,user_id,status) VALUES(?,?,'skipped') ON DUPLICATE KEY UPDATE status=IF(status='voted',status,'skipped')",[id,userId]);}else if(guestId){await pool.execute("INSERT INTO poll_progress(poll_id,guest_id,status) VALUES(?,?,'skipped') ON DUPLICATE KEY UPDATE status=IF(status='voted',status,'skipped')",[id,guestId]);await recordEvent(pool,'guest_poll_skipped',{guestId},{...access.context,pollId:id});}res.json({ok:true,status:'skipped'});});
 router.get('/:id/results',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}await closeIfDue(pool,id);const poll=await pollOf(pool,id);if(!poll||poll.status==='draft'){res.status(404).json({error:'Poll unavailable.'});return;}const access=await eligible(pool,req,id,session);if(!access.allowed){res.status(403).json({error:'Reach this poll in the chapter first.'});return;}const tally=await results(pool,poll);if(!poll.show_results||!access.user){res.json({canonicalOptionId:tally.canonicalOptionId,resultsHidden:true});return;}const [votes]=await pool.execute<RowDataPacket[]>('SELECT id FROM poll_votes WHERE poll_id=? AND user_id=? LIMIT 1',[id,access.user.id]);res.json(votes.length?tally:{canonicalOptionId:tally.canonicalOptionId,resultsHidden:true});});
 router.post('/:id/vote',async(req,res)=>{const id=idNumber(req.params.id),optionId=idNumber(req.body?.optionId);if(!id||!optionId){res.status(400).json({error:'Choose an option.'});return;}const user=await session(req);if(!user){res.status(401).json({error:'Sign in to vote.'});return;}const c=await pool.getConnection();try{await c.beginTransaction();const poll=await pollOf(c,id,true);if(!poll){res.status(404).json({error:'Poll unavailable.'});return;}if(poll.status==='active'&&((poll.close_at&&new Date(poll.close_at).getTime()<=Date.now())||poll.type==='canonical'&&await nextChapterPublished(c,id))){await closeLocked(c,poll);await c.commit();res.status(409).json({error:'Voting has closed.'});return;}if(!usable(poll)){res.status(409).json({error:'Voting is not active.'});return;}
   const access=await eligible(c,req,id,session);if(!access.allowed){res.status(403).json({error:'Reach this poll in the chapter first.'});return;}
   const [option]=await c.execute<RowDataPacket[]>('SELECT id FROM poll_options WHERE id=? AND poll_id=?',[optionId,id]);if(!option.length){res.status(400).json({error:'Option does not belong to this poll.'});return;}
   const [prior]=await c.execute<RowDataPacket[]>('SELECT id,option_id FROM poll_votes WHERE poll_id=? AND user_id=? FOR UPDATE',[id,user.id]);
   if(prior.length){if(!poll.allow_vote_change){res.status(409).json({error:'This vote cannot be changed.'});return;}if(Number(prior[0].option_id)!==optionId)await c.execute('UPDATE poll_votes SET option_id=?,change_count=change_count+1 WHERE id=?',[optionId,prior[0].id]);}
    else await c.execute('INSERT INTO poll_votes(poll_id,option_id,user_id) VALUES(?,?,?)',[id,optionId,user.id]);
    await c.execute("INSERT INTO poll_progress(poll_id,user_id,status) VALUES(?,?,'voted') ON DUPLICATE KEY UPDATE status='voted'",[id,user.id]);
   await c.commit();res.json({selectedOptionId:optionId});
  }catch(e){await c.rollback();throw e;}finally{await c.rollback();c.release();}
 });
 return router;
}

export function adminPollRouter(pool:Pool){
 const router=Router();
 router.get('/',async(_req,res)=>{const [rows]=await pool.query<RowDataPacket[]>("SELECT p.*, (SELECT COUNT(*) FROM poll_votes v WHERE v.poll_id=p.id) AS vote_count FROM polls p ORDER BY p.id DESC");res.json(await Promise.all(rows.map(async p=>{const tally=await results(pool,p),max=Math.max(0,...tally.options.map(o=>o.votes)),leaders=tally.options.filter(o=>o.votes===max&&max>0);return {...adminPoll(p),voteCount:Number(p.vote_count),winnerLabel:p.canonical_option_id?tally.options.find(o=>o.id===Number(p.canonical_option_id))?.text??null:leaders.length===1?leaders[0].text:null,placements:await placements(pool,Number(p.id))};})));});
 router.get('/:id',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}const poll=await pollOf(pool,id);if(!poll){res.status(404).json({error:'Poll not found.'});return;}const [votes]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS count FROM poll_votes WHERE poll_id=?',[id]);res.json({...adminPoll(poll),options:await optionsOf(pool,id),voteCount:Number(votes[0].count),placements:await placements(pool,id)});});
 router.get('/:id/stats',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}const poll=await pollOf(pool,id);if(!poll){res.status(404).json({error:'Poll not found.'});return;}
  const [meta]=await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS views,COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN CONCAT('u:',user_id) WHEN guest_id IS NOT NULL THEN CONCAT('g:',guest_id) END) AS unique_viewers FROM poll_views WHERE poll_id=?",[id]);
  const [votes]=await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS voters,COALESCE(SUM(change_count),0) AS changes,MIN(created_at) AS first_vote,MAX(updated_at) AS last_vote FROM poll_votes WHERE poll_id=?",[id]);
  const viewerCount=Number(meta[0].unique_viewers),voterCount=Number(votes[0].voters);
  res.json({...adminPoll(poll),...await results(pool,poll),placements:await placements(pool,id),views:Number(meta[0].views),uniqueViewers:viewerCount,voters:voterCount,conversion:viewerCount?Math.round(voterCount*10000/viewerCount)/100:0,changedVotes:Number(votes[0].changes),firstVote:votes[0].first_vote,lastVote:votes[0].last_vote});
 });
 router.post('/',async(req,res)=>{const data=validated(req.body);if(!data){res.status(400).json({error:'Invalid poll details.'});return;}const c=await pool.getConnection();try{await c.beginTransaction();const [r]=await c.execute<ResultSetHeader>('INSERT INTO polls(admin_title,question,description,type,allow_skip,show_results,allow_vote_change,open_at,close_at) VALUES(?,?,?,?,?,?,?,?,?)',[data.adminTitle,data.question,data.description,data.type,data.allowSkip,data.showResults,data.allowVoteChange,data.openAt,data.closeAt]);for(let i=0;i<data.options.length;i++)await c.execute('INSERT INTO poll_options(poll_id,text,description,sort_order) VALUES(?,?,?,?)',[r.insertId,data.options[i].text,data.options[i].description,i+1]);await c.commit();res.status(201).json({id:r.insertId});}catch(e){await c.rollback();throw e;}finally{c.release();}});
 router.patch('/:id',async(req,res)=>{const id=idNumber(req.params.id),data=validated(req.body);if(!id||!data){res.status(400).json({error:'Invalid poll details.'});return;}const c=await pool.getConnection();try{await c.beginTransaction();const poll=await pollOf(c,id,true);if(!poll){res.status(404).json({error:'Poll not found.'});return;}if(!['draft','active'].includes(poll.status)){res.status(409).json({error:'Closed polls cannot be edited.'});return;}if(req.body.status&&req.body.status!==poll.status&&!(poll.status==='draft'&&req.body.status==='active')){res.status(409).json({error:'Use the close or archive action to change status.'});return;}if(req.body.status==='active'&&!data.question.trim()){res.status(400).json({error:'Question is required.'});return;}
   const [count]=await c.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id=?',[id]);const existing=await optionsOf(c,id);const incomingIds=new Set(data.options.map(o=>o.id).filter(Boolean));
   if(Number(count[0].n)>0&&(data.type!==poll.type||existing.some(o=>!incomingIds.has(Number(o.id)))||existing.some(o=>{const next=data.options.find(n=>n.id===Number(o.id));return next&&(next.text.trim()!==String(o.text).trim()||next.description.trim()!==String(o.description).trim());}))){res.status(409).json({error:'Options with votes cannot be deleted or reworded. Create a new poll for a major change.'});return;}
   if(data.options.some(o=>o.id&&!existing.some(e=>Number(e.id)===o.id))){res.status(400).json({error:'Option does not belong to this poll.'});return;}
   for(const option of existing)if(!incomingIds.has(Number(option.id)))await c.execute('DELETE FROM poll_options WHERE id=?',[option.id]);
   for(let i=0;i<data.options.length;i++){const option=data.options[i];if(option.id)await c.execute('UPDATE poll_options SET text=?,description=?,sort_order=? WHERE id=?',[option.text,option.description,i+1,option.id]);else await c.execute('INSERT INTO poll_options(poll_id,text,description,sort_order) VALUES(?,?,?,?)',[id,option.text,option.description,i+1]);}
   await c.execute('UPDATE polls SET admin_title=?,question=?,description=?,type=?,status=?,allow_skip=?,show_results=?,allow_vote_change=?,open_at=?,close_at=? WHERE id=?',[data.adminTitle,data.question,data.description,data.type,req.body.status==='active'?'active':poll.status,data.allowSkip,data.showResults,data.allowVoteChange,data.openAt,data.closeAt,id]);await c.commit();res.json({ok:true});
  }catch(e){await c.rollback();throw e;}finally{await c.rollback();c.release();}
 });
 router.post('/:id/close',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}const c=await pool.getConnection();try{await c.beginTransaction();const poll=await pollOf(c,id,true);if(!poll||poll.status!=='active'){res.status(409).json({error:'Only an active poll can be closed.'});return;}const result=await closeLocked(c,poll);await c.commit();res.json(result);}catch(e){await c.rollback();throw e;}finally{await c.rollback();c.release();}});
 router.post('/:id/canonical-option',async(req,res)=>{const id=idNumber(req.params.id),optionId=idNumber(req.body?.optionId);if(!id||!optionId){res.status(400).json({error:'Choose a canonical option.'});return;}const poll=await pollOf(pool,id);if(!poll||poll.type!=='canonical'||poll.status!=='closed'){res.status(409).json({error:'Close a canonical poll before choosing its result.'});return;}const [option]=await pool.execute<RowDataPacket[]>('SELECT id FROM poll_options WHERE id=? AND poll_id=?',[optionId,id]);if(!option.length){res.status(400).json({error:'Option does not belong to this poll.'});return;}await pool.execute('UPDATE polls SET canonical_option_id=? WHERE id=?',[optionId,id]);res.json({canonicalOptionId:optionId});});
 router.post('/:id/implemented',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}const [result]=await pool.execute<ResultSetHeader>("UPDATE polls SET status='implemented' WHERE id=? AND status='closed' AND canonical_option_id IS NOT NULL",[id]);res.status(result.affectedRows?200:409).json(result.affectedRows?{ok:true}:{error:'Choose a winner on a closed poll first.'});});
 router.post('/:id/archive',async(req,res)=>{const id=idNumber(req.params.id);if(!id){res.status(400).json({error:'Invalid poll.'});return;}const poll=await pollOf(pool,id);if(!poll||!['closed','implemented'].includes(poll.status)){res.status(409).json({error:'Close this poll before archiving.'});return;}const used=await placements(pool,id);if(used.length&&!req.body?.confirmAttached){res.status(409).json({error:'This poll is attached to a chapter or scene. Confirm archive to continue.',placements:used});return;}await pool.execute("UPDATE polls SET status='archived' WHERE id=?",[id]);res.json({ok:true});});
 return router;
}
function adminPoll(p:RowDataPacket){return {id:Number(p.id),adminTitle:p.admin_title,question:p.question,description:p.description,type:p.type,status:p.status,allowSkip:!!p.allow_skip,showResults:!!p.show_results,allowVoteChange:!!p.allow_vote_change,openAt:p.open_at,closeAt:p.close_at,canonicalOptionId:p.canonical_option_id==null?null:Number(p.canonical_option_id),officialTotal:p.official_total==null?null:Number(p.official_total),createdAt:p.created_at,updatedAt:p.updated_at,closedAt:p.closed_at};}
type ValidatedOption={id:number|null;text:string;description:string};
function validated(body:any){
 if(!body||!validText(body.adminTitle,200)||typeof body.question!=='string'||body.question.length>500||typeof body.description!=='string'||!['opinion','canonical'].includes(body.type)||!Array.isArray(body.options)||body.options.length<2||body.options.length>20)return null;
 const options:ValidatedOption[]=body.options.map((o:any)=>({id:o?.id==null?null:idNumber(o.id),text:o?.text,description:o?.description??''}));
 if(options.some((o:any)=>!validText(o.text,500)||typeof o.description!=='string'||o.description.length>5000))return null;
 const openAt=dateValue(body.openAt),closeAt=dateValue(body.closeAt);if(openAt===undefined||closeAt===undefined||openAt&&closeAt&&closeAt.getTime()<=openAt.getTime())return null;
 return {adminTitle:body.adminTitle.trim(),question:body.question.trim(),description:body.description,type:body.type as 'opinion'|'canonical',allowSkip:!!body.allowSkip,showResults:!!body.showResults,allowVoteChange:!!body.allowVoteChange,openAt,closeAt,options};
}
