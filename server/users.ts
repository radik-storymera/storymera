import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import type {Pool,RowDataPacket} from 'mysql2/promise';

const pageSize=20,maxBalance=1_000_000;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const pageNumber=(value:unknown)=>{const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:1;};

export function adminUsersRouter(pool:Pool){
 const router=Router();
 router.get('/stats',async(_req,res)=>{
  const [rows]=await pool.query<RowDataPacket[]>("SELECT COUNT(*) total,SUM(created_at>=UTC_TIMESTAMP(3)-INTERVAL 7 DAY) last7,SUM(created_at>=UTC_TIMESTAMP(3)-INTERVAL 30 DAY) last30 FROM users WHERE role='reader'");
  const [admins]=await pool.query<RowDataPacket[]>("SELECT COUNT(*) total FROM users WHERE role='admin'");
  res.json({readers:{total:Number(rows[0].total),last7:Number(rows[0].last7??0),last30:Number(rows[0].last30??0)},administrators:Number(admins[0].total)});
 });
 router.get('/',async(req,res)=>{
  const page=pageNumber(req.query.page),search=typeof req.query.search==='string'?req.query.search.trim().slice(0,254):'';
  const pattern=`%${search.replace(/[\\%_]/g,'\\$&')}%`,where=search?'WHERE LOWER(u.email) LIKE LOWER(?) ESCAPE \'\\\\\'':'';
  const [countRows]=await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM users u ${where}`,search?[pattern]:[]),total=Number(countRows[0].total),pages=Math.max(1,Math.ceil(total/pageSize)),safePage=Math.min(page,pages),offset=(safePage-1)*pageSize;
  const [rows]=await pool.execute<RowDataPacket[]>(`SELECT u.id,u.email,u.role,u.key_balance,u.created_at,NULL last_login_at,(SELECT COUNT(*) FROM chapter_unlocks cu WHERE cu.user_id=u.id) unlocked_count,h.name heroine_name,c.title chapter_title,p.scene_id,p.completed_at,JSON_UNQUOTE(JSON_EXTRACT(v.document,CONCAT('$.scenes."',p.scene_id,'".title'))) scene_title FROM users u LEFT JOIN progress p ON p.id=(SELECT p2.id FROM progress p2 WHERE p2.user_id=u.id ORDER BY (p2.completed_at IS NULL) DESC,p2.updated_at DESC,p2.id DESC LIMIT 1) LEFT JOIN heroines h ON h.id=p.heroine_id LEFT JOIN chapters c ON c.id=p.chapter_id LEFT JOIN chapter_versions v ON v.chapter_id=p.chapter_id AND v.revision=p.story_revision ${where} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`,search?[pattern,pageSize,offset]:[pageSize,offset]);
  res.json({items:rows.map(row=>({id:String(row.id),email:String(row.email),role:String(row.role),keyBalance:Number(row.key_balance),createdAt:row.created_at,lastLoginAt:null,unlockedCount:Number(row.unlocked_count),progress:row.chapter_title?{heroineName:String(row.heroine_name),chapterTitle:String(row.chapter_title),sceneTitle:String(row.scene_title??row.scene_id),completed:row.completed_at!=null}:null})),page:safePage,pageSize,total,pages,search});
 });
 router.get('/:id',async(req,res)=>{
  if(!uuid(req.params.id)){res.status(400).json({error:'Invalid user ID.'});return;}
  const [users]=await pool.execute<RowDataPacket[]>('SELECT id,email,role,key_balance,created_at FROM users WHERE id=?',[req.params.id]);if(!users[0]){res.status(404).json({error:'User not found.'});return;}
  const [unlocks]=await pool.execute<RowDataPacket[]>('SELECT cu.chapter_id,cu.key_cost,cu.unlocked_at,c.title chapter_title,h.id heroine_id,h.name heroine_name FROM chapter_unlocks cu JOIN chapters c ON c.id=cu.chapter_id JOIN heroines h ON h.id=c.heroine_id WHERE cu.user_id=? ORDER BY cu.unlocked_at DESC',[req.params.id]);
  const [progress]=await pool.execute<RowDataPacket[]>('SELECT p.heroine_id,h.name heroine_name,p.chapter_id,c.title chapter_title,p.scene_id,JSON_UNQUOTE(JSON_EXTRACT(v.document,CONCAT(\'$.scenes."\',p.scene_id,\'".title\'))) scene_title,p.completed_at,p.updated_at FROM progress p JOIN heroines h ON h.id=p.heroine_id JOIN chapters c ON c.id=p.chapter_id JOIN chapter_versions v ON v.chapter_id=p.chapter_id AND v.revision=p.story_revision WHERE p.user_id=? ORDER BY p.updated_at DESC',[req.params.id]);
  const row=users[0];res.json({id:String(row.id),email:String(row.email),role:String(row.role),keyBalance:Number(row.key_balance),createdAt:row.created_at,lastLoginAt:null,unlocks:unlocks.map(item=>({chapterId:item.chapter_id,chapterTitle:item.chapter_title,heroineId:item.heroine_id,heroineName:item.heroine_name,keyCost:Number(item.key_cost),unlockedAt:item.unlocked_at})),progress:progress.map(item=>({heroineId:item.heroine_id,heroineName:item.heroine_name,chapterId:item.chapter_id,chapterTitle:item.chapter_title,sceneId:item.scene_id,sceneTitle:item.scene_title??item.scene_id,completedAt:item.completed_at,updatedAt:item.updated_at}))});
 });
 router.get('/:id/key-transactions',async(req,res)=>{
  if(!uuid(req.params.id)){res.status(400).json({error:'Invalid user ID.'});return;}const page=pageNumber(req.query.page);
  const [exists]=await pool.execute<RowDataPacket[]>('SELECT 1 FROM users WHERE id=?',[req.params.id]);if(!exists.length){res.status(404).json({error:'User not found.'});return;}
  const [count]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) total FROM key_transactions WHERE user_id=?',[req.params.id]),total=Number(count[0].total),pages=Math.max(1,Math.ceil(total/pageSize)),safePage=Math.min(page,pages),offset=(safePage-1)*pageSize;
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT t.id,t.operation,t.balance_before,t.amount_delta,t.balance_after,t.reason,t.created_at,a.email admin_email FROM key_transactions t LEFT JOIN users a ON a.id=t.admin_id WHERE t.user_id=? ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?',[req.params.id,pageSize,offset]);
  res.json({items:rows.map(row=>({id:row.id,operation:row.operation,balanceBefore:Number(row.balance_before),amountDelta:Number(row.amount_delta),balanceAfter:Number(row.balance_after),reason:row.reason,createdAt:row.created_at,adminEmail:row.admin_email??'System'})),page:safePage,pageSize,total,pages});
 });
 router.post('/:id/keys',async(req,res)=>{
  if(!uuid(req.params.id)){res.status(400).json({error:'Invalid user ID.'});return;}const operation=req.body?.operation,value=Number(req.body?.value),reason=typeof req.body?.reason==='string'?req.body.reason.trim():'',idempotencyKey=req.body?.idempotencyKey;
  if(!['credit','debit','set'].includes(operation)||!Number.isSafeInteger(value)||(operation==='set'?value<0:value<=0)||value>maxBalance||reason.length<3||reason.length>500||!uuid(idempotencyKey)){res.status(400).json({error:`Use a whole value up to ${maxBalance}, a reason, and a valid request ID.`});return;}
  const c=await pool.getConnection();try{await c.beginTransaction();const [users]=await c.execute<RowDataPacket[]>('SELECT id,key_balance FROM users WHERE id=? FOR UPDATE',[req.params.id]);if(!users[0]){await c.rollback();res.status(404).json({error:'User not found.'});return;}
   const expectedType=operation==='credit'?'admin_credit':operation==='debit'?'admin_debit':'admin_set_balance';
   const [prior]=await c.execute<RowDataPacket[]>('SELECT id,user_id,admin_id,operation,balance_before,amount_delta,balance_after,reason,created_at FROM key_transactions WHERE idempotency_key=?',[idempotencyKey]);if(prior[0]){const matches=prior[0].user_id===req.params.id&&prior[0].admin_id===res.locals.user.id&&prior[0].operation===expectedType&&prior[0].reason===reason&&(operation==='credit'?Number(prior[0].amount_delta)===value:operation==='debit'?Number(prior[0].amount_delta)===-value:Number(prior[0].balance_after)===value);if(!matches){await c.rollback();res.status(409).json({error:'This request ID was already used for another operation.'});return;}await c.commit();res.json({duplicate:true,transaction:{id:prior[0].id,operation:prior[0].operation,balanceBefore:Number(prior[0].balance_before),amountDelta:Number(prior[0].amount_delta),balanceAfter:Number(prior[0].balance_after),reason:prior[0].reason,createdAt:prior[0].created_at},keyBalance:Number(users[0].key_balance)});return;}
   const before=Number(users[0].key_balance),after=operation==='credit'?before+value:operation==='debit'?before-value:value;if(after<0){await c.rollback();res.status(409).json({error:'The user does not have enough Keys.'});return;}if(after>maxBalance){await c.rollback();res.status(400).json({error:`Balance cannot exceed ${maxBalance} Keys.`});return;}if(after===before){await c.rollback();res.status(409).json({error:'The requested balance is already set.'});return;}const delta=after-before,type=expectedType,id=randomUUID();
   await c.execute('UPDATE users SET key_balance=? WHERE id=?',[after,req.params.id]);await c.execute('INSERT INTO key_transactions(id,user_id,admin_id,operation,balance_before,amount_delta,balance_after,reason,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)',[id,req.params.id,res.locals.user.id,type,before,delta,after,reason,idempotencyKey]);await c.commit();res.status(201).json({duplicate:false,keyBalance:after,transaction:{id,operation:type,balanceBefore:before,amountDelta:delta,balanceAfter:after,reason}});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
 });
 router.post('/:id/reset-progress',async(req,res)=>{
  if(!uuid(req.params.id)||typeof req.body?.confirmation!=='string'){res.status(400).json({error:'Confirm the selected user.'});return;}const c=await pool.getConnection();try{await c.beginTransaction();const [users]=await c.execute<RowDataPacket[]>('SELECT email,key_balance FROM users WHERE id=? FOR UPDATE',[req.params.id]);if(!users[0]){await c.rollback();res.status(404).json({error:'User not found.'});return;}if(req.body.confirmation.trim().toLowerCase()!==String(users[0].email).toLowerCase()){await c.rollback();res.status(400).json({error:'Confirmation email does not match.'});return;}const [counts]=await c.execute<RowDataPacket[]>('SELECT COUNT(*) total FROM progress WHERE user_id=?',[req.params.id]);await c.execute('DELETE FROM progress WHERE user_id=?',[req.params.id]);await c.commit();res.json({ok:true,deletedProgressRows:Number(counts[0].total),keyBalance:Number(users[0].key_balance)});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
 });
 return router;
}
