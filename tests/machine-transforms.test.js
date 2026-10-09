import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Makina, machineParts } from '../src/effects/Makina.js';

const samples=JSON.parse(readFileSync(new URL('./fixtures/native-machine-transforms.json',import.meta.url)));
const axes=[0,1,2,4,5,6,8,9,10];
const flags=[0x2002,0x2002,0x1001,0x3003];

function effect() {
 const makina=new Makina();
 makina.ready=true;makina.room={};
 makina.instances=machineParts.flatMap((parts,modelIndex)=>Array.from({length:3},(_,index)=>({
  instance:new THREE.Group(),index,modelIndex,parts:parts.map(sourceIndex=>({
   source:{flags:flags[sourceIndex]},sourceIndex,part:new THREE.Mesh()
  }))
 })));
 makina.animate=(part,source,phase)=>{part.morphFrame=Math.trunc(phase*65536)>>>0;};
 return makina;
}

for(const sample of samples) {
 test(`Makina native camera, object transforms and morph frames at ${sample.time}s`,()=>{
  const makina=effect();
  makina.update(sample.time,sample.state);
  const actual=makina.nativeCamera,expected=sample.native;
  const positions=actual.position.map(value=>Math.round(value*65536));
  assert.deepEqual(positions,expected.cameraPosition);
  axes.forEach((element,index)=>{
   // Native look-at normalizes quantized16.16 vectors. Float normalization
   // differs by fewer than three coefficient units; fixed Euler paths match.
   const difference=Math.abs(actual.rotation.elements[element]*65536-expected.cameraMatrix[index]);
   assert.ok(difference<3,`camera coefficient ${index}: ${difference}/65536`);
  });
  const meshes=[];
  for(const instance of makina.instances) if(instance.instance.visible) {
   for(const {part,sourceIndex} of instance.parts) if(part.visible) {
    const matrix=part.matrix.elements;
    meshes.push({mesh:[['makina','makina2'][instance.modelIndex],sourceIndex],
     position:[12,13,14].map(i=>Math.trunc(matrix[i]*65536)||0),
     matrix:axes.map(i=>Math.round(matrix[i]*65536)||0),frame:part.morphFrame||0});
   }
  }
  // D3D queues submissions by the material of each model.
  const batches=['makina','makina2'].flatMap(name=>expected.meshes.filter(mesh=>mesh.mesh[0]===name));
  assert.deepEqual(meshes,batches);
 });
}
