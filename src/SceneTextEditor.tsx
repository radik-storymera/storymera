import {useEffect,useId,useRef,type ClipboardEvent} from 'react';
import {sanitizeSceneText,sceneTextToHtml,plainTextToHtml} from './sceneText';

type Command='formatBlock'|'bold'|'italic'|'insertUnorderedList'|'insertOrderedList'|'undo'|'redo'|'clear';

export function SceneTextEditor({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 const id=useId(),editor=useRef<HTMLDivElement>(null),lastEmitted=useRef(value);
 useEffect(()=>{
  if(!editor.current||value===lastEmitted.current)return;
  editor.current.innerHTML=sceneTextToHtml(value);
  lastEmitted.current=value;
 },[value]);
 useEffect(()=>{if(editor.current)editor.current.innerHTML=sceneTextToHtml(value);},[]);
 function sync(){
  const html=sanitizeSceneText(editor.current?.innerHTML??'');
  lastEmitted.current=html;
  onChange(html);
 }
 function run(command:Command){
  editor.current?.focus();
  if(command==='clear'){
   const selection=window.getSelection();
   if(selection&&!selection.isCollapsed&&editor.current?.contains(selection.anchorNode))document.execCommand('insertHTML',false,plainTextToHtml(selection.toString()));
   else document.execCommand('removeFormat');
  }else document.execCommand(command,false,command==='formatBlock'?'p':undefined);
  sync();
 }
 function paste(event:ClipboardEvent<HTMLDivElement>){
  event.preventDefault();
  const html=event.clipboardData.getData('text/html');
  const plain=event.clipboardData.getData('text/plain');
  document.execCommand('insertHTML',false,html?sceneTextToHtml(html):plainTextToHtml(plain));
  sync();
 }
 const button=(title:string,command:Command,label=title)=><button type="button" title={title} aria-label={title} onMouseDown={event=>event.preventDefault()} onClick={()=>run(command)}>{label}</button>;
 return <div className="scene-text-editor">
  <label htmlFor={id}>{label}</label>
  <div className="scene-text-toolbar" role="toolbar" aria-label={`${label} formatting`}>
   {button('Paragraph','formatBlock','P')}
   {button('Bold','bold','B')}
   {button('Italic','italic','I')}
   {button('Bulleted list','insertUnorderedList','• List')}
   {button('Numbered list','insertOrderedList','1. List')}
   {button('Undo','undo','↶')}
   {button('Redo','redo','↷')}
   {button('Clear formatting','clear','Clear')}
  </div>
  <div id={id} ref={editor} className="scene-text-input" contentEditable role="textbox" aria-label={label} aria-multiline="true" onInput={sync} onPaste={paste} onDrop={event=>event.preventDefault()} onBlur={()=>{if(editor.current)editor.current.innerHTML=sceneTextToHtml(lastEmitted.current);}}/>
 </div>;
}
