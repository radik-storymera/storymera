export type StoryCounts={chapter_count:number;published_count:number;draft_count:number};

// The chapter list has one row per chapter; versions only affect the revision fields.
export function countsFromChapterRows(value:unknown):StoryCounts{
 if(!Array.isArray(value))throw Error('Chapter list is unavailable.');
 let published_count=0,draft_count=0;
 for(const row of value){
  if(!row||typeof row.id!=='string'||!row.id||
   !(row.published_revision===null||Number.isSafeInteger(row.published_revision))||
   !(row.draft_revision===null||Number.isSafeInteger(row.draft_revision))||
   ![true,false,0,1].includes(row.archived))throw Error('Chapter summary is incomplete.');
  if(row.published_revision!==null&&!row.archived)published_count++;
  if(row.draft_revision!==null)draft_count++;
 }
 return {chapter_count:value.length,published_count,draft_count};
}
