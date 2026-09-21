import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import type {Pool,RowDataPacket} from 'mysql2/promise';
import {activeBillingPlans} from '../src/billingPlans.ts';

type Session=(req:any)=>Promise<{id:string;role:string;keyBalance:number}|null>;
const eventTypes=new Set(['plans_page_viewed','plan_selected','checkout_clicked','payment_unavailable_shown','returned_to_stories']);
const sources=new Set(['locked_chapter','header_balance','profile','chapter_completed','other']);
const safeId=(value:unknown)=>value==null||typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/i.test(value);

export function billingRouter(pool:Pool,session:Session){
 const router=Router();
 router.use(async(req,res,next)=>{const user=await session(req);if(!user){res.status(401).json({error:'Sign in to view Key plans.'});return;}res.locals.user=user;next();});
 router.get('/plans',(_req,res)=>res.json({plans:activeBillingPlans()}));
 router.post('/events',async(req,res)=>{
  const {type,planId,heroineId,chapterId}=req.body??{},source=sources.has(req.body?.source)?req.body.source:'other';
  if(typeof type!=='string'||!eventTypes.has(type)||!safeId(heroineId)||!safeId(chapterId)){res.status(400).json({error:'Invalid plan event.'});return;}
  const plan=typeof planId==='string'?activeBillingPlans().find(item=>item.id===planId):undefined;
  if(['plan_selected','checkout_clicked','payment_unavailable_shown'].includes(type)&&!plan){res.status(400).json({error:'Choose an available plan.'});return;}
  try{
   await pool.execute('INSERT INTO plan_analytics_events(id,user_id,event_type,plan_id,plan_keys,price_minor,currency,user_key_balance,heroine_id,chapter_id,source) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[
    randomUUID(),res.locals.user.id,type,plan?.id??null,plan?.keys??null,plan?.priceMinor??null,plan?.currency??null,res.locals.user.keyBalance,heroineId??null,chapterId??null,source
   ]);
   res.status(201).json({ok:true});
  }catch(error){console.error('Plan analytics write failed',{type,userId:res.locals.user.id,error:error instanceof Error?error.message:'unknown'});res.status(503).json({error:'Analytics unavailable.'});}
 });
 return router;
}

export function adminBillingRouter(pool:Pool){
 const router=Router();
 router.get('/stats',async(req,res)=>{
  const period=['7','30','all'].includes(String(req.query.period))?String(req.query.period):'all';
  const since=period==='all'?null:Number(period);
  const where=since?'WHERE created_at>=UTC_TIMESTAMP(3)-INTERVAL ? DAY':'';
  const andWhere=since?'WHERE created_at>=UTC_TIMESTAMP(3)-INTERVAL ? DAY AND':'WHERE';
  const args=since?[since]:[];
  const [summaryRows]=await pool.execute<RowDataPacket[]>(`SELECT event_type,COUNT(*) total,COUNT(DISTINCT user_id) unique_users FROM plan_analytics_events ${where} GROUP BY event_type`,args);
  const [planRows]=await pool.execute<RowDataPacket[]>(`SELECT plan_id,event_type,COUNT(*) total,COUNT(DISTINCT user_id) unique_users FROM plan_analytics_events ${andWhere} plan_id IS NOT NULL GROUP BY plan_id,event_type`,args);
  const [journeyRows]=await pool.execute<RowDataPacket[]>(`SELECT user_id,event_type,plan_id,created_at,id FROM plan_analytics_events ${andWhere} user_id IS NOT NULL AND event_type IN ('plan_selected','checkout_clicked') ORDER BY user_id,created_at,id`,args);
  const summary=Object.fromEntries(summaryRows.map(row=>[row.event_type,{total:Number(row.total),unique:Number(row.unique_users)}]));
  const plans=activeBillingPlans().map(plan=>{const selected=planRows.find(row=>row.plan_id===plan.id&&row.event_type==='plan_selected'),checkout=planRows.find(row=>row.plan_id===plan.id&&row.event_type==='checkout_clicked');return {...plan,selections:Number(selected?.total??0),uniqueSelections:Number(selected?.unique_users??0),checkouts:Number(checkout?.total??0),uniqueCheckouts:Number(checkout?.unique_users??0)};});
  const journeys=new Map<string,{first:string|null;last:string|null;switches:number;previous:string|null;checkout:boolean}>();
  for(const row of journeyRows){const id=String(row.user_id),journey=journeys.get(id)??{first:null,last:null,switches:0,previous:null,checkout:false};if(row.event_type==='plan_selected'){const current=String(row.plan_id);if(!journey.first)journey.first=current;if(journey.previous&&journey.previous!==current)journey.switches++;journey.previous=current;journey.last=current;}else journey.checkout=true;journeys.set(id,journey);}
  const views=summary.plans_page_viewed??{total:0,unique:0},selections=summary.plan_selected??{total:0,unique:0},checkouts=summary.checkout_clicked??{total:0,unique:0};
  const percent=(a:number,b:number)=>b?Math.round(a/b*1000)/10:0;
  res.json({period,summary:{views,selections,checkouts,viewToSelection:percent(selections.unique,views.unique),viewToCheckout:percent(checkouts.unique,views.unique),selectionToCheckout:percent(checkouts.unique,selections.unique),planSwitches:[...journeys.values()].reduce((sum,item)=>sum+item.switches,0),firstSelections:Object.fromEntries(activeBillingPlans().map(p=>[p.id,[...journeys.values()].filter(j=>j.first===p.id).length])),lastSelections:Object.fromEntries(activeBillingPlans().map(p=>[p.id,[...journeys.values()].filter(j=>j.last===p.id).length]))},plans});
 });
 return router;
}
