// Publish a linear copy of the current first chapter without touching historical
// versions, reader progress, or an owner's existing draft.
import type {RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {createPool} from './db.ts';
import {linearScenes} from '../src/linear.ts';
import {linkMedia} from './content.ts';
import type {Story} from '../src/story-model.ts';

export async function migrateLinearContent(test=false){
 const pool=createPool(test),connection=await pool.getConnection();
 try{
  await connection.beginTransaction();
  const [chapters]=await connection.execute<RowDataPacket[]>('SELECT id,published_revision FROM chapters WHERE id=? FOR UPDATE',['first-day']);
  if(!chapters.length||chapters[0].published_revision==null)throw Error('The first chapter has no published version.');
  const current=Number(chapters[0].published_revision);
  const [versions]=await connection.execute<RowDataPacket[]>("SELECT revision,status,document FROM chapter_versions WHERE chapter_id=? AND revision=? FOR UPDATE",['first-day',current]);
  if(!versions.length||versions[0].status!=='published')throw Error('Published chapter version is missing.');
  const source=versions[0].document as Story;
  if(source.scenes.crossroads?.pollId&&source.chapter.finalPollId){await connection.rollback();return {alreadyApplied:true,revision:current};}
  if(source.scenes.crossroads?.pollId||source.chapter.finalPollId)throw Error('A poll is already attached. Review this chapter manually.');
  const order=linearScenes(source);
  if(!source.scenes.crossroads||!source.scenes.tomorrow||order.length<2)throw Error('Expected first-chapter scenes are missing. No changes were made.');
  const makePoll=async(title:string,question:string,type:'opinion'|'canonical',texts:string[])=>{
   const [result]=await connection.execute<ResultSetHeader>("INSERT INTO polls(admin_title,question,description,type,status,allow_skip,show_results,allow_vote_change) VALUES(?,?,?,?,'active',?,?,?)",[title,question,'',type,type==='opinion',true,type==='opinion']);
   for(let i=0;i<texts.length;i++)await connection.execute('INSERT INTO poll_options(poll_id,text,description,sort_order) VALUES(?,?,?,?)',[result.insertId,texts[i],'',i+1]);
   return result.insertId;
  };
  const opinion=await makePoll('First city stop','Which first stop would you choose in a new city?','opinion',['The café','The riverside path']);
  const canonical=await makePoll('Next chapter direction','What should Jessica explore in the next chapter?','canonical',['Return to the shared bookshelf','Discover another corner of the city']);
  const [latest]=await connection.execute<RowDataPacket[]>('SELECT MAX(revision) AS revision FROM chapter_versions WHERE chapter_id=?',['first-day']);
  const revision=Number(latest[0].revision)+1;
  const document=structuredClone(source);
  document.chapter.revision=revision;
  document.chapter.firstScene=order[0].id;
  document.chapter.finalPollId=canonical;
  for(const [index,item] of order.entries()){
   const scene=document.scenes[item.id];
   scene.step=index+1;
   scene.final=index===order.length-1;
   scene.actions=[];
   delete scene.variants;
   delete scene.kind;
   scene.pollId=item.id==='crossroads'?opinion:null;
   scene.pollPlacement=item.id==='crossroads'?'after_scene':undefined;
  }
  await connection.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,?,'published',?)",['first-day',revision,JSON.stringify(document)]);
  await linkMedia(connection,document);
  const [update]=await connection.execute<ResultSetHeader>('UPDATE chapters SET published_revision=? WHERE id=? AND published_revision=?',[revision,'first-day',current]);
  if(update.affectedRows!==1)throw Error('Chapter changed during migration.');
  await connection.commit();
  return {alreadyApplied:false,revision,sceneCount:order.length,opinionPollId:opinion,finalPollId:canonical};
 }catch(error){await connection.rollback();throw error;}finally{connection.release();await pool.end();}
}
if(process.argv[1]?.endsWith('migrate-linear-content.ts')){
 try{console.log(JSON.stringify(await migrateLinearContent(process.argv.includes('--test'))));}
 catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
