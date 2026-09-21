import type {Scene,Story} from './story-model.ts';

/** Scene IDs remain stable; list order alone determines the reading path. */
export function linearScenes(story:Story):Scene[]{
 return Object.values(story.scenes).sort((a,b)=>a.step-b.step||a.id.localeCompare(b.id));
}
export function nextSceneId(story:Story,id:string):string|null{
 const scenes=linearScenes(story),index=scenes.findIndex(scene=>scene.id===id);
 return index>=0?scenes[index+1]?.id??null:null;
}
