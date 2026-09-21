import {sceneTextToHtml} from './sceneText';

export function SceneText({text}:{text:string}){
 return <div className="story-text" dangerouslySetInnerHTML={{__html:sceneTextToHtml(text)}}/>;
}
