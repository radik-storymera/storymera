import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {RowDataPacket} from 'mysql2/promise';
import type {AddressInfo} from 'node:net';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {inspectMedia,moveMediaToTrash,restoreMedia} from '../server/media-management.ts';
import {createApp} from '../server/app.ts';

test('media used only by a historical revision can enter recoverable trash without losing its stable ID',async()=>{
 const pool=createPool(true);await migrate(pool);
 const server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const suffix=randomUUID().slice(0,8),user=randomUUID(),media=randomUUID(),hero=`history-${suffix}`,chapter=`history-chapter-${suffix}`,filename=`${media}.jpg`;
 const mediaPath=path.resolve('.local/media',filename),trashPath=path.resolve('.local/media-trash',filename);
 const oldDocument={chapter:{id:chapter},scenes:{old:{title:'Old illustration',media:{type:'image',src:`/api/media/${media}`}}}};
 const currentDocument={chapter:{id:chapter},scenes:{current:{title:'Current scene'}}};
 try{
  await fs.mkdir(path.dirname(mediaPath),{recursive:true});await fs.copyFile('public/media/jessica-city.jpg',mediaPath);
  await pool.execute("INSERT INTO users(id,email,password_hash,role) VALUES(?,?,?,'admin')",[user,`history-${suffix}@example.test`,'test-only']);
  await pool.execute('INSERT INTO heroines(id,name,description,media) VALUES(?,?,?,?)',[hero,'History test','Test only',JSON.stringify({type:'image',src:'/media/arrival.svg',alt:'Test'})]);
  await pool.execute('INSERT INTO chapters(id,heroine_id,title,description,published_revision,guest_free) VALUES(?,?,?,?,2,TRUE)',[chapter,hero,'History chapter','Test only']);
  await pool.execute("INSERT INTO chapter_versions(chapter_id,revision,status,document) VALUES(?,1,'published',?),(?,2,'published',?)",[chapter,JSON.stringify(oldDocument),chapter,JSON.stringify(currentDocument)]);
  await pool.execute('INSERT INTO media_assets(id,filename,mime,size_bytes,original_name,created_by) VALUES(?,?,?,?,?,?)',[media,filename,'image/jpeg',(await fs.stat(mediaPath)).size,'historical.jpg',user]);
  await pool.execute('INSERT INTO version_media(chapter_id,revision,media_id) VALUES(?,1,?)',[chapter,media]);
  const before=(await inspectMedia(pool,[media]))[0];assert.equal(before.status,'eligible');assert.equal(before.uses.length,0);assert.ok(before.archivedUses.some(use=>use.includes('version 1')));
  const moved=(await moveMediaToTrash(pool,[media],user))[0];assert.equal(moved.status,'deleted');
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT trashed_at FROM media_assets WHERE id=?',[media]);assert.ok(rows[0]?.trashed_at);assert.equal(await exists(mediaPath),false);assert.equal(await exists(trashPath),true);
  const historicalResponse=await fetch(`${base}/api/media/${media}`);assert.equal(historicalResponse.status,200);assert.match(historicalResponse.headers.get('content-type')??'',/^image\/jpeg/);
  assert.equal((await restoreMedia(pool,media)).status,'restored');assert.equal(await exists(mediaPath),true);assert.equal(await exists(trashPath),false);
 }finally{
  await pool.execute('DELETE FROM version_media WHERE chapter_id=?',[chapter]);await pool.execute('DELETE FROM chapter_versions WHERE chapter_id=?',[chapter]);await pool.execute('DELETE FROM chapters WHERE id=?',[chapter]);await pool.execute('DELETE FROM heroines WHERE id=?',[hero]);await pool.execute('DELETE FROM media_assets WHERE id=?',[media]);await pool.execute('DELETE FROM users WHERE id=?',[user]);await Promise.allSettled([fs.unlink(mediaPath),fs.unlink(trashPath)]);await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();
 }
});

async function exists(file:string){try{await fs.access(file);return true;}catch{return false;}}
