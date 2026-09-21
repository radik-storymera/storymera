export type AdminRoute =
 | {kind:'stories'} | {kind:'story-new'} | {kind:'story-edit';heroId:string}
 | {kind:'chapters';heroId:string} | {kind:'chapter-new';heroId:string}
 | {kind:'chapter-edit'|'scenes';heroId:string;chapterId:string}
 | {kind:'scene-edit';heroId:string;chapterId:string;sceneId:string}
 | {kind:'media'} | {kind:'billing-stats'} | {kind:'users'} | {kind:'user-detail';userId:string} | {kind:'polls'} | {kind:'poll-new'} | {kind:'poll-edit'|'poll-stats';pollId:number} | {kind:'invalid'};

export const paths={
 stories:'/admin/stories',media:'/admin/media',billingStats:'/admin/billing-statistics',users:'/admin/users',userDetail:(id:string)=>`/admin/users/${encodeURIComponent(id)}`,polls:'/admin/polls',pollNew:'/admin/polls/new',pollEdit:(id:number)=>`/admin/polls/${id}/edit`,pollStats:(id:number)=>`/admin/polls/${id}/stats`,storyNew:'/admin/stories/new',
 storyEdit:(h:string)=>`/admin/stories/${encodeURIComponent(h)}/edit`,
 chapters:(h:string)=>`/admin/stories/${encodeURIComponent(h)}/chapters`,
 chapterNew:(h:string)=>`${paths.chapters(h)}/new`,
 chapterEdit:(h:string,c:string)=>`${paths.chapters(h)}/${encodeURIComponent(c)}/edit`,
 scenes:(h:string,c:string)=>`${paths.chapters(h)}/${encodeURIComponent(c)}/scenes`,
 sceneEdit:(h:string,c:string,s:string)=>`${paths.scenes(h,c)}/${encodeURIComponent(s)}/edit`,
};
export function parseAdminRoute(pathname:string):AdminRoute {
 try {
  if(pathname==='/admin'||pathname===paths.stories)return {kind:'stories'};
  if(pathname===paths.media)return {kind:'media'};
  if(pathname===paths.billingStats)return {kind:'billing-stats'};
  if(pathname===paths.users)return {kind:'users'};
  if(pathname===paths.polls)return {kind:'polls'};
  if(pathname===paths.pollNew)return {kind:'poll-new'};
  if(pathname===paths.storyNew)return {kind:'story-new'};
  const parts=pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if(parts.length===3&&parts[0]==='admin'&&parts[1]==='users'&&/^[a-f0-9-]{36}$/i.test(parts[2]))return {kind:'user-detail',userId:parts[2]};
  if(parts.length===4&&parts[0]==='admin'&&parts[1]==='polls'&&/^\d+$/.test(parts[2])&&Number.isSafeInteger(Number(parts[2]))&&Number(parts[2])>0){if(parts[3]==='edit')return {kind:'poll-edit',pollId:Number(parts[2])};if(parts[3]==='stats')return {kind:'poll-stats',pollId:Number(parts[2])};}
  if(parts.length<4||parts[0]!=='admin'||parts[1]!=='stories'||!parts[2])return {kind:'invalid'};
  const heroId=parts[2];
  if(parts.length===4&&parts[3]==='edit')return {kind:'story-edit',heroId};
  if(parts[3]!=='chapters')return {kind:'invalid'};
  if(parts.length===4)return {kind:'chapters',heroId};
  if(parts.length===5&&parts[4]==='new')return {kind:'chapter-new',heroId};
  if(!parts[4])return {kind:'invalid'};
  const chapterId=parts[4];
  if(parts.length===6&&parts[5]==='edit')return {kind:'chapter-edit',heroId,chapterId};
  if(parts.length===6&&parts[5]==='scenes')return {kind:'scenes',heroId,chapterId};
  if(parts.length===8&&parts[5]==='scenes'&&parts[7]==='edit'&&parts[6])return {kind:'scene-edit',heroId,chapterId,sceneId:parts[6]};
 }catch {/* malformed encoding */}
 return {kind:'invalid'};
}
