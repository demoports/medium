import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timeline } from '../src/core/Timeline.js';
import { Comic } from '../src/effects/Comic.js';
import { Demo } from '../src/Demo.js';

const data = JSON.parse(readFileSync(new URL('../assets/timeline.json', import.meta.url)));
const native = JSON.parse(readFileSync(new URL('./fixtures/comic-row-profile.json', import.meta.url)));
const identity = [65536,0,0,0,65536,0,0,0,65536];

test('native uninitialized row profiles preserve heap bits and produce frozen identity rotation', () => {
  for (const sample of native) {
    assert.deepEqual(sample.afterConstructor, Array(3).fill(sample.inputBits));
    assert.deepEqual(sample.afterTwoResets, sample.afterConstructor);
    assert.deepEqual(sample.afterExplicitInit, Array(3).fill('40800000'));
    assert.deepEqual(sample.camera, native[0].camera);
    assert.deepEqual(sample.position, native[0].position);
    if (sample.name === 'zero' || sample.name === 'four') {
      assert.notDeepEqual(sample.afterTenUpdates, sample.afterConstructor);
      assert.notDeepEqual(sample.blob, identity);
    } else {
      assert.deepEqual(sample.afterTenUpdates, sample.afterConstructor);
      assert.deepEqual(sample.blob, identity);
      assert.equal(Math.abs(sample.angles[2] % 65536), 0);
      assert.equal(Math.abs(sample.angles[3] % 65536), 0);
    }
  }
});

test('recording profile changes only Comic row-driven blob transforms, including after backward seek', () => {
  const zero = new Timeline(data), frozen = new Timeline(data, {}, {comicRotationProfile:'frozen'});
  const a = new Comic(), b = new Comic();
  for (const time of [140.38,160.38,175.38,195.38,225.133,175.38]) {
    const stateA = zero.stateAt(time), stateB = frozen.stateAt(time);
    assert.deepEqual([stateB.effects.comic.rowX,stateB.effects.comic.rowY,stateB.effects.comic.rowZ], [0,0,0]);
    const control = structuredClone(stateA);
    control.effects.comic.rowX = control.effects.comic.rowY = control.effects.comic.rowZ = 0;
    assert.deepEqual(stateB, control, `Only rows differ at ${time}s`);
    a.update(time,stateA.effects.comic,stateA);
    b.update(time,stateB.effects.comic,stateB);
    assert.deepEqual(a.camera.matrixWorld.toArray(),b.camera.matrixWorld.toArray());
    assert.deepEqual(a.tubeMatrix.toArray(),b.tubeMatrix.toArray());
    if (stateA.effects.comic.mode >= 3) {
      const m = b.objectMatrix.elements;
      const fixed = [m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]].map(v=>Math.round(v*65536)|0);
      assert.deepEqual(fixed, native.find(s=>s.name==='quiet-nan').blob);
      assert.notDeepEqual(a.objectMatrix.toArray(),b.objectMatrix.toArray());
    } else assert.deepEqual(a.objectMatrix.toArray(),b.objectMatrix.toArray());
  }
  a.dispose();b.dispose();
});

test('Demo selects the recording profile and exposes the zero-start comparison', () => {
  const recording = new Demo(), canonical = new Demo({comicRotationProfile:'zero'});
  assert.equal(recording.comicRotationProfile,'frozen');
  assert.equal(canonical.comicRotationProfile,'zero');
  assert.equal(new Timeline(data).comicRotationProfile,'zero');
  assert.throws(()=>new Timeline(data,{}, {comicRotationProfile:'unknown'}),/Unknown Comic/);
  recording.effects.comic.dispose();canonical.effects.comic.dispose();
});
