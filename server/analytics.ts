import type {Pool,PoolConnection} from 'mysql2/promise';

type Db=Pool|PoolConnection;
export type EventOwner={userId?:string|null;guestId?:string|null};
export type EventContext={heroineId?:string|null;chapterId?:string|null;sceneId?:string|null;pollId?:number|null;deviceType?:'desktop'|'tablet'|'mobile'|'unknown';source?:string};

export const readerEvents=new Set([
 'guest_chapter_started','guest_registration_prompt_seen','guest_create_profile_clicked','guest_registration_skipped',
 'guest_poll_seen','guest_poll_skipped','registration_completed','guest_progress_transferred',
 'first_chapter_completed','second_chapter_preview_seen','billing_page_opened'
]);

export async function recordEvent(db:Db,eventType:string,owner:EventOwner,context:EventContext={}){
 if(!readerEvents.has(eventType))return;
 const device:string=context.deviceType&&['desktop','tablet','mobile'].includes(context.deviceType)?context.deviceType:'unknown';
 const source=typeof context.source==='string'&&context.source.length<=120?context.source:'reader';
 await db.execute('INSERT INTO analytics_events(event_type,user_id,guest_id,heroine_id,chapter_id,scene_id,poll_id,device_type,source) VALUES(?,?,?,?,?,?,?,?,?)',[
  eventType,owner.userId??null,owner.guestId??null,context.heroineId??null,context.chapterId??null,context.sceneId??null,context.pollId??null,device,source
 ]);
}
