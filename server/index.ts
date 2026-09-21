import { createApp } from './app.ts';
import { createPool } from './db.ts';
const pool=createPool();
const app=createApp(pool,process.env.APP_ORIGIN??process.env.PUBLIC_SITE_URL??'http://localhost:5173',process.env.NODE_ENV==='production');
const port=Number(process.env.API_PORT??3001),host=process.env.API_HOST??'127.0.0.1';
const server=app.listen(port,host,()=>console.log(`API listening on http://${host}:${port}`));
let shuttingDown=false;
function shutdown(signal:'SIGTERM'|'SIGINT'){
 if(shuttingDown)return;shuttingDown=true;
 console.log(`${signal} received. Stopping API.`);
 const timeout=setTimeout(()=>{console.error('Graceful shutdown timed out.');server.closeAllConnections();process.exit(1);},15_000);
 timeout.unref();
 server.close(async error=>{
  clearTimeout(timeout);
  try{await pool.end();}
  catch(poolError){console.error('MySQL pool shutdown failed.');process.exitCode=1;}
  if(error){console.error('HTTP server shutdown failed.');process.exitCode=1;}
  process.exit(process.exitCode??0);
 });
}
process.once('SIGTERM',()=>shutdown('SIGTERM'));
process.once('SIGINT',()=>shutdown('SIGINT'));
