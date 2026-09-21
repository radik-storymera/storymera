import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api} from './api';
import {Admin} from './Admin';
import {AdminErrorBoundary} from './AdminErrorBoundary';
import {useReader} from './useReader';
import {Account} from './Account';
import {StoryMedia,StoryScene} from './StoryScene';
import {ReaderPoll} from './ReaderPoll';
import type {CatalogItem} from './story-model';
import type {ReadingState} from './reading-model';
import {HomePage,InfoPage,PageMeta,SiteFooter,type HomeData} from './PublicSite';
import {BillingPage} from './BillingPage';
import {BRAND_LOGO,SITE_NAME} from './siteConfig';
import './style.css';

function actionLabel(state?:ReadingState){
 if(!state)return 'Reading unavailable';
 if((state.mode==='unstarted'||state.mode==='awaiting')&&!state.chapterUnlocked&&state.chapterCost)return `Open for ${state.chapterCost} ${state.chapterCost===1?'Key':'Keys'}`;
 return {unstarted:'Start story',active:'Continue',awaiting:'Open next chapter',complete:'Continuation in preparation'}[state.mode];
}
function stateDescription(state?:ReadingState){
 if(!state)return 'Progress is temporarily unavailable.';
 return {unstarted:'Not started',active:'In progress',awaiting:'Previous chapter completed',complete:'All published chapters completed'}[state.mode];
}

function GuestCompletion({state,onRegister}:{state:ReadingState;onRegister:()=>void}){
 const preview=state.completionPreview;
 return <div className="guest-completion">{preview?.nextChapter?<article className="next-preview">{preview.nextChapter.media&&<div className="preview-art"><StoryMedia media={preview.nextChapter.media}/></div>}<div><span className="eyebrow">The story continues</span><h2>{preview.nextChapter.title}</h2><p>{preview.nextChapter.description}</p><p>Create a profile to keep your progress across devices and take part in reader votes. Later chapters may require Keys.</p><button className="primary" onClick={onRegister}>Create profile</button></div></article>:<p>Continuation in preparation.</p>}{preview?.stories.length?<section className="more-stories"><h2>More stories after registration</h2><div className="preview-grid">{preview.stories.map(story=><article key={story.id}>{story.media&&<div className="preview-art"><StoryMedia media={story.media}/></div>}<h3>{story.title}</h3><p>{story.description}</p><span>After registration</span></article>)}</div></section>:null}</div>;
}

