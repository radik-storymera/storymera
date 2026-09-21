import {sceneTextHasContent} from './sceneText.ts';
export type Media = ({ type: 'image'; src: string; alt: string } | { type: 'video'; src: string; poster: string; alt: string }) & { caption?: string };
export type Action = { id: string; label: string; target: string; choice?: { key: string; value: string } };
export type Scene = { id: string; step: number; type?: 'story'|'poll'; final?: boolean; kind?: 'demo' | 'preview'; title: string; text: string; media?: Media; pollId?: number|null; pollPlacement?: 'after_scene'; variants?: { key: string; value: string; text: string }[]; actions: Action[] };
export type Heroine = { id: string; name: string; description: string; media: Media; archived?: boolean; edit_version?: number };
export type Chapter = { id: string; heroineId: string; revision: number; title: string; subtitle: string; description?: string; firstScene: string; freeSteps: number; displayOrder?: number; finalPollId?: number|null; keyCost?:number; guestFree?:boolean };
export type Story = { chapter: Chapter; scenes: Record<string, Scene> };
export type CatalogItem = Heroine & { chapters: {id:string;title:string;description:string;revision:number;keyCost?:number;guestFree?:boolean;unlocked?:boolean}[] };

export function validateStory(story: Story): string[] {
 const errors:string[]=[];const scenes=story?.scenes ?? {},start=story?.chapter?.firstScene;
 const validStart=!!start&&Object.hasOwn(scenes,start);
 if(!validStart)errors.push('Choose an existing starting scene.');
 const entries=Object.entries(scenes);
 if(!entries.length)errors.push('Add at least one scene.');
 if(entries.length>100)errors.push('A chapter can contain at most 100 scenes.');
 for(const [id,s] of entries){
  const label=`${s.title || 'Untitled'} (${id})`;
  if(s.id!==id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))errors.push(`${label}: invalid scene ID.`);
  if(!['story','poll'].includes(s.type??'story'))errors.push(`${label}: invalid scene type.`);
  if(!s.title?.trim() || ((s.type??'story')==='story'&&!sceneTextHasContent(s.text??'')))errors.push(`${label}: title and story text are required.`);
  if((s.type??'story')==='story'){
   if(!s.media?.src || !['image','video'].includes(s.media.type))errors.push(`${label}: media is required.`);
   if(s.media?.type==='video'&&!s.media.poster)errors.push(`${label}: a video poster is required.`);
   if(s.pollId!=null)errors.push(`${label}: a story scene cannot contain a poll. Add a separate poll scene.`);
  }else{
   if(!Number.isSafeInteger(s.pollId)||!s.pollId||s.pollId<1)errors.push(`${label}: choose an existing poll.`);
   if(s.media&&(!s.media.src||!['image','video'].includes(s.media.type)))errors.push(`${label}: choose a valid scene media file or remove it.`);
   if(s.media?.type==='video'&&!s.media.poster)errors.push(`${label}: a video poster is required.`);
  }
 }
 if(story.chapter.finalPollId!=null&&(!Number.isSafeInteger(story.chapter.finalPollId)||story.chapter.finalPollId<1))errors.push('Invalid final poll ID.');
 if(entries.length&&start!==entries.sort((a,b)=>a[1].step-b[1].step||a[0].localeCompare(b[0]))[0][0])errors.push('Set the first scene to the first scene in list order.');
 return [...new Set(errors)];
}
