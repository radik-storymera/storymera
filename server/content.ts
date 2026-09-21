import type {Pool,PoolConnection,RowDataPacket} from 'mysql2/promise';
import type {Story} from '../src/story-model.ts';
export async function storyFromDb(pool:Pool|PoolConnection,id:string,revision?:number,publishedOnly=true):Promise<Story|null>{
 const [rows]=await pool.execute<RowDataPacket[]>(`SELECT v.document FROM chapter_versions v JOIN chapters c ON c.id=v.chapter_id WHERE c.id=? AND v.revision=${revision===undefined?'c.published_revision':'?'} ${publishedOnly?"AND v.status='published'":''}` ,revision===undefined?[id]:[id,revision]);
 return rows[0]?.document??null;
}
export const mediaIds=(story:Story)=>[...new Set(Object.values(story.scenes).flatMap(s=>[s.media?.src,s.media?.type==='video'?s.media.poster:'']).filter((src):src is string=>!!src).map(s=>s.match(/^\/api\/media\/([a-f0-9-]{36})$/)?.[1]).filter((s):s is string=>!!s))];
export async function linkMedia(conn:PoolConnection,story:Story){
 await conn.execute('DELETE FROM version_media WHERE chapter_id=? AND revision=?',[story.chapter.id,story.chapter.revision]);
 for(const id of mediaIds(story))await conn.execute('INSERT INTO version_media(chapter_id,revision,media_id) VALUES(?,?,?)',[story.chapter.id,story.chapter.revision,id]);
}
