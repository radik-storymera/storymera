import {createPool} from '../server/db.ts';
import {linearScenes} from '../src/linear.ts';
import type {Story} from '../src/story-model.ts';
import type {RowDataPacket} from 'mysql2/promise';

const pool=createPool(process.argv.includes('--test'));
try{
 const [chapters]=await pool.execute<RowDataPacket[]>('SELECT published_revision FROM chapters WHERE id=?',['first-day']);
 if(!chapters.length)throw Error('First chapter missing');
 const current=Number(chapters[0].published_revision);
 const [versions]=await pool.execute<RowDataPacket[]>('SELECT revision,status,document FROM chapter_versions WHERE chapter_id=? ORDER BY revision',['first-day']);
 const published=versions.find(v=>Number(v.revision)===current);
 if(!published||published.status!=='published')throw Error('Current published version missing');
 const story=published.document as Story,scenes=linearScenes(story);
 if(scenes.length!==Object.keys(story.scenes).length||scenes.some((s,i)=>s.step!==i+1||s.final!==(i===scenes.length-1)))throw Error('Linear order is incomplete');
 const pollScenes=scenes.filter(scene=>scene.type==='poll');
 if(pollScenes.length!==1||!pollScenes[0].pollId)throw Error('Separate poll scene missing');
 if(scenes.some(scene=>(scene.type??'story')==='story'&&scene.pollId!=null))throw Error('A story scene still contains a poll.');
 if(versions.some(v=>v.status==='draft'&&Number(v.revision)===current))throw Error('Current version is a draft');
 console.log(JSON.stringify({publishedRevision:current,sceneIds:scenes.map(s=>s.id),draftRevisions:versions.filter(v=>v.status==='draft').map(v=>Number(v.revision)),historicalVersions:versions.length-1,opinionPollId:pollScenes[0].pollId,finalPollId:story.chapter.finalPollId}));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
finally{await pool.end();}
