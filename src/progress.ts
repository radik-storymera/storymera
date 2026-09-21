import { chapter, getStory } from './story.ts';
import type {Story} from './story-model.ts';
import {linearScenes,nextSceneId} from './linear.ts';
export type Progress={revision:number;sceneId:string;choices:Record<string,string>;decisions:string[]};
export const storageKey='jessica-stories:chapter:first-day';
const key=()=>`jessica-stories:chapter:${chapter.id}`;
export const initialProgress=(story:Story=getStory()!):Progress=>({revision:story.chapter.revision,sceneId:linearScenes(story)[0]?.id??story.chapter.firstScene,choices:{},decisions:[]});
export function advance(progress:Progress,actionId:string,story:Story=getStory(progress.revision)!):Progress{
 if(actionId!=='next')return progress;
 const next=nextSceneId(story,progress.sceneId);
 return next?{...progress,decisions:[...progress.decisions,'next'],sceneId:next}:progress;
}
export function decodeProgress(raw:string|null,provided?:Story):Progress|null{
 if(!raw)return null;
 try{const value=JSON.parse(raw);const story=provided??getStory(value?.revision);
 if(!story||value?.revision!==story.chapter.revision||typeof value.sceneId!=='string'||!value.choices||typeof value.choices!=='object'||Array.isArray(value.choices))return null;
 if(value.decisions!==undefined){
 if(!Array.isArray(value.decisions)||value.decisions.length>100)return null;
 let replay=initialProgress(story);
 for(const action of value.decisions){
  if(typeof action!=='string')return null;
  if(action==='next'){const next=nextSceneId(story,replay.sceneId);if(!next)return null;replay={...replay,decisions:[...replay.decisions,'next'],sceneId:next};continue;}
  // Existing published versions and saved paths retain their historical actions.
  const legacy=story.scenes[replay.sceneId]?.actions.find(a=>a.id===action);
  if(!legacy||!story.scenes[legacy.target])return null;
  replay={...replay,decisions:[...replay.decisions,action],sceneId:legacy.target,choices:legacy.choice?{...replay.choices,[legacy.choice.key]:legacy.choice.value}:replay.choices};
 }
 if(replay.sceneId!==value.sceneId||Object.keys(replay.choices).length!==Object.keys(value.choices).length||!Object.keys(replay.choices).every(k=>replay.choices[k]===value.choices[k]))return null;
 return replay;
 }
 const queue=[initialProgress(story)];let count=0;
 while(queue.length&&count++<10000){const item=queue.shift()!;const keys=Object.keys(item.choices);if(item.sceneId===value.sceneId&&keys.length===Object.keys(value.choices).length&&keys.every(k=>item.choices[k]===value.choices[k]))return item;if(item.decisions.length<100)for(const a of story.scenes[item.sceneId]?.actions??[])queue.push({...item,decisions:[...item.decisions,a.id],sceneId:a.target,choices:a.choice?{...item.choices,[a.choice.key]:a.choice.value}:item.choices});}
 }catch{}
 return null;
}
export interface StorageLike{getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export const loadProgress=(storage:StorageLike)=>decodeProgress(storage.getItem(key()));
export const saveProgress=(storage:StorageLike,progress:Progress)=>storage.setItem(key(),JSON.stringify(progress));
export const resetProgress=(storage:StorageLike)=>storage.removeItem(key());