function App({items,home}:{items:CatalogItem[];home:HomeData}){
 const reader=useReader(items);
 const [hash,setHash]=useState(location.hash),[pathname,setPathname]=useState(location.pathname),[confirmFinish,setConfirmFinish]=useState(false),[registerSignal,setRegisterSignal]=useState(0),[loginSignal,setLoginSignal]=useState(0);
 const heading=useRef<HTMLHeadingElement>(null),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const onHash=()=>setHash(location.hash);addEventListener('hashchange',onHash);return()=>removeEventListener('hashchange',onHash);},[]);
 useEffect(()=>{const onPop=()=>{setPathname(location.pathname);setHash(location.hash);};addEventListener('popstate',onPop);return()=>removeEventListener('popstate',onPop);},[]);
 function navigate(path:string,preserveHash=false){const nextHash=preserveHash?location.hash:'';history.pushState(null,'',path+nextHash);setPathname(path);setHash(nextHash);scrollTo({top:0,behavior:'instant'});}
 useEffect(()=>{if(hash.startsWith('#story/')&&reader.story){heading.current?.focus({preventScroll:true});scrollTo({top:0,behavior:'instant'});}},[hash,reader.current?.progress?.sceneId,reader.story]);
 useEffect(()=>{if(confirmFinish)dialog.current?.showModal();else dialog.current?.close();},[confirmFinish]);
 useEffect(()=>{if(!reader.initializing&&pathname==='/billing'&&!reader.user){history.replaceState(null,'','/');setPathname('/');}},[pathname,reader.user,reader.initializing]);
 useEffect(()=>{const id=hash.startsWith('#next/')?decodeURIComponent(hash.slice(6)):null,state=id?reader.states[id]:undefined;if(!reader.user&&state?.mode==='complete'&&state.completionPreview?.nextChapter)void reader.event('second_chapter_preview_seen',{heroineId:id,chapterId:state.completionPreview.nextChapter.id});},[hash,reader.user,reader.states]);
 const nextHero=hash.startsWith('#next/')?decodeURIComponent(hash.slice(6)):null;
 const nextState=nextHero?reader.states[nextHero]:undefined;
 const player=hash.startsWith('#story/')&&reader.story&&reader.current?.mode==='active';
 const showNext=nextHero&&nextState&&nextState.mode!=='active';
 const retry=reader.status.includes('unavailable')||reader.status.includes('unconfirmed')||reader.status.includes('Retry');
 const requestRegistration=()=>setRegisterSignal(value=>value+1);
 const requestLogin=()=>setLoginSignal(value=>value+1);
 const billing=(source:'locked_chapter'|'header_balance'|'profile'|'chapter_completed'|'other',heroineId?:string,chapterId?:string)=>{const query=new URLSearchParams({source,return:location.pathname+location.hash});if(heroineId)query.set('story',heroineId);if(chapterId)query.set('chapter',chapterId);history.pushState(null,'','/billing?'+query);setPathname('/billing');setHash('');scrollTo({top:0,behavior:'instant'});};
 const openState=(heroineId:string,state?:ReadingState)=>{if(!state)return;if((state.mode==='unstarted'||state.mode==='awaiting')&&!state.chapterUnlocked&&state.chapterId){if((reader.user?.keyBalance??0)<(state.chapterCost??0))billing(state.mode==='awaiting'?'chapter_completed':'locked_chapter',heroineId,state.chapterId);else void reader.unlockAndOpen(heroineId,state.chapterId);}else void reader.open(heroineId);};
 const infoKind=pathname==='/about'?'about':pathname==='/how-it-works'?'how-it-works':pathname==='/privacy'?'privacy':pathname==='/terms'?'terms':pathname==='/contact'&&home.contactEmail?'contact':null;
 const primary=reader.items.find(item=>item.chapters.some(chapter=>chapter.guestFree))??reader.items[0],primaryState=primary?reader.states[primary.id]:undefined,active=Object.values(reader.states).find(state=>state.mode==='active');
 const openFirst=()=>{navigate('/');if(primary&&primaryState?.mode!=='complete')openState(primary.id,primaryState);};
 const goPublic=(path:string)=>navigate(path);
 const billingParams=new URLSearchParams(location.search),billingReturn=billingParams.get('return')??'/';
 const safeReturn=billingReturn.startsWith('/')&&!billingReturn.startsWith('//')?billingReturn:'/';
 const leaveBilling=(target:string)=>{const hashAt=target.indexOf('#'),path=hashAt>=0?target.slice(0,hashAt):target,nextHash=hashAt>=0?target.slice(hashAt):'';history.pushState(null,'',path+nextHash);setPathname(path||'/');setHash(nextHash);scrollTo({top:0,behavior:'instant'});};
 return <><header className="site-header"><a className="brand" href="/" onClick={e=>{e.preventDefault();navigate('/');}} aria-label={`${SITE_NAME} — reader`}><img className="brand-logo" src={BRAND_LOGO} alt=""/>Storymera<span className="beta">STORIES TO STEP INTO</span></a><div className="account-controls">{reader.user?.role==='admin'&&<a href="/admin">Admin</a>}<Account reader={reader} registerSignal={registerSignal} loginSignal={loginSignal} onBilling={()=>billing('header_balance')}/></div></header>
 <main>{pathname==='/billing'&&reader.user?<BillingPage context={{source:billingParams.get('source')??'other',heroineId:billingParams.get('story')??undefined,chapterId:billingParams.get('chapter')??undefined,returnTo:safeReturn}} onReturn={leaveBilling}/>:infoKind?<InfoPage kind={infoKind} contactEmail={home.contactEmail} onHome={()=>navigate('/')}/>:pathname!=='/'?<section className="info-page"><PageMeta path="/"/><h1>Page not found</h1><p>This page is unavailable.</p><button className="text-button" onClick={()=>navigate('/')}>← Back to Stories</button></section>:<><div className="sync-status" role="status">{reader.status}{retry&&<button className="text-button" disabled={reader.busy} onClick={()=>void reader.retry()}>Retry</button>}</div>
 {reader.initializing?<p className="small-note">Loading your stories…</p>:player?<section className="reader"><div className="reader-toolbar"><button className="text-button" onClick={reader.close}>← Back to collection</button></div><StoryScene story={reader.story!} progress={reader.current!.progress!} onAdvance={id=>void reader.advance(id)} onFinish={()=>setConfirmFinish(true)} onCreateProfile={requestRegistration} status={reader.status} disabled={reader.busy} headingRef={heading} authenticated={!!reader.user}/></section>
 :showNext?<section className="reading-next"><h1>Chapter complete</h1>{nextState.finalPollId&&<ReaderPoll id={nextState.finalPollId} final authenticated={!!reader.user} onCreateProfile={requestRegistration}/ >}{!reader.user&&nextState.mode==='complete'?<GuestCompletion state={nextState} onRegister={requestRegistration}/>:nextState.mode==='awaiting'?<><p>Next chapter: <strong>{nextState.chapterTitle}</strong></p>{nextState.chapterUnlocked?<p>This chapter is ready to open.</p>:<p>Chapter price: <strong>{nextState.chapterCost} {nextState.chapterCost===1?'Key':'Keys'}</strong>. Your balance: <strong>{reader.user?.keyBalance??0} Keys</strong>.</p>}<button className="primary" disabled={reader.busy} onClick={()=>openState(nextHero!,nextState)}>{actionLabel(nextState)} <span aria-hidden="true">→</span></button></>:<p>Continuation in preparation. Return to Stories for now.</p>}<button className="text-button" onClick={reader.close}>Back to Stories</button></section>
 :<HomePage items={reader.items} states={reader.states} user={!!reader.user} busy={reader.busy} home={home} actionLabel={actionLabel} onOpen={openState} onRegister={requestRegistration} onLogin={requestLogin}/ >}
 </>}</main><SiteFooter authenticated={!!reader.user} hasActive={!!active} contactAvailable={!!home.contactEmail} onNavigate={goPublic} onLogin={requestLogin} onRegister={requestRegistration} onRead={openFirst} onContinue={()=>{if(active)openState(active.heroineId,active);}} onBilling={()=>billing('profile')}/>
 <dialog ref={dialog} onCancel={()=>setConfirmFinish(false)} onClose={()=>setConfirmFinish(false)}><h2>Finish this chapter?</h2><p>After confirmation, you cannot return to this reading path. Your completion will be saved on the server.</p><div className="actions"><button className="secondary" autoFocus onClick={()=>setConfirmFinish(false)}>Keep reading</button><button className="primary" disabled={reader.busy} onClick={()=>{setConfirmFinish(false);void reader.finish();}}>Finish chapter</button></div></dialog></>;
}
const root=createRoot(document.getElementById('root')!);
async function bootstrap(){
 if(location.pathname.startsWith('/admin')){root.render(<AdminErrorBoundary><Admin/></AdminErrorBoundary>);return;}
 try{const [items,home]:[CatalogItem[],HomeData]=await Promise.all([api('/content/catalog'),api('/content/home')]);if(!items.length&&location.pathname!=='/billing'){root.render(<main><h1>Storymera</h1><p>No published stories yet.</p><a href="/admin">Content studio</a></main>);return;}root.render(<App items={items} home={home}/>);}
 catch{root.render(<main><h1>Storymera</h1><p>Stories are temporarily unavailable. Saved progress has not been changed.</p><button onClick={()=>void bootstrap()}>Retry</button></main>);}
}
void bootstrap();
