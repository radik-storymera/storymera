import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {RowDataPacket} from 'mysql2/promise';
import {createPool} from '../server/db.ts';
import {migrate} from '../server/migrate.ts';
import {createApp} from '../server/app.ts';

test('registered Key plans record intent without changing balance',async()=>{
 const pool=createPool(true);await migrate(pool);const email=`plans-${randomUUID()}@example.test`,password=randomUUID()+'Aa1!',ids:string[]=[];
 const server=createApp(pool,'http://localhost:5175').listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
 function client(){const jar=new Map<string,string>();let csrf='';return {async call(path:string,method='GET',body?:unknown){const response=await fetch(base+path,{method,headers:{Origin:'http://localhost:5175','Content-Type':'application/json','X-CSRF-Token':csrf,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}const data=await response.json();if(path==='/csrf')csrf=data.token;return {status:response.status,data};}};}
 const guest=client(),browser=client();
 try{
  assert.equal((await guest.call('/billing/plans')).status,401);
  await browser.call('/csrf');const registered=await browser.call('/auth/register','POST',{email,password});assert.equal(registered.status,200);ids.push(registered.data.user.id);assert.equal(registered.data.user.keyBalance,0);
  const plans=await browser.call('/billing/plans');assert.equal(plans.status,200);assert.deepEqual(plans.data.plans.map((p:any)=>p.id),['mini','start','economy']);
  const context={source:'locked_chapter',heroineId:'jessica',chapterId:'chapter-two'};
  for(const body of [{type:'plans_page_viewed',...context},{type:'plan_selected',planId:'mini',...context},{type:'plan_selected',planId:'economy',...context},{type:'checkout_clicked',planId:'economy',...context},{type:'checkout_clicked',planId:'economy',...context},{type:'payment_unavailable_shown',planId:'economy',...context},{type:'returned_to_stories',planId:'economy',...context}])assert.equal((await browser.call('/billing/events','POST',body)).status,201);
  const [users]=await pool.execute<RowDataPacket[]>('SELECT key_balance FROM users WHERE id=?',[registered.data.user.id]);assert.equal(Number(users[0].key_balance),0);
  const [events]=await pool.execute<RowDataPacket[]>('SELECT event_type,plan_id,plan_keys,price_minor,currency,user_key_balance,source FROM plan_analytics_events WHERE user_id=? ORDER BY created_at,id',[registered.data.user.id]);assert.equal(events.length,7);const checkout=events.find(row=>row.event_type==='checkout_clicked');assert.deepEqual([checkout.plan_id,Number(checkout.plan_keys),Number(checkout.price_minor),checkout.currency,Number(checkout.user_key_balance),checkout.source],['economy',35,3000,'USD',0,'locked_chapter']);
  assert.equal((await browser.call('/admin/billing/stats?period=all')).status,403);await pool.execute("UPDATE users SET role='admin' WHERE id=?",[registered.data.user.id]);const stats=await browser.call('/admin/billing/stats?period=7');assert.equal(stats.status,200);assert.ok(stats.data.summary.views.unique>=1);assert.ok(stats.data.summary.checkouts.total>=2);assert.equal(stats.data.plans.find((p:any)=>p.id==='economy').uniqueCheckouts>=1,true);assert.ok(stats.data.summary.planSwitches>=1);
 }finally{
  for(const id of ids){await pool.execute('DELETE FROM plan_analytics_events WHERE user_id=?',[id]);await pool.execute('DELETE FROM analytics_events WHERE user_id=?',[id]);await pool.execute('DELETE FROM users WHERE id=?',[id]);}
  await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();
 }
});
