// Preview first. --apply requires the observed published and draft revisions.
// Historical publications and their pinned reader progress are never rewritten.
import {createPool} from './db.ts';
import {linkMedia} from './content.ts';
import {pollErrors} from './polls.ts';
import {splitPollScenes} from '../src/split-poll-scenes.ts';
import type {Story} from '../src/story-model.ts';
import type {ResultSetHeader,RowDataPacket} from 'mysql2/promise';

const value=(name:string)=>{const index=process.argv.indexOf(name);return index<0?null:Number(process.argv[index+1]);};
const apply=process.argv.includes('--apply'),test=process.argv.includes('--test');
const pool=createPool(test),connection=await pool.getConnection();
let locked=false,committed=false;
try{
 const [lock]=await connection.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(), ':content-media'),30) AS acquired");
 if(Number(lock[0]?.acquired)!==1)throw Error('Content lock unavailable.');locked=true;
 await connection.beginTransaction();
 const [chapters]=await connection.execute<RowDataPacket[]>('SELECT id,published_revision FROM chapters WHERE id=? FOR UPDATE',['first-day']);
 if(chapters.length!==1||chapters[0].published_revision==null)throw Error('Published first-day chapter unavailable.');
 const current=Number(chapters[0].published_revision);
 const [versions]=await connection.execute<RowDataPacket[]>("SELECT revision,status,edit_version,document FROM chapter_versions WHERE chapter_id=? AND (revision=? OR status='draft') ORDER BY revision FOR UPDATE",['first-day',current]);
 const published=versions.find(v=>Number(v.revision)===current&&v.status==='published');
 const drafts=versions.filter(v=>v.status==='draft');
 if(!published||drafts.length>1)throw Error('Unexpected publication or multiple drafts.');
 const [older]=await connection.execute<RowDataPacket[]>('SELECT revision,document FROM chapter_versions WHERE chapter_id=? AND revision<? ORDER BY revision DESC',['first-day',current]);
 const historic=older.find(row=>Object.values((row.document as Story).scenes).some(s=>s.pollId!=null&&s.type!=='poll'))?.document as Story|undefined;
 const draft=drafts[0],source=splitPollScenes(published.document as Story,historic),pending=draft?splitPollScenes(draft.document as Story,historic):null;
 const needsSplit=(story:Story)=>Object.values(story.scenes).some(s=>s.pollId!=null&&(s.type!=='poll'||!!s.media));
 const currentUses=needsSplit(published.document as Story);
 const draftUses=!!draft&&needsSplit(draft.document as Story);
 const plan={publishedRevision:current,draftRevision:draft?Number(draft.revision):null,draftEditVersion:draft?Number(draft.edit_version):null,publishedConversions:source.created,draftConversions:pending?.created??[],historicalVersionsUntouched:true};
 console.log(JSON.stringify({phase:'preview',...plan}));
 if(!apply){await connection.rollback();}
 else{
  if(value('--expect-published')!==current||value('--expect-draft')!==(draft?Number(draft.revision):0)||value('--expect-edit')!==(draft?Number(draft.edit_version):0))throw Error('Chapter or draft changed since preview. No changes made.');
  if(!currentUses&&!draftUses)throw Error('No legacy story/poll attachment to migrate.');
  for(const story of [source.story,pending?.story].filter((s):s is Story=>!!s)){
   const errors=await pollErrors(connection,story);if(errors.length)throw Error(errors.join(' '));
  }
  let newRevision=current;
  if(currentUses){
   const [latest]=await connection.execute<RowDataPacket[]>('SELECT MAX(revision) AS n FROM chapter_versions WHERE chapter_id=?',['first-day']);
   newRevision=Number(latest[0].n)+1;
   source.story.chapter.revision=newRevision;
   await connection.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,?,'published',?)",['first-day',newRevision,JSON.stringify(source.story)]);
   await linkMedia(connection,source.story);
   const [updated]=await connection.execute<ResultSetHeader>('UPDATE chapters SET published_revision=? WHERE id=? AND published_revision=?',[newRevision,'first-day',current]);
   if(updated.affectedRows!==1)throw Error('Publication changed during migration.');
  }
  if(draft&&draftUses&&pending){
   const [updated]=await connection.execute<ResultSetHeader>("UPDATE chapter_versions SET document=?,edit_version=edit_version+1 WHERE chapter_id=? AND revision=? AND status='draft' AND edit_version=?",[JSON.stringify(pending.story),'first-day',draft.revision,draft.edit_version]);
   if(updated.affectedRows!==1)throw Error('Draft changed during migration.');
   await linkMedia(connection,pending.story);
  }
  await connection.commit();committed=true;
  console.log(JSON.stringify({phase:'committed',newPublishedRevision:newRevision,draftRevision:plan.draftRevision,draftEditVersion:plan.draftEditVersion==null?null:plan.draftEditVersion+Number(!!draftUses),publishedConversions:source.created,draftConversions:pending?.created??[]}));
 }
}catch(error){if(!committed)await connection.rollback();console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
finally{if(locked)await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':content-media'))");connection.release();await pool.end();}
