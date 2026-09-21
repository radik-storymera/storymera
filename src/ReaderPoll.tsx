import {useEffect,useState,type RefObject} from 'react';
import {api,ApiError} from './api';

type Option={id:number;text:string;description:string;sortOrder:number};
type Poll={id:number;question:string;description:string;type:'opinion'|'canonical';status:string;allowSkip:boolean;showResults:boolean;allowVoteChange:boolean;canVote:boolean;selectedOptionId:number|null;canonicalOptionId:number|null;encounterStatus:'not_reached'|'available'|'voted'|'skipped';showRegistrationPrompt:boolean;options:Option[]};
type Results={total:number;options:{id:number;votes:number;percent:number}[];canonicalOptionId:number|null;resultsHidden?:boolean};

const choiceKey=(id:number)=>`jessica-stories:guest-poll:${id}:choice`;
const submitKey=(id:number)=>`jessica-stories:guest-poll:${id}:submit-after-auth`;
function pendingChoice(id:number,options:Option[]){const value=Number(sessionStorage.getItem(choiceKey(id)));return options.some(option=>option.id===value)?value:null;}

export function ReaderPoll({id,final=false,preview=false,sceneHeadingId,headingRef,authenticated,onContinue,onCreateProfile,continueLabel='Continue',disabled=false}:{id:number;final?:boolean;preview?:boolean;sceneHeadingId?:string;headingRef?:RefObject<HTMLHeadingElement|null>;authenticated:boolean;onContinue?:()=>void;onCreateProfile?:()=>void;continueLabel?:string;disabled?:boolean}){
 const [poll,setPoll]=useState<Poll|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<number|null>(null),[choice,setChoice]=useState<number|null>(null),[results,setResults]=useState<Results|null>(null),[skipped,setSkipped]=useState(false);
 useEffect(()=>{let live=true;setLoading(true);setPoll(null);setError('');setSkipped(false);setResults(null);
  void api(preview?'/admin/polls/'+id:'/polls/'+id).then(async(value:Poll)=>{
   if(!live)return;if(preview)value={...value,canVote:false,selectedOptionId:null,showResults:false,encounterStatus:'not_reached',showRegistrationPrompt:false};
   const pending=pendingChoice(id,value.options),submitAfterAuth=!preview&&authenticated&&sessionStorage.getItem(submitKey(id))==='1';
   setPoll(value);setSelected(value.selectedOptionId);setChoice(value.selectedOptionId??(submitAfterAuth?pending:!authenticated?pending:null));setSkipped(value.encounterStatus==='skipped');setLoading(false);
   if(preview)return;
   if(value.showRegistrationPrompt&&!authenticated)void api('/reading/event','POST',{type:'guest_registration_prompt_seen',pollId:id}).catch(()=>{});
   try{await api('/polls/'+id+'/view','POST',{});}catch{/* The question remains usable. */}
   if(!authenticated&&value.encounterStatus==='skipped'){onContinue?.();return;}
   if(authenticated&&value.selectedOptionId!==null&&value.showResults)try{const r=await api('/polls/'+id+'/results');if(live&&!r.resultsHidden)setResults(r);}catch{/* The saved vote remains visible. */}
   if(submitAfterAuth&&pending!==null&&value.canVote){
    sessionStorage.removeItem(submitKey(id));
    try{await api('/polls/'+id+'/vote','POST',{optionId:pending});if(!live)return;setSelected(pending);setChoice(pending);sessionStorage.removeItem(choiceKey(id));if(value.showResults){const r=await api('/polls/'+id+'/results');if(live&&!r.resultsHidden)setResults(r);}onContinue?.();}
    catch(e){if(live)setError(e instanceof Error?e.message:'Vote could not be saved.');}
   }
  }).catch(e=>{if(live){setError(e instanceof ApiError&&e.status===404?'':e instanceof Error?e.message:'Poll unavailable.');setLoading(false);}});
  return()=>{live=false;};
 },[id,preview,authenticated]);
 async function vote(){if(choice==null)return;setError('');try{await api('/polls/'+id+'/vote','POST',{optionId:choice});setSelected(choice);sessionStorage.removeItem(choiceKey(id));if(poll?.showResults){const response=await api('/polls/'+id+'/results');if(!response.resultsHidden)setResults(response);}}catch(e){setError(e instanceof Error?e.message:'Vote could not be saved.');}}
 async function skipGuest(){setError('');try{await api('/polls/'+id+'/skip','POST',{});setSkipped(true);sessionStorage.removeItem(choiceKey(id));sessionStorage.removeItem(submitKey(id));onContinue?.();}catch(e){setError(e instanceof Error?e.message:'Poll could not be skipped.');}}
 const scenePoll=!!sceneHeadingId,guestScene=scenePoll&&!authenticated&&!preview,containerClass=scenePoll?'reader-poll reader-poll--scene':'reader-poll';
 if(loading)return <div className={containerClass} role="status">Loading poll…</div>;
 if(!poll)return <div className={error?containerClass:'actions'}>{error&&<p role="status">{error}</p>}{onContinue&&<button className="primary" disabled={disabled} onClick={onContinue}>{continueLabel} →</button>}</div>;
 const canChange=authenticated&&poll.canVote&&(selected===null||poll.allowVoteChange),canSelect=guestScene?poll.canVote:canChange;
 const winner=poll.options.find(option=>option.id===poll.canonicalOptionId),mayContinue=selected!==null||skipped||!poll.canVote;
 return <section className={containerClass} aria-label={scenePoll?undefined:final?'Final vote':'Scene poll'} aria-labelledby={sceneHeadingId}>
  {guestScene&&<><h1 id={sceneHeadingId} tabIndex={-1} ref={headingRef}>{poll.question}</h1><p className="guest-poll-help">Выберите вариант, который кажется вам правильным.</p></>}
  {!scenePoll&&<><span className="eyebrow">{final?'Final vote':'Your opinion'}</span><h2>{poll.question}</h2>{poll.description&&<p>{poll.description}</p>}</>}
  {final&&<p>Your choice will help decide the direction of the next chapter.</p>}
  {winner&&poll.status==='implemented'&&<p className="poll-outcome">This choice became canon for the next chapter: <strong>{winner.text}</strong></p>}
  {winner&&['closed','archived'].includes(poll.status)&&<p className="poll-outcome">Readers chose this path: <strong>{winner.text}</strong></p>}
  {preview&&<p>Draft preview · Voting is disabled.</p>}
  <div className="poll-options" role={scenePoll?'radiogroup':undefined} aria-labelledby={sceneHeadingId}>{poll.options.map(option=>{const item=results?.options.find(result=>result.id===option.id);return <label key={option.id} className="poll-option"><input type="radio" name={'poll-'+id} checked={choice===option.id} disabled={!canSelect} onChange={()=>{setChoice(option.id);if(guestScene)sessionStorage.setItem(choiceKey(id),String(option.id));}}/><span><strong>{option.text}</strong>{option.description&&<small>{option.description}</small>}{selected===option.id&&<small>Your vote</small>}{authenticated&&selected!==null&&poll.showResults&&item&&<small>{item.percent.toFixed(1)}% · {item.votes} votes</small>}</span></label>;})}</div>
  {guestScene?<div className="guest-poll-cta"><strong>Хотите, чтобы ваш выбор был учтён?</strong><p>Создайте профиль и примите участие в голосовании.</p><button className="primary" disabled={choice==null||!poll.canVote||disabled} onClick={()=>{if(choice==null)return;sessionStorage.setItem(choiceKey(id),String(choice));sessionStorage.setItem(submitKey(id),'1');void api('/reading/event','POST',{type:'guest_create_profile_clicked',pollId:id}).catch(()=>{});onCreateProfile?.();}}>Создать профиль и отправить голос</button><button className="secondary" disabled={disabled} onClick={()=>void skipGuest()}>Пропустить вопрос</button></div>:<>
   {canChange&&<button className="secondary" disabled={choice==null||disabled} onClick={()=>void vote()}>{selected===null?'Vote':'Change vote'}</button>}
   {onContinue&&<div className="poll-continue">{poll.allowSkip&&selected===null&&!skipped&&poll.canVote&&<button className="text-button" disabled={disabled} onClick={()=>{setError('');void api('/polls/'+id+'/skip','POST',{}).then(()=>setSkipped(true)).catch(e=>setError(e instanceof Error?e.message:'Poll could not be skipped.'));}}>Skip</button>}<button className="primary" disabled={!mayContinue||disabled} onClick={onContinue}>{continueLabel} <span aria-hidden="true">→</span></button></div>}
  </>}
  {error&&<p role="alert" className="warning">{error}</p>}
 </section>;
}
