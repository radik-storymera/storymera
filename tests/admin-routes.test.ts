import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAdminRoute,paths} from '../src/adminRoutes.ts';

test('each administrative screen has a stable direct URL',()=>{
 const cases:[string,string][]=[
  [paths.stories,'stories'],[paths.storyNew,'story-new'],[paths.media,'media'],[paths.billingStats,'billing-stats'],[paths.users,'users'],[paths.userDetail('12345678-1234-4123-8123-123456789abc'),'user-detail'],[paths.polls,'polls'],[paths.pollNew,'poll-new'],[paths.pollEdit(12),'poll-edit'],[paths.pollStats(12),'poll-stats'],
  [paths.storyEdit('jessica'),'story-edit'],[paths.chapters('jessica'),'chapters'],
  [paths.chapterNew('jessica'),'chapter-new'],[paths.chapterEdit('jessica','first-day'),'chapter-edit'],
  [paths.scenes('jessica','first-day'),'scenes'],[paths.sceneEdit('jessica','first-day','cafe'),'scene-edit'],
 ];
 for(const [url,kind]of cases)assert.equal(parseAdminRoute(url).kind,kind,url);
 assert.equal(parseAdminRoute('/admin').kind,'stories');
 for(const url of ['/admin/stories/jessica/chapters/first-day/scenes/cafe','/admin/%GG','/admin/stories/jessica/unknown'])assert.equal(parseAdminRoute(url).kind,'invalid');
});
