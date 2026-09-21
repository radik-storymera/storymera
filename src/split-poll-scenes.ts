import type {Scene,Story} from './story-model.ts';
import {linearScenes} from './linear.ts';

/** Copy a chapter without changing its existing scene IDs, story text, or media. */
export function splitPollScenes(source:Story,historical?:Story):{story:Story;created:{after:string;sceneId:string;pollId:number}[]}{
 const story=structuredClone(source),ordered=linearScenes(story),result:Scene[]=[],created:{after:string;sceneId:string;pollId:number}[]=[];
 const ids=new Set(Object.keys(story.scenes));
 for(const scene of ordered){
  // An older editor could mark the original story scene as poll while leaving
  // its story media in place. Restore its narrative text from history and keep
  // that editor's shorter poll introduction on the new poll scene.
  if(scene.type==='poll'&&scene.media){
   const old=historical?.scenes[scene.id];
   if(!old||!old.media||!old.text.trim())throw Error(`Story scene ${scene.id} needs a historical source before splitting.`);
   const intro=scene.text;
   scene.type='story';scene.text=old.text;
   const attached=scene.pollId;
   if(!Number.isSafeInteger(attached)||!attached||attached<1)throw Error(`Invalid poll on ${scene.id}.`);
   scene.pollId=attached;
   // The poll intro is preserved below; the narrative media remains on story.
   const split=makePollScene(scene,intro);
   result.push(scene,split);created.push({after:scene.id,sceneId:split.id,pollId:attached});
   continue;
  }
  if(scene.type==='poll'){result.push(scene);continue;}
  const attached=scene.pollId;
  scene.type='story';
  result.push(scene);
  if(attached!=null){
   if(!Number.isSafeInteger(attached)||attached<1)throw Error(`Invalid poll on ${scene.id}.`);
   const split=makePollScene(scene,'');
   result.push(split);
   created.push({after:scene.id,sceneId:split.id,pollId:attached});
  }else{scene.pollId=null;delete scene.pollPlacement;}
 }
 if(result.length>100)throw Error('The chapter would exceed 100 scenes.');
 result.forEach((scene,index)=>{scene.step=index+1;scene.final=index===result.length-1;});
 story.scenes=Object.fromEntries(result.map(scene=>[scene.id,scene]));
 story.chapter.firstScene=result[0]?.id??'';story.chapter.freeSteps=result.length;
 return {story,created};

 function makePollScene(scene:Scene,intro:string):Scene{
  const base=`poll-after-${scene.id}`.slice(0,58);let id=base,suffix=2;
  while(ids.has(id))id=`${base}-${suffix++}`;
  ids.add(id);
  const pollId=scene.pollId!;
  scene.type='story';scene.pollId=null;delete scene.pollPlacement;
  return {id,type:'poll',step:scene.step,title:'A question for you',text:intro,pollId,actions:[],final:false};
 }
}
