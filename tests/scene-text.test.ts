import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeSceneText,sceneTextToHtml,sceneTextHasContent} from '../src/sceneText.ts';

test('Word formatting keeps paragraphs and emphasis without styles or active content',()=>{
 const word='<p class="MsoNormal" style="font:18pt Arial;color:red;background:yellow">First <b>day</b></p><p style="color:blue">Second<br>line <i>here</i></p><script>alert(1)</script>';
 const safe=sanitizeSceneText(word);
 assert.equal(safe,'<p>First <strong>day</strong></p><p>Second<br />line <em>here</em></p>');
 assert.equal(sceneTextToHtml(safe),safe);
 assert.ok(!/style|class|script|alert/.test(safe));
});

test('old plain text displays as paragraphs with preserved line breaks',()=>{
 assert.equal(sceneTextToHtml('First line\nsecond line\n\nNext paragraph'),'<p>First line<br>second line</p><p>Next paragraph</p>');
 assert.equal(sceneTextToHtml('Jessica <3 & friends'),'<p>Jessica &lt;3 &amp; friends</p>');
 assert.equal(sceneTextHasContent('<p><br></p>'),false);
 assert.equal(sceneTextHasContent('<p>Words</p>'),true);
});
