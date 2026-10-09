import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {Tunnel} from '../src/effects/Tunnel.js';

const native=JSON.parse(readFileSync(new URL('fixtures/native-tunnel-camera.json',import.meta.url)));
test('Tunnel camera paths match original fixed-point camera matrices',()=>{
 const tunnel=new Tunnel();
 for(const sample of native){
  tunnel.updateCamera(sample.effect,sample.state);
  const camera=tunnel.camera,m=camera.matrixWorld.elements;
  const axes=[m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]];
  // Three's quaternion decomposition and normalization replace native 16-bit
  // matrix components; retain a tight bound on that subpixel difference.
  for(let i=0;i<9;i++)assert.ok(Math.abs(axes[i]-sample.axes[i])<.00005,`${sample.time}: basis ${i}`);
  for(let i=0;i<3;i++)assert.ok(Math.abs(camera.position.getComponent(i)-sample.position[i])<.00002,`${sample.time}: position ${i}`);
 }
});

test('reflected Tunnel camera keeps native screen handedness when rendered',()=>{
 const tunnel=new Tunnel();
 for(const sample of native.filter(s=>s.projections)){
  tunnel.updateCamera(sample.effect,sample.state);
  // The renderer refreshes the camera before each draw; this must retain its
  // negative scale instead of Three's default glTF scale-removal behavior.
  for(const refresh of [()=>tunnel.camera.updateMatrixWorld(),()=>tunnel.camera.updateWorldMatrix(true,false)]){
   refresh();
   for(const {point,screen} of sample.projections){
    const p=new Vector3(...point).project(tunnel.camera);
    assert.ok(Math.abs((p.x+1)*320-screen[0])<.04,`${sample.time}: screen X`);
    assert.ok(Math.abs((1-p.y)*240-screen[1])<.04,`${sample.time}: screen Y`);
   }
  }
 }
});
