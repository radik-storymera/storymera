import {api} from './api';

const storageKey='storymera:source-visit';
let confirming:Promise<string|null>|null=null;
function currentVisit(){try{const value=JSON.parse(localStorage.getItem(storageKey)??'null');return value&&typeof value.id==='string'&&Date.now()-Number(value.at)<30*60*1000?value.id:null;}catch{return null;}}
function saveVisit(id:string){try{localStorage.setItem(storageKey,JSON.stringify({id,at:Date.now()}));}catch{/* Tracking storage is optional. */}}
export function confirmSourceVisit(){
 if(confirming)return confirming;
 const query=new URLSearchParams(location.search);
 confirming=api('/tracking/confirm','POST',{visitId:currentVisit(),utmSource:query.get('utm_source'),utmMedium:query.get('utm_medium'),utmCampaign:query.get('utm_campaign'),utmContent:query.get('utm_content'),referrer:document.referrer,path:location.pathname}).then(result=>{if(typeof result.visitId==='string'){saveVisit(result.visitId);return result.visitId;}return null;}).catch(()=>null).finally(()=>{confirming=null;});
 return confirming;
}
export async function trackSourceEvent(type:'reading_started'|'scene_reached'|'chapter_completed',context:{heroineId?:string;chapterId?:string;sceneId?:string}){
 try{const visitId=currentVisit()??await confirmSourceVisit();if(!visitId)return;await api('/tracking/event','POST',{visitId,eventKey:crypto.randomUUID(),type,...context});saveVisit(visitId);}catch{/* Analytics never blocks reading. */}
}
