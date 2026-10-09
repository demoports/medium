import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {overlayFrame,Overlays} from '../src/core/Overlays.js';

const native=JSON.parse(readFileSync(new URL('fixtures/native-overlays.json',import.meta.url)));
test('overlay positions and alpha match original x86 Render samples',()=>{
 for(const sample of native){
  const overlay={index:sample.index,startTick:1,offsetX:-12,offsetY:-63,
   durationMs:sample.index>5?896:sample.index===5?16384:2048,
   kind:sample.index>5?'photo':sample.index===5?'logo':'credit'};
  const frame=overlayFrame(overlay,sample.age);
  assert.equal(frame.x,sample.x);assert.equal(frame.y,sample.y);
  assert.equal(Math.round(frame.alpha*255),sample.alpha);
 }
});
test('photos retain six 256² patches and three 256 × 64 patches',()=>{
 const overlays=new Overlays();assert.equal(overlays.patches.length,9);
 assert.equal(overlays.patches[0].geometry.attributes.position.getY(2),256);
 assert.equal(overlays.patches[8].geometry.attributes.position.getY(2),64);
 overlays.dispose();
});
