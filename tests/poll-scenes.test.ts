import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPollScenes} from '../src/split-poll-scenes.ts';
import {linearScenes} from '../src/linear.ts';
import {validateStory,type Story} from '../src/story-model.ts';

const media={type:'image' as const,src:'/media/jessica-city.jpg',alt:'City'};
const chapter={id:'test',heroineId:'test',revision:1,title:'Test',subtitle:'',firstScene:'one',freeSteps:2};
const story=():Story=>({chapter:{...chapter},scenes:{
 one:{id:'one',step:1,title:'Opening',text:'Story text',media,actions:[],pollId:7},
 two:{id:'two',step:2,title:'Ending',text:'The end',media,actions:[],pollId:null},
}});

test('attached poll moves after the original scene without changing its ID or media',()=>{
 const input=story(),{story:output,created}=splitPollScenes(input);
 assert.equal(input.scenes.one.pollId,7);
 assert.deepEqual(created,[{after:'one',sceneId:'poll-after-one',pollId:7}]);
 assert.deepEqual(linearScenes(output).map(s=>s.id),['one','poll-after-one','two']);
 assert.equal(output.scenes.one.type,'story');assert.equal(output.scenes.one.pollId,null);
 assert.deepEqual(output.scenes.one.media,media);assert.equal(output.scenes.one.text,'Story text');
 assert.equal(output.scenes['poll-after-one'].type,'poll');assert.equal(output.scenes['poll-after-one'].pollId,7);
 assert.deepEqual(validateStory(output),[]);
});

test('mixed poll/media scene restores narrative and preserves the newer poll introduction',()=>{
 const historical=story(),current=story();current.scenes.one.type='poll';current.scenes.one.text='Your view matters.';
 const {story:output}=splitPollScenes(current,historical);
 assert.equal(output.scenes.one.text,'Story text');assert.equal(output.scenes.one.pollId,null);
 assert.equal(output.scenes['poll-after-one'].text,'Your view matters.');
 assert.deepEqual(output.scenes.one.media,media);
});

test('ordinary story cannot hold a poll and poll scene needs an ID',()=>{
 const input=story();input.scenes.one.type='story';assert.match(validateStory(input).join(' '),/cannot contain a poll/);
 input.scenes.one.type='poll';input.scenes.one.pollId=null;assert.match(validateStory(input).join(' '),/choose an existing poll/);
});
