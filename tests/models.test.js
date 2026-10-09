import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const expected = {
  makina: [[-1203,1203,-96,96,-1203,1203],[-1281,1281,-116,116,-1281,1281],[-846,846,-96,96,-846,846],[-1690,646,-2634,461,-645,1028]],
  makina2: [[-1654,1654,-132,132,-1654,1654],[-1762,1762,-159,159,-1762,1762],[-1163,1163,-132,132,-1163,1163],[-2324,889,-3622,634,-887,1414]]
};
const vertexCounts = [1280,848,1224,2382];
const triangleCounts = [2048,1136,1680,2516];
const meshFlags = [0x2002,0x2002,0x1001,0x3003];

for (const name of Object.keys(expected)) {
  const model = JSON.parse(await readFile(new URL(`../assets/models/${name}.json`,import.meta.url),'utf8'));
  test(`${name}: original topology, attributes and material batches`,async()=>{
    assert.equal(model.format,'medium-es-v1');
    assert.equal(model.meshes.length,4);
    assert.equal(model.textures.length,2);
    for (const texture of model.textures) {
      assert.equal(texture.width,256);assert.equal(texture.height,256);
      const bytes=await readFile(new URL(`../assets/textures/${texture.path}`,import.meta.url));
      assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    }
    for (const [index,mesh] of model.meshes.entries()) {
      assert.equal(mesh.flags,meshFlags[index]);
      assert.equal(mesh.positions.length,vertexCounts[index]*3);
      assert.equal(mesh.normals.length,mesh.positions.length);
      assert.equal(mesh.colors.length,mesh.positions.length);
      assert.equal(mesh.uvs.length,vertexCounts[index]*2);
      assert.equal(mesh.indices.length,triangleCounts[index]*3);
      for (const field of ['positions','normals','colors','uvs']) assert.ok(mesh[field].every(Number.isFinite),`${field} has nonfinite data`);
      assert.ok(mesh.positions.every(Number.isInteger),'lost original signed integer coordinates');
      assert.ok(mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<vertexCounts[index]),'out-of-range triangle index');
      const bounds=[];
      for(let axis=0;axis<3;axis++){
        const axisValues=mesh.positions.filter((_,i)=>i%3===axis);
        bounds.push(Math.min(...axisValues),Math.max(...axisValues));
      }
      assert.deepEqual(bounds,expected[name][index],'geometry axes, signs or units changed');
      assert.equal(mesh.groups.reduce((total,g)=>total+g.count,0),mesh.indices.length);
      let next=0;
      for (const group of mesh.groups) {
        assert.equal(group.start,next);assert.equal(group.count%3,0);next+=group.count;
        assert.ok(group.materialIndex>=0&&group.materialIndex<mesh.materials.length);
      }
      for (const material of mesh.materials) {
        assert.equal(material.flags,0x40030301);
        assert.equal(material.texture0,1);assert.equal(material.texture1,0);
      }
    }
  });
  test(`${name}: all 12 original animation keyframes survive`,()=>{
    for (const mesh of model.meshes.slice(0,3)) assert.equal(mesh.frames.length,0);
    const mesh=model.meshes[3];assert.equal(mesh.frames.length,12);
    const distinct=new Set();
    for (const frame of mesh.frames) {
      assert.equal(frame.positions.length,2382*3);assert.equal(frame.normals.length,2382*3);
      assert.ok(frame.positions.every(v=>Number.isInteger(v)&&v>=-32768&&v<=32767));
      assert.ok(frame.normals.every(Number.isFinite));
      distinct.add(JSON.stringify(frame.positions));
    }
    assert.equal(distinct.size,12,'animation frames were duplicated or dropped');
    assert.deepEqual(mesh.positions,mesh.frames[0].positions);
    assert.deepEqual(mesh.normals,mesh.frames[0].normals);
  });
}
