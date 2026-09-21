import {defineConfig,loadEnv} from 'vite';

export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');
 const publicUrl=(env.PUBLIC_SITE_URL||'http://localhost:5173').replace(/\/$/,'');
 return {
  define:{__PUBLIC_SITE_URL__:JSON.stringify(env.PUBLIC_SITE_URL??'')},
  plugins:[{name:'storymera-public-url',transformIndexHtml:html=>html.replaceAll('{{PUBLIC_SITE_URL}}',publicUrl)}],
  server:{host:'localhost',proxy:{'/api':'http://127.0.0.1:'+(process.env.JESSICA_API_PORT??'3001')},fs:{deny:['.env','.env.*','**/.local/**','**/.runtime/**','**/server/**','**/migrations/**']}},
 };
});
