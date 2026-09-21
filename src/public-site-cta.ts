import type {ReadingState} from './reading-model';

export function guestPrimaryCta(mode:ReadingState['mode']|undefined){
 if(mode==='complete')return {kind:'completed' as const,primary:'Create a profile to continue',secondary:'Already have an account? Sign in'};
 if(mode==='active')return {kind:'reading' as const,primary:'Continue reading'};
 return {kind:'reading' as const,primary:'Start reading for free'};
}
