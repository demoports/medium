import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { Timeline } from '../src/core/Timeline.js';
import { Comic } from '../src/effects/Comic.js';
import { setProjection } from '../src/core/Math.js';
import { fogRetained } from '../src/core/Fog.js';

const data = JSON.parse(readFileSync(new URL('../assets/timeline.json', import.meta.url)));
const native = JSON.parse(readFileSync(new URL('fixtures/native-render-cache.json', import.meta.url)));

test('native mode cut uses the previous lens with current Comic geometry and camera', () => {
 const timeline = new Timeline(data), comic = new Comic();
 try {
  for (const sample of native.frames) {
   const state = timeline.frameAt((sample.tick + .001) / 1000);
   assert.equal(state.tick, sample.tick);
   assert.equal(state.effects.comic.mode, sample.effect.mode);
   assert.equal(state.projection.zoom, sample.liveZoom);
   assert.equal(state.renderCache.projection.zoom, sample.cache.zoom);
   assert.equal(state.renderCache.fogSlope, sample.cache.fogSlope);
   assert.equal(state.renderCache.fog.enabled, sample.cache.gpuFogEnabled);
   comic.update(state.time, { ...state.effects.comic, flag11d:true }, state);
   setProjection(comic.camera, state.renderCache.projection.zoom);
   comic.group.updateMatrixWorld(true);
   const geometry = comic.tube.geometry;
   const positions = geometry.userData.nativePositions;
   assert.equal(createHash('sha256').update(new Uint8Array(positions.buffer)).digest('hex'), sample.geometrySha256);
   for (const vertex of sample.projected) {
    const point = new Vector3().fromArray(geometry.attributes.position.array, vertex.index * 3).applyMatrix4(comic.tube.matrixWorld);
    const depth = -point.clone().applyMatrix4(comic.camera.matrixWorldInverse).z;
    const screen = point.project(comic.camera);
    const label = `${sample.tick}: vertex ${vertex.index}`;
    assert.ok(Math.abs((screen.x + 1) * 320 - vertex.screen[0]) < .5, `${label} X`);
    assert.ok(Math.abs((1 - screen.y) * 240 - vertex.screen[1]) < .5, `${label} Y`);
    assert.ok(Math.abs(depth - vertex.depth) < 1, `${label} depth`);
   }
   // The original allocator and clipper submit only Tube vertices even when
   // its base offset follows both 5046-vertex Blob surfaces.
   assert.ok(sample.indexRange[0] >= 10092);
   assert.ok(sample.indexRange[1] < sample.vertexCount);
   assert.ok(sample.indexCount > 0);
  }
  assert.deepEqual(native.frames.map(s=>[s.effect.mode,s.cache.zoom,s.liveZoom]), [[3,1,1],[0,1,.25],[0,.25,.25]]);
 } finally { comic.dispose(); }
});

test('native vertex fog combines live bounds with cached slope and independent GPU enable', () => {
 for (const sample of native.fogCases) {
  const live = { ...sample.live, slope:sample.cache.fogSlope };
  for (const vertex of sample.samples) {
   const label = `${sample.name}: depth ${vertex.depth}`;
   assert.equal(Math.round(fogRetained(live, vertex.depth) * 255), vertex.byte, `${label} vertex byte`);
   const gpuRetained = fogRetained({ ...live, gpuEnabled:sample.cache.gpuFogEnabled }, vertex.depth);
   assert.equal(Math.round(gpuRetained * 255), sample.cache.gpuFogEnabled ? vertex.byte : 255, `${label} GPU result`);
  }
  const packedColor = sample.before.color.reduce((word, byte)=>(word<<8)|byte,0);
  assert.equal(sample.cache.gpuFogColor, packedColor, 'GPU color is set before current Render');
 }
});

test('canonical frame cache is deterministic across direct, sequential and backward seeks', () => {
 const timeline = new Timeline(data);
 for (const time of [225.334,225.338,225.350,225.366,225.367,230,225.350,175.420,225.367]) {
  const sequential = structuredClone(timeline.frameAt(time));
  const direct = new Timeline(data).frameAt(time);
  assert.deepEqual(sequential, direct, `seek ${time}`);
  assert.equal(sequential.tick, sequential.renderCache.tick);
 }
 const last = timeline.frameAt(data.duration);
 assert.equal(last.tick, 361745);
 assert.equal(last.renderCache.tick, 361745);
 assert.equal(last.ended, true);
});

test('exact millisecond queries do not apply Render writes between canonical frames', () => {
 const timeline = new Timeline(data);
 const previous = structuredClone(timeline.stateAt(225.338));
 assert.equal(previous.effects.comic.mode, 3);
 assert.equal(previous.renderCache.tick, 225334);
 const command = structuredClone(timeline.stateAt(225.339));
 assert.equal(command.effects.comic.mode, 0);
 assert.equal(command.projection.zoom, 1, 'Render has not run for the new mode yet');
 assert.equal(command.renderCache.tick, 225334);
 const rendered = timeline.frameAt(225.350);
 assert.equal(rendered.projection.zoom, .25);
 assert.equal(rendered.renderCache.projection.zoom, 1);
});
