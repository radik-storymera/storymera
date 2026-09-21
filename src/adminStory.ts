import type {Story} from './story-model';

export const orderedScenes=(story:Story)=>Object.values(story.scenes).sort((a,b)=>a.step-b.step||a.id.localeCompare(b.id));

export function moveScene(story:Story,id:string,direction:-1|1):boolean{
 const list=orderedScenes(story),at=list.findIndex(s=>s.id===id),next=at+direction;
 if(at<0||next<0||next>=list.length)return false;
 [list[at],list[next]]=[list[next],list[at]];
 list.forEach((scene,index)=>{scene.step=index+1;});
 story.chapter.firstScene=list[0].id;
 story.chapter.freeSteps=list.length;
 return true;
}
