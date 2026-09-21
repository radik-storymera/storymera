import test from 'node:test';
import assert from 'node:assert/strict';
import {guestPrimaryCta} from '../src/public-site-cta.ts';

test('guest primary story CTA follows reading progress',()=>{
 assert.deepEqual(guestPrimaryCta('unstarted'),{kind:'reading',primary:'Start reading for free'});
 assert.deepEqual(guestPrimaryCta('active'),{kind:'reading',primary:'Continue reading'});
 assert.deepEqual(guestPrimaryCta('complete'),{kind:'completed',primary:'Create a profile to continue',secondary:'Already have an account? Sign in'});
});
