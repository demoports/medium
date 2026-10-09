import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {Timeline} from '../src/core/Timeline.js';
import {Tunnel} from '../src/effects/Tunnel.js';
const data=JSON.parse(readFileSync(new URL('../assets/timeline.json',import.meta.url)));
const native=JSON.parse(readFileSync(new URL('fixtures/native-shared-camera.json',import.meta.url)));
function simulation(){
 const tunnel=new Tunnel();
 const timeline=new Timeline(data,{
  onReset:s=>tunnel.reset(s),
  onTick:s=>{if(s.layers.includes('tunnel'))tunnel.onTick(s);},
  onRenderTick:s=>{if(s.layers.includes('tunnel'))tunnel.onRenderTick(s);},
  onCommand:(e,c)=>{if(e.name==='tunnel')tunnel.onCommand(e,c);},
  onSelect:(name,ch,s)=>{if(name==='tunnel')tunnel.reset(s);}
 });
 return{tunnel,timeline};
}
function cameraAtTick(tunnel,state){
 const last=tunnel.cameraTickState;
 tunnel.updateCamera(last.effect,{...last.state,projection:state.renderCache.projection});
 return tunnel.camera;
}
function closePosition(camera,expected,label){
 // Tunnel's floating representation of the native 16.16 spring scale has
 // under .03 world-unit error here (well below one projected pixel).
 for(let i=0;i<3;i++)assert.ok(Math.abs(camera.position.getComponent(i)-expected[i]/65536)<.03,`${label}: component ${i}`);
}

test('Comic adds shake to the current Tunnel Tick camera, even without owning its view',()=>{
 const {tunnel,timeline}=simulation();
 for(const sample of native){
  const state=timeline.frameAt((sample.tick+.001)/1000);
  const camera=cameraAtTick(tunnel,state);
  closePosition(camera,sample.afterTick.position,`${sample.tick} Tick`);
  assert.deepEqual(state.inheritedCameraOffset,sample.shakeA.map((v,i)=>v+sample.shakeB[i]));
  camera.position.add(new Vector3(...state.inheritedCameraOffset).multiplyScalar(1/65536));
  closePosition(camera,sample.afterRender.position,`${sample.tick} Render`);
  assert.deepEqual(sample.callbacks.map(c=>c.effect),['comic','tunnel']);
  assert.deepEqual(sample.callbacks[0].camera,sample.afterTick);
  assert.deepEqual(sample.callbacks[1].camera,sample.afterRender);
  assert.ok(sample.renderCameraWrites.every(write=>write.stage==='comic'));
  // An original Render repeated without Tick adds shake again to the held
  // camera. Timeline records this history, so displaying a paused frame need
  // not mutate the camera repeatedly.
  timeline.renderFrame();
  const repeated=cameraAtTick(tunnel,state);
  repeated.position.add(new Vector3(...state.inheritedCameraOffset).multiplyScalar(1/65536));
  closePosition(repeated,sample.afterRenderWithoutTick.position,`${sample.tick} held Render`);
 }
});

test('photos hold Tick camera inputs while canonical renders accumulate shake',()=>{
 const {tunnel,timeline}=simulation();
 const photo=data.events.find(e=>e.command>=0xd6&&e.command<=0xed&&e.tick>90000);
 const before=timeline.stateAt((photo.tick-1+.001)/1000);
 const last=structuredClone(tunnel.cameraTickState),row=before.row;
 const frozen=timeline.frameAt((photo.tick+580)/1000);
 assert.equal(frozen.effectsFrozen,true);
 assert.notEqual(frozen.row,row,'The shared music clock continues during the photo');
 assert.deepEqual(tunnel.cameraTickState,last,'Native Tick camera remains frozen');
 assert.ok(frozen.inheritedCameraOffset.some(Boolean),'Comic renders still displace the held view');
 const once=structuredClone(frozen);
 timeline.frameAt((photo.tick+580)/1000);
 assert.deepEqual(timeline.state,once,'Repeated display of a frame does not accumulate shake');
 const after=timeline.frameAt((photo.tick+630)/1000);
 assert.equal(after.effectsFrozen,false);
 assert.notDeepEqual(tunnel.cameraTickState,last,'The next active Tick rebuilds the camera');
 assert.deepEqual(after.inheritedCameraOffset,after.cameraOffsetA.map((v,i)=>v+after.cameraOffsetB[i]));
});

test('inherited camera and frozen Tick snapshots reproduce direct and backward seeks',()=>{
 const sequential=simulation();
 for(const time of[20.5,91.9,140.350,160.35,91.9,140.350]){
  const actual=structuredClone(sequential.timeline.frameAt(time));
  const direct=simulation(),expected=direct.timeline.frameAt(time);
  assert.deepEqual(actual,expected,`state at ${time}`);
  assert.deepEqual(sequential.tunnel.cameraTickState,direct.tunnel.cameraTickState,`camera at ${time}`);
 }
});
