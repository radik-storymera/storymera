import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {CatalogItem,Story} from './story-model';
import type {ReadingState} from './reading-model';

type User={id:string;email:string;role?:string;keyBalance?:number|null};
const legacyKey='jessica-stories:chapter:first-day';

export function useReader(items:CatalogItem[]){
 const [catalog,setCatalog]=useState(items);
 const [states,setStates]=useState<Record<string,ReadingState>>({});
 const [story,setStory]=useState<Story|null>(null),[heroId,setHeroId]=useState<string|null>(null);
 const [user,setUser]=useState<User|null>(null),[busy,setBusy]=useState(true),[initializing,setInitializing]=useState(true);
 const [status,setStatus]=useState('Checking reading progress…');
 const channel=useRef<BroadcastChannel|null>(null);
 const current=heroId?states[heroId]:undefined;
 function update(next:ReadingState){setStates(previous=>({...previous,[next.heroineId]:next}));}
 async function importLegacy(){
  try{
   const raw=localStorage.getItem(legacyKey);if(!raw||localStorage.getItem(legacyKey+':imported'))return;
   const progress=JSON.parse(raw);
   if(progress?.revision&&progress?.sceneId){
    const result=await api('/reading/import','POST',{chapterId:'first-day',progress});
    if(result.state)localStorage.setItem(legacyKey+':imported','1');
   }
  }catch{/* Keep the old device save intact if import cannot be confirmed. */}
 }
 async function sync(tryImport=false){
  await api('/reading/session','POST',{});
  const auth=await api('/auth/me');setUser(auth.user);
  if(tryImport&&!auth.user)await importLegacy();
  const [result,nextCatalog]:[{stories:Record<string,ReadingState>},CatalogItem[]]=await Promise.all([api('/reading/state'),api('/content/catalog')]);
  setCatalog(nextCatalog);
  setStates(result.stories);
  let hash='';try{hash=decodeURIComponent(location.hash.slice(1));}catch{/* Ignore malformed URLs. */}
  const requested=hash.startsWith('story/')?hash.slice(6):null;
  if(requested&&result.stories[requested]?.mode==='active'){
   const s:Story=await api('/reading/chapter/'+encodeURIComponent(result.stories[requested].chapterId!));
   setHeroId(requested);setStory(s);
  }else if(heroId&&result.stories[heroId]?.mode==='active'&&story){
   const s:Story=await api('/reading/chapter/'+encodeURIComponent(result.stories[heroId].chapterId!));setStory(s);
  }else setStory(null);
  setStatus(auth.user?'Your progress is saved to your account.':'Your progress is saved on this device and server.');
 }
 useEffect(()=>{let alive=true;void (async()=>{try{await sync(true);}catch{if(alive)setStatus('Reading server unavailable. Retry; saved progress has not been changed.');}finally{if(alive){setBusy(false);setInitializing(false);}}})();return()=>{alive=false;};},[]);
 useEffect(()=>{if(!('BroadcastChannel' in window))return;const c=new BroadcastChannel('jessica-auth');channel.current=c;
  c.onmessage=()=>{setBusy(true);setStory(null);void sync().catch(()=>setStatus('Account changed. Retry to restore your path.')).finally(()=>setBusy(false));};
  return()=>{c.close();channel.current=null;};},[]);
 async function run(fn:()=>Promise<void>,propagate=false){if(busy)return;setBusy(true);try{await fn();}catch(e){setStatus(e instanceof Error?e.message:'Reading request failed. Retry safely.');if(propagate)throw e;}finally{setBusy(false);}}
 async function open(id:string){await run(async()=>{
  if(!catalog.some(item=>item.id===id))throw Error('Story unavailable.');
  const next:ReadingState=await api('/reading/open','POST',{heroineId:id});update(next);
  if(next.mode!=='active')return;
  const s:Story=await api('/reading/chapter/'+encodeURIComponent(next.chapterId!));
  setHeroId(id);setStory(s);location.hash='story/'+encodeURIComponent(id);
  setStatus('Your place is saved on the server.');
 });}
 async function unlockAndOpen(heroineId:string,chapterId:string){await run(async()=>{
  const result:{keyBalance:number;state:ReadingState}=await api('/reading/unlock','POST',{heroineId,chapterId});update(result.state);setUser(previous=>previous?{...previous,keyBalance:result.keyBalance}:previous);
  const next:ReadingState=await api('/reading/open','POST',{heroineId});update(next);const s:Story=await api('/reading/chapter/'+encodeURIComponent(next.chapterId!));setHeroId(heroineId);setStory(s);location.hash='story/'+encodeURIComponent(heroineId);setStatus('Chapter unlocked. Your place is saved to your account.');
 });}
 async function advance(actionId:string){if(!current||current.mode!=='active')return;await run(async()=>{
  const next:ReadingState=await api('/reading/advance','POST',{chapterId:current.chapterId,actionId,version:current.version});update(next);
  setStatus('Your place is saved on the server.');
 });}
 async function finish(){if(!current||current.mode!=='active')return;setBusy(true);
  try{const result:{state:ReadingState}=await api('/reading/finish','POST',{chapterId:current.chapterId});update(result.state);setStory(null);location.hash='next/'+encodeURIComponent(current.heroineId);setStatus('Chapter completed and saved.');}
  catch{
   try{const result=await api('/reading/state');setStates(result.stories);
    if(result.stories[current.heroineId]?.mode==='awaiting'||result.stories[current.heroineId]?.mode==='complete'){setStory(null);location.hash='next/'+encodeURIComponent(current.heroineId);setStatus('Chapter completion was confirmed by the server.');}
    else setStatus('Completion was not confirmed. You can retry Finish chapter.');
   }catch{setStatus('Server unavailable. Completion is unconfirmed; retry safely.');}
  }finally{setBusy(false);}
 }
 async function authenticate(mode:'login'|'register',email:string,password:string){await run(async()=>{
  const result=await api(`/auth/${mode}`,'POST',{email,password});setUser(result.user);channel.current?.postMessage('auth-changed');
  if(mode==='login'){setStory(null);setHeroId(null);location.hash='';}await sync();
 },true);}
 async function logout(){await run(async()=>{await api('/auth/logout','POST',{});channel.current?.postMessage('auth-changed');setStory(null);setHeroId(null);location.hash='';await sync();});}
 async function retry(){await run(async()=>{await sync(true);});}
 async function event(type:string,context:Record<string,unknown>={}){const width=window.innerWidth,deviceType=width<600?'mobile':width<1024?'tablet':'desktop';try{await api('/reading/event','POST',{type,deviceType,source:'reader',...context});}catch{/* Product events never block reading. */}}
 function close(){setStory(null);setHeroId(null);location.hash='';}
 return {items:catalog,states,current,story,heroId,user,busy,status,initializing,open,unlockAndOpen,advance,finish,authenticate,logout,retry,event,close,conflict:null,choose:async()=>{}};
}
