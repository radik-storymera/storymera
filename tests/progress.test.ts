import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, decodeProgress, initialProgress, loadProgress, resetProgress, saveProgress, storageKey } from '../src/progress.ts';
import { scenes } from '../src/story.ts';
import {legacyFixture} from './legacy-fixture.ts';
import {getStory} from '../src/story.ts';
import {linearScenes} from '../src/linear.ts';
legacyFixture();

test('every scene plays in list order and reload restores the linear path',()=>{
    let state = initialProgress(),story=getStory()!;
    const expected=linearScenes(story).map(scene=>scene.id),visited=[state.sceneId];
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
    for(let i=1;i<expected.length;i++){state=advance(state,'next');visited.push(state.sceneId);saveProgress(storage,state);assert.deepEqual(loadProgress(storage),state);assert.deepEqual(state.choices,{});}
    assert.deepEqual(visited,expected);
    assert.deepEqual(advance(state,'next'),state);
    saveProgress(storage, state); assert.deepEqual(loadProgress(storage), state);
    storage.setItem('another-chapter', 'keep'); resetProgress(storage);
    assert.equal(storage.getItem(storageKey), null);
    assert.equal(storage.getItem('another-chapter'), 'keep');
});
for(const branch of ['cafe','walk'])test(`historical ${branch} save remains decodable without rerouting new readers`,()=>{
 const decisions=['begin',branch],sceneId=branch==='cafe'?'cafe':'river';
 const restored=decodeProgress(JSON.stringify({revision:1,sceneId,choices:{afternoon:branch},decisions}));
 assert.equal(restored?.sceneId,sceneId);assert.equal(restored?.choices.afternoon,branch);
 assert.equal(advance(restored!,'next').sceneId,branch==='cafe'?'river':'square');
});
test('corrupt, stale and impossible saves are rejected', () => {
  for (const raw of [null, '{oops', 'null', '{}', JSON.stringify({ revision: 0, sceneId: 'arrival', choices: {} }), JSON.stringify({ revision: 1, sceneId: 'missing', choices: {} }), JSON.stringify({ revision: 1, sceneId: 'square', choices: {} }), JSON.stringify({ revision: 1, sceneId: 'cafe', choices: { afternoon: 'walk' } }), JSON.stringify({ revision: 1, sceneId: 'arrival', choices: [] })]) assert.equal(decodeProgress(raw), null);
});
test('all graph targets and permanent identifiers are valid', () => {
  for (const [id, scene] of Object.entries(scenes)) {
    assert.equal(id, scene.id);
    assert.equal(new Set(scene.actions.map(a => a.id)).size, scene.actions.length);
    for (const action of scene.actions) assert.ok(scenes[action.target]);
  }
  const state = initialProgress(); assert.deepEqual(advance(state, 'invalid'), state);
});
