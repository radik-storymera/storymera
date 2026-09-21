import {useState,type RefObject} from 'react';
import type {Media,Story} from './story-model';
import type {Progress} from './progress';
import {SceneVideo} from './SceneVideo';
import {linearScenes,nextSceneId} from './linear';
import {ReaderPoll} from './ReaderPoll';
import {SceneText} from './SceneTextView';

export function StoryMedia({media}:{media:Media}){
 const [failed,setFailed]=useState(false);
 if(failed)return <div className="media-fallback" role="img" aria-label={media.alt}>Story media unavailable</div>;
 return <figure>{media.type==='image'?<img src={media.src} alt={media.alt} onLoad={event=>{const image=event.currentTarget;image.closest<HTMLElement>('.scene')?.style.setProperty('--media-ratio',String(image.naturalWidth/image.naturalHeight));}} onError={()=>setFailed(true)}/>:<SceneVideo src={media.src} poster={media.poster} alt={media.alt}/ >}{media.caption&&<figcaption>{media.caption}</figcaption>}</figure>;
}

export function StoryScene({story,progress,onAdvance,onFinish,onCreateProfile,status,headingRef,onBack,disabled=false,authenticated=false}:{story:Story;progress:Progress;onAdvance:(id:string)=>void;onFinish?:()=>void;onCreateProfile?:()=>void;status:string;headingRef?:RefObject<HTMLHeadingElement|null>;onBack?:()=>void;disabled?:boolean;authenticated?:boolean}){
 const {chapter,scenes}=story,scene=scenes[progress.sceneId];
 const sequence=linearScenes(story),position=sequence.findIndex(item=>item.id===progress.sceneId)+1,shownSteps=sequence.length;
 if(!scene)return <section className="admin-panel" role="alert"><h2>Scene unavailable</h2><p>This story path cannot be shown.</p></section>;
 const next=nextSceneId(story,scene.id),proceed=next?()=>onAdvance('next'):onFinish;
 if(scene.type==='poll'){
  const sceneHeadingId='scene-heading-'+scene.id;
  const showSceneCopy=authenticated||!!onBack;
  const content=<div className={scene.media?.src?'scene-copy poll-scene-content':'poll-scene-content'}><p className="eyebrow">{chapter.subtitle} · Scene {String(position).padStart(2,'0')} / {String(shownSteps).padStart(2,'0')}</p>{showSceneCopy&&<><h1 id={sceneHeadingId} tabIndex={-1} ref={headingRef}>{scene.title}</h1>{scene.text&&<SceneText text={scene.text}/>}</>}<ReaderPoll key={scene.id+'-'+scene.pollId} id={scene.pollId!} sceneHeadingId={sceneHeadingId} headingRef={showSceneCopy?undefined:headingRef} preview={!!onBack} authenticated={authenticated} onContinue={proceed??onBack} onCreateProfile={onCreateProfile} continueLabel={next?'Continue':onFinish?'Finish chapter':'Back to scenes'} disabled={disabled}/><p className="small-note">{status}</p></div>;
  return scene.media?.src?<article className={`scene poll-scene-with-media${scene.media.type==='video'?' scene-video':''}`} key={scene.id}><div className="scene-art"><StoryMedia key={scene.id+'-'+scene.media.src} media={scene.media}/></div>{content}</article>:<article className="poll-scene" key={scene.id}>{content}</article>;
 }
 if(!scene.media)return <section className="admin-panel" role="alert"><h2>Story media unavailable</h2><p>This scene needs its media restored.</p></section>;
 return <article className={`scene${scene.media.type==='video'?' scene-video':''}`} key={scene.id}><div className="scene-art"><StoryMedia key={scene.id+'-'+scene.media.src} media={scene.media}/></div><div className="scene-copy"><p className="eyebrow">{chapter.subtitle}</p><div className="scene-position">SCENE {String(position).padStart(2,'0')} / {String(shownSteps).padStart(2,'0')}</div><h1 tabIndex={-1} ref={headingRef}>{scene.title}</h1><SceneText text={scene.text}/><div className="actions">{next?<button className="primary" disabled={disabled} onClick={()=>onAdvance('next')}>Continue <span aria-hidden="true">→</span></button>:onFinish?<button className="primary" disabled={disabled} onClick={onFinish}>Finish chapter <span aria-hidden="true">→</span></button>:onBack?<button className="primary" onClick={onBack}>Back to scenes <span aria-hidden="true">→</span></button>:<a className="primary" href="#">Back to collection <span aria-hidden="true">→</span></a>}</div><p className="small-note">{status}</p></div></article>;
}
