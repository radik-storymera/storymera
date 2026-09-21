import type {Progress} from './progress';
export type CompletionPreviewItem={id:string;title:string;description:string;media:import('./story-model').Media;keyCost?:number};
export type ReadingState={mode:'unstarted'|'active'|'awaiting'|'complete';heroineId:string;chapterId?:string;chapterTitle?:string;progress?:Progress;version?:number;lastCompletedChapterId?:string;finalPollId?:number|null;chapterCost?:number;chapterUnlocked?:boolean;guestFree?:boolean;completionPreview?:{nextChapter:CompletionPreviewItem|null;stories:CompletionPreviewItem[]}};
