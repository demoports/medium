import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tunnelBarData,tunnelBarUV} from '../src/effects/Tunnel.js';

// tools/verify-tunnel-bars.py runs the original 0x40ecd0 Render. Digests cover
// every emitted position, packed vertex color and pair of texture coordinates.
const native=JSON.parse(readFileSync(new URL('fixtures/native-tunnel-bars.json',import.meta.url)));
test('bar geometry, RGBA and both UV pairs exactly match original x86 renders',()=>{
 const data=tunnelBarData();
 for(const sample of native){
  assert.equal(data.layers.length,sample.vertices);
  const packed=Buffer.alloc(sample.vertices*32);
  for(let i=0;i<sample.vertices;i++){
   const start=i*32,shade=Math.round(data.fade[i]*255),color=(shade*0x01010101)>>>0;
   for(let j=0;j<3;j++)packed.writeInt32LE(data.positions[i*3+j],start+j*4);
   packed.writeUInt32LE(color,start+12);
   const uv=tunnelBarUV(data.layers[i],data.corners[i],sample.tick,sample.amplitude,sample.inner90);
   for(let j=0;j<4;j++)packed.writeFloatLE(uv[j],start+16+j*4);
  }
  assert.equal(createHash('sha256').update(packed).digest('hex'),sample.sha256,`tick ${sample.tick}`);
 }
});
