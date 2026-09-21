export type {Media,Action,Scene,Heroine,Chapter,Story,CatalogItem} from './story-model.ts';
import type {Story,Heroine,CatalogItem} from './story-model.ts';
export let catalog:CatalogItem[]=[];
export let heroine:Heroine;
export let chapter:Story['chapter'];
export let scenes:Story['scenes'];
let versions:Story[]=[];
export function configureStories(items:CatalogItem[],stories:Story[],heroineId:string){
 catalog=items;versions=stories;heroine=items.find(h=>h.id===heroineId)!;
 const latest=stories.reduce((a,b)=>a.chapter.revision>b.chapter.revision?a:b);
 chapter=latest.chapter;scenes=latest.scenes;
}
export function getStory(revision?:number):Story|undefined{return versions.find(s=>s.chapter.revision===(revision??chapter?.revision));}
