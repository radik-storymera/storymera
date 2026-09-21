import test from 'node:test';
import assert from 'node:assert/strict';
import {newSceneId,selectedSceneId} from '../src/sceneId.ts';

test('switching scenes keeps the same draft, including unsaved changes',()=>{
 const scenes={arrival:{text:'Unsaved scene 1'},crossroads:{text:'Scene 2'},cafe:{text:'Scene 3'}};
 let selected='cafe';
 selected=selectedSceneId(scenes,selected,'crossroads');assert.equal(selected,'crossroads'); // 3 → 2
 selected=selectedSceneId(scenes,selected,'arrival');assert.equal(selected,'arrival');
 selected=selectedSceneId(scenes,selected,'crossroads');assert.equal(selected,'crossroads'); // 1 → 2
 selected=selectedSceneId(scenes,selected,'arrival');assert.equal(selected,'arrival');
 selected=selectedSceneId(scenes,selected,'crossroads');assert.equal(selected,'crossroads'); // 2 → 1 → 2
 assert.equal(selectedSceneId(scenes,selected,'crossroads'),'crossroads');
 assert.equal(scenes.arrival.text,'Unsaved scene 1');
 assert.equal(selectedSceneId(scenes,selected,'missing'),'crossroads');
});

test('scene IDs are unique, permanent and independent of title edits',()=>{
 const existing:Record<string,unknown>={};
 const first=newSceneId('Same title',existing,()=> 'aaaa-aaaa-aaaa-aaaa');existing[first]={title:'Same title'};
 const second=newSceneId('Same title',existing,()=> 'bbbb-bbbb-bbbb-bbbb');existing[second]={title:'Same title'};
 assert.notEqual(first,second);
 assert.match(first,/^[a-z0-9][a-z0-9-]{0,63}$/);
 assert.equal(newSceneId('Джессика',existing,()=> 'cccc-cccc-cccc-cccc'),'scene-cccccccccccc');
 existing[first]={title:'Renamed scene'};assert.equal(Object.keys(existing)[0],first);
});
