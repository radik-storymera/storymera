import test from 'node:test';
import assert from 'node:assert/strict';
import {newStoryId} from '../src/sceneId.ts';
import {moveScene,orderedScenes} from '../src/adminStory.ts';
import {nextSceneId} from '../src/linear.ts';
import {validateStory,type Story} from '../src/story-model.ts';

const image={type:'image' as const,src:'/media/test.jpg',alt:'A test image'};
function story():Story{return {chapter:{id:'qa',heroineId:'qa',revision:1,title:'Test',subtitle:'',firstScene:'one',freeSteps:3},scenes:{
 one:{id:'one',step:1,title:'One',text:'First',media:image,actions:[{id:'pick-cafe',label:'Cafe',target:'two',choice:{key:'route',value:'cafe'}}]},
 two:{id:'two',step:2,title:'Two',text:'Second',media:image,actions:[{id:'next',label:'Continue',target:'three'}]},
 three:{id:'three',step:2,title:'Three',text:'Third',media:image,final:true,actions:[],variants:[{key:'route',value:'cafe',text:'Coffee was good.'}]},
 }};}

test('story IDs are unique for repeated names and stable after renaming',()=>{
 const existing:Record<string,unknown>={};const first=newStoryId('Jessica',existing,()=> 'aaaaaaaa-aaaa-aaaa-aaaa');existing[first]={name:'Jessica'};
 const second=newStoryId('Jessica',existing,()=> 'bbbbbbbb-bbbb-bbbb-bbbb');assert.notEqual(first,second);
 existing[first]={name:'Renamed'};assert.ok(Object.hasOwn(existing,first));
});

test('equal list order is stable and moving scenes leaves story links unchanged',()=>{
 const doc=story();assert.deepEqual(orderedScenes(doc).map(s=>s.id),['one','three','two']);
 const targets=Object.values(doc.scenes).flatMap(s=>s.actions.map(a=>a.target));
 assert.ok(moveScene(doc,'one',1));assert.deepEqual(orderedScenes(doc).map(s=>s.id),['three','one','two']);
 assert.deepEqual(Object.values(doc.scenes).flatMap(s=>s.actions.map(a=>a.target)),targets);
});

test('legacy choices and conditional paragraphs do not alter linear navigation',()=>{
 const doc=story();assert.equal(nextSceneId(doc,'one'),'three');
 doc.scenes.one.actions[0].target='two';doc.scenes.one.actions[0].label='Different route';
 assert.equal(nextSceneId(doc,'one'),'three');
 doc.scenes.one.actions=[];assert.deepEqual(validateStory(doc),[]);
});

test('missing starting scene omits derivative graph errors; one scene can end chapter',()=>{
 const doc=story();doc.chapter.firstScene='';const errors=validateStory(doc);
 assert.ok(errors.includes('Choose an existing starting scene.'));
 assert.ok(!errors.some(e=>e.includes('unreachable')||e.includes('final scene must')));
 const one=doc.scenes.one;one.final=true;one.actions=[];doc.scenes={one};doc.chapter.firstScene='one';assert.deepEqual(validateStory(doc),[]);
});
