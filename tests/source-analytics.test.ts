import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {RowDataPacket} from 'mysql2/promise';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {migrateSourceAnalytics} from '../server/migrate-source-analytics.ts';
import {createApp} from '../server/app.ts';
import {sourceLinkRouter} from '../server/source-analytics.ts';
import express from 'express';

test('short links redirect when collection is disabled or a click write fails',async()=>{
 const previous=process.env.SOURCE_ANALYTICS_ENABLED;let insertAttempts=0;
 const pool={execute:async(sql:string)=>{if(sql.startsWith('SELECT'))return [[{id:randomUUID(),target_path:'/?manual=1'}],[]];insertAttempts++;throw Error('simulated analytics write failure');}} as any;
 const app=express();app.use(sourceLinkRouter(pool));const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{process.env.SOURCE_ANALYTICS_ENABLED='true';let response=await fetch(base+'/go/manual-check',{redirect:'manual'});assert.equal(response.status,307);assert.equal(response.headers.get('location'),'/?manual=1');assert.equal(insertAttempts,1);process.env.SOURCE_ANALYTICS_ENABLED='false';response=await fetch(base+'/go/manual-check',{redirect:'manual'});assert.equal(response.status,307);assert.equal(response.headers.get('location'),'/?manual=1');assert.equal(insertAttempts,1,'disabled collection does not attempt a write');}
 finally{if(previous===undefined)delete process.env.SOURCE_ANALYTICS_ENABLED;else process.env.SOURCE_ANALYTICS_ENABLED=previous;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('source analytics migration, attribution, dedupe and admin authorization',async()=>{
 const pool=createPool(true);let server:any;const ids:string[]=[];
 try{
 await migrate(pool);
 const [before]=await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name NOT LIKE 'source_tracking_%' AND table_name<>'source_analytics_migrations'");
 await migrateSourceAnalytics(true);await migrateSourceAnalytics(true);
 const [after]=await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name NOT LIKE 'source_tracking_%' AND table_name<>'source_analytics_migrations'");assert.equal(Number(after[0].n),Number(before[0].n));
 server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 function client(){const jar=new Map<string,string>();let csrf='';return {jar,async call(path:string,method='GET',body?:unknown,redirect:RequestRedirect='follow'){const response=await fetch(base+path,{method,redirect,headers:{Origin:'http://localhost:5175','Content-Type':'application/json','X-CSRF-Token':csrf,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}const contentType=response.headers.get('content-type')??'',data=contentType.includes('json')?await response.json():await response.text();if(path==='/api/csrf')csrf=data.token;return {status:response.status,data,headers:response.headers};}};}
 const admin=client(),anonymous=client(),lateReader=client(),suffix=randomUUID().slice(0,8);
  await admin.call('/api/csrf');const registered=await admin.call('/api/auth/register','POST',{email:`source-admin-${suffix}@example.test`,password:randomUUID()});ids.push(registered.data.user.id);await pool.execute("UPDATE users SET role='admin' WHERE id=?",[registered.data.user.id]);
  assert.equal((await anonymous.call('/api/admin/source-analytics/sources')).status,401);
  const source={displayName:'YouTube launch',source:'youtube',campaign:'launch',publication:'episode-1',shortCode:'yt-'+suffix,targetPath:'/?campaign=launch',visibleMetrics:['reading_started','chapter_completed','registration_completed','goal'],goalType:'none',goalHeroineId:null,goalChapterId:null,goalSceneId:null};
  const created=await admin.call('/api/admin/source-analytics/sources','POST',source);assert.equal(created.status,201);
  const beforeClick=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM source_tracking_visits WHERE source_id=?',[created.data.id]);assert.equal(Number(beforeClick[0][0].n),0);
  const redirect=await anonymous.call('/go/'+source.shortCode,'GET',undefined,'manual');assert.equal(redirect.status,307);assert.equal(redirect.headers.get('location'),source.targetPath);
  const afterClick=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM source_tracking_visits WHERE source_id=?',[created.data.id]);assert.equal(Number(afterClick[0][0].n),0,'redirect alone is not a visit');
  await anonymous.call('/api/csrf');const first=await anonymous.call('/api/tracking/confirm','POST',{referrer:'',path:'/'});assert.equal(first.status,200);assert.match(first.data.visitId,/^[a-f0-9-]{36}$/);
  const repeated=await anonymous.call('/api/tracking/confirm','POST',{visitId:first.data.visitId,referrer:'',path:'/'});assert.equal(repeated.data.visitId,first.data.visitId,'reload reuses an active attributed visit');
  const event={visitId:first.data.visitId,eventKey:randomUUID(),type:'reading_started',heroineId:'jessica',chapterId:'first-day',sceneId:'arrival'};assert.equal((await anonymous.call('/api/tracking/event','POST',event)).status,202);await anonymous.call('/api/tracking/event','POST',{...event,eventKey:randomUUID()});
  const [eventRows]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM source_tracking_events WHERE visit_id=? AND event_type=\'reading_started\'',[first.data.visitId]);assert.equal(Number(eventRows[0].n),1,'retries are idempotent');
  const report=await admin.call('/api/admin/source-analytics/report?period=30&status=active');assert.equal(report.status,200);const row=report.data.rows.find((item:any)=>item.id===created.data.id);assert.equal(row.visits,1,'visit count');assert.equal(row.visitors,1,'visitor count');assert.equal(row.started,1,'started count');assert.equal(report.data.timezone,'Europe/Kyiv');
  const today=await admin.call('/api/admin/source-analytics/report?period=today&status=active');assert.equal(today.status,200);assert.equal(today.data.timezone,'Europe/Kyiv');assert.equal(today.data.from,today.data.to);assert.equal(today.data.rows.find((item:any)=>item.id===created.data.id).visits,1,'UTC event falls inside the Europe/Kyiv Today boundary');
  await lateReader.call('/api/csrf');const unknown=await lateReader.call('/api/tracking/confirm','POST',{utmSource:'unknown-network',utmCampaign:'mystery',referrer:'',path:'/'});assert.match(unknown.data.visitId,/^[a-f0-9-]{36}$/);let unassigned=(await admin.call('/api/admin/source-analytics/report?period=30&status=active')).data.rows.find((item:any)=>item.id==='unassigned:unassigned_utm');assert.equal(unassigned.visits,1,'unknown UTM stays unassigned');
  await pool.execute('UPDATE source_tracking_visits SET last_activity_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 31 MINUTE) WHERE id=?',[unknown.data.visitId]);const afterTimeout=await lateReader.call('/api/tracking/confirm','POST',{visitId:unknown.data.visitId,referrer:'',path:'/'});assert.notEqual(afterTimeout.data.visitId,unknown.data.visitId,'30 minutes of inactivity starts a new visit');
  const attributed=client();await attributed.call('/go/'+source.shortCode,'GET',undefined,'manual');await attributed.call('/api/csrf');await attributed.call('/api/tracking/confirm','POST',{referrer:'',path:'/'});const reader=await attributed.call('/api/auth/register','POST',{email:`attributed-${suffix}@example.test`,password:randomUUID()});ids.push(reader.data.user.id);for(let i=0;i<20;i++){const [registeredEvents]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM source_tracking_events WHERE user_id=? AND event_type=\'registration_completed\'',[reader.data.user.id]);if(Number(registeredEvents[0].n)===1)break;await new Promise(resolve=>setTimeout(resolve,10));}const withRegistration=await admin.call('/api/admin/source-analytics/report?period=30&status=active');assert.equal(withRegistration.data.rows.find((item:any)=>item.id===created.data.id).registrations,1,'successful registration is attributed once');
  const bad={...source,shortCode:'other-'+suffix,targetPath:'https://attacker.invalid'};assert.equal((await admin.call('/api/admin/source-analytics/sources','POST',bad)).status,400,'external redirect targets are rejected');
  const changed={...source,shortCode:'changed-'+suffix};assert.equal((await admin.call('/api/admin/source-analytics/sources/'+created.data.id,'PATCH',changed)).status,409,'short code is immutable');
  await admin.call('/api/admin/source-analytics/sources/'+created.data.id+'/archive','POST',{archived:true});assert.equal((await anonymous.call('/go/'+source.shortCode,'GET',undefined,'manual')).status,404);await admin.call('/api/admin/source-analytics/sources/'+created.data.id+'/archive','POST',{archived:false});
 }finally{
  for(const table of ['source_tracking_events','source_tracking_visits','source_tracking_clicks','source_tracking_visitors','source_tracking_sources'])await pool.query(`DELETE FROM ${table}`).catch(()=>{});for(const id of ids){await pool.execute('DELETE FROM sessions WHERE user_id=?',[id]).catch(()=>{});await pool.execute('DELETE FROM users WHERE id=?',[id]).catch(()=>{});}
  if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();
 }
});
