import type {PoolConnection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {createPool} from './db.ts';

type Counts={
 database:string;users:number;affectedUsers:number;progressRows:number;activeRows:number;completedRows:number;
 sessions:number;chapterUnlocks:number;pollVotes:number;pollProgress:number;pollAvailable:number;pollSkipped:number;pollVoted:number;
};

async function counts(db:PoolConnection):Promise<Counts>{
 const [[database],[users],[progress],[sessions],[unlocks],[votes],[polls]]=await Promise.all([
  db.query<RowDataPacket[]>('SELECT DATABASE() AS name'),
  db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users'),
  db.query<RowDataPacket[]>("SELECT COUNT(*) AS n,COUNT(DISTINCT user_id) AS users,SUM(completed_at IS NULL) AS active_rows,SUM(completed_at IS NOT NULL) AS completed_rows FROM progress WHERE user_id IS NOT NULL"),
  db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM sessions'),
  db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM chapter_unlocks'),
  db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM poll_votes'),
  db.query<RowDataPacket[]>("SELECT COUNT(*) AS n,SUM(status='available') AS available_rows,SUM(status='skipped') AS skipped_rows,SUM(status='voted') AS voted_rows FROM poll_progress WHERE user_id IS NOT NULL"),
 ]);
 return {database:String(database[0].name),users:Number(users[0].n),affectedUsers:Number(progress[0].users),progressRows:Number(progress[0].n),activeRows:Number(progress[0].active_rows??0),completedRows:Number(progress[0].completed_rows??0),sessions:Number(sessions[0].n),chapterUnlocks:Number(unlocks[0].n),pollVotes:Number(votes[0].n),pollProgress:Number(polls[0].n),pollAvailable:Number(polls[0].available_rows??0),pollSkipped:Number(polls[0].skipped_rows??0),pollVoted:Number(polls[0].voted_rows??0)};
}

async function newReaderCheck(db:PoolConnection,userCount:number){
 const [rows]=await db.query<RowDataPacket[]>("SELECT c.id,c.heroine_id,v.document FROM chapters c JOIN chapter_versions v ON v.chapter_id=c.id AND v.revision=c.published_revision WHERE c.archived=FALSE AND c.published_revision IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chapters earlier WHERE earlier.heroine_id=c.heroine_id AND earlier.archived=FALSE AND earlier.published_revision IS NOT NULL AND (earlier.display_order<c.display_order OR earlier.display_order=c.display_order AND earlier.id<c.id))");
 const valid=rows.every(row=>{const document=row.document as {chapter?:{firstScene?:string};scenes?:Record<string,{id:string;step:number}>};const ordered=Object.values(document.scenes??{}).sort((a,b)=>a.step-b.step||a.id.localeCompare(b.id));return !!ordered.length&&document.chapter?.firstScene===ordered[0].id;});
 return {registeredUsers:userCount,availableStories:rows.length,expectedUnstartedStates:userCount*rows.length,allRegisteredProgressEmpty:true,firstPublishedScenesValid:valid};
}

const apply=process.argv.includes('--apply');
if(process.env.NODE_ENV==='production')throw new Error('Refusing to reset progress in production.');
const pool=createPool(false),connection=await pool.getConnection();
try{
 const before=await counts(connection);
 if(!/^jessica_stories(?:$|_)/.test(before.database))throw new Error(`Unexpected database: ${before.database}`);
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',before,...(before.progressRows===0?{newReaderCheck:await newReaderCheck(connection,before.users)}:{}),pollImpact:{pollProgressDeleted:0,pollVotesDeleted:0,repeatVoteWithExistingVote:false,skippedOrAvailableWithoutVoteCanVoteAfterReachingPollAgain:true}},null,2));
 if(!apply)process.exitCode=0;
 else{
  await connection.beginTransaction();
  try{
   await connection.query('SELECT id FROM users FOR UPDATE');
   const [result]=await connection.execute<ResultSetHeader>('DELETE FROM progress WHERE user_id IS NOT NULL');
   if(result.affectedRows!==before.progressRows)throw new Error(`Expected to delete ${before.progressRows} rows, deleted ${result.affectedRows}.`);
   const after=await counts(connection);
   if(after.progressRows!==0||after.affectedUsers!==0)throw new Error('Registered-user progress remains after reset.');
   for(const field of ['users','sessions','chapterUnlocks','pollVotes','pollProgress','pollAvailable','pollSkipped','pollVoted'] as const)if(after[field]!==before[field])throw new Error(`${field} changed during progress-only reset.`);
   await connection.commit();
   console.log(JSON.stringify({committed:true,deletedProgressRows:result.affectedRows,affectedUsers:before.affectedUsers,after,newReaderCheck:await newReaderCheck(connection,after.users)},null,2));
  }catch(error){await connection.rollback();throw error;}
 }
}finally{connection.release();await pool.end();}
