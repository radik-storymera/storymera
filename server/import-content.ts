// Frozen, one-time legacy import fixture. Reader and path validation use MySQL exclusively.
import {heroine,chapter,scenes} from './legacy-story.ts';
import {createPool} from './db.ts';
import type {Pool,RowDataPacket} from 'mysql2/promise';
export async function importContent(pool:Pool){
 const c=await pool.getConnection();try{await c.beginTransaction();
 await c.execute('INSERT IGNORE INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[heroine.id,heroine.name,heroine.description,JSON.stringify(heroine.media)]);
 await c.execute('INSERT IGNORE INTO chapters(id,heroine_id,title,description,display_order,published_revision) VALUES(?,?,?,?,0,1)',[chapter.id,heroine.id,chapter.title,chapter.subtitle]);
 const document={chapter:{...chapter,heroineId:heroine.id,description:chapter.subtitle},scenes:Object.fromEntries(Object.entries(scenes).map(([id,s])=>[id,{...s,final:s.actions.length===0}]))};
 await c.execute("INSERT IGNORE INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,1,'published',?)",[chapter.id,JSON.stringify(document)]);
 // Refuse silently orphaned saves, before adding the version foreign key.
 const [bad]=await c.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM progress p LEFT JOIN chapter_versions v ON v.chapter_id=p.chapter_id AND v.revision=p.story_revision WHERE v.chapter_id IS NULL');
 if(bad[0].n)throw Error('Existing progress has an unknown version; manual mapping is needed.');
 await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
if(process.argv[1]?.endsWith('import-content.ts')){const p=createPool(process.argv.includes('--test'));try{await importContent(p);console.log('Legacy content imported idempotently; identifiers and revision 1 preserved.');}catch{console.error('Import failed. Existing content was not overwritten.');process.exitCode=1;}finally{await p.end();}}
