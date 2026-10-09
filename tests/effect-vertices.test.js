import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Tunnel, tunnelPatchVertex, tunnelLightColor } from '../src/effects/Tunnel.js';
import { machineMorph, machineParts, machineLightColors } from '../src/effects/Makina.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/native-effect-vertices.json', import.meta.url)));
const float = Math.fround;
const hash = data => createHash('sha256').update(data).digest('hex');

for (const sample of native.particles) {
 test(`Tunnel: native particle tick at phase ${sample.phase}`, () => {
  const tunnel = new Tunnel();
  tunnel.enabled.fill(0);
  for (let index = 0; index < 96; index++) {
   const z = index < 4 ? [-22529,-22528,22528,22529][index] : (index * 7523) % 45056 - 22528;
   tunnel.particles.set([(index * 16271 + sample.phase * 17) & 65535,
    (index * 375 + sample.phase) & 65535,z,0,0,0],index * 6);
  }
  tunnel.onTick({ effects: { tunnel: {phase:sample.phase,zVelocity:sample.velocity,visible:true,beats:[0,0]} } });
  const bytes = Buffer.alloc(96 * 25);
  for (let index = 0; index < 96; index++) {
   for (let axis = 0; axis < 3; axis++) {
    bytes.writeInt32LE(tunnel.particles[index * 6 + axis],index * 12 + axis * 4);
    bytes.writeInt32LE(tunnel.particles[index * 6 + axis + 3],96 * 12 + index * 12 + axis * 4);
   }
   bytes[96 * 24 + index] = tunnel.enabled[index];
  }
  assert.equal(hash(bytes),sample.sha256);
 });
}

for (const sample of native.patches) {
 test(`Tunnel: native patch XYZ/color/UV at radius ${sample.radius}`, () => {
  const bytes = Buffer.alloc(sample.vertices * 32);
  const scrollX = ((sample.phase * 5) & 65535) / 65536;
  const scrollY = ((sample.phase * 3) & 65535) / 65536 * -5;
  const gray = Math.round(tunnelLightColor({ pulseLighting: sample.lighting, beats: [0, sample.pulse] }) * 255);
  const rgba = (0xff000000 | gray << 16 | gray << 8 | gray) >>> 0;
  for (let patch = 0; patch < 96; patch++) {
   const angle = (patch * 16271 + sample.phase * 17) & 65535;
   const bend = (patch * 375 + sample.phase) & 65535;
   const z = (patch * 7523) % 45056 - 22528;
   for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = (patch * 64 + y * 8 + x) * 32;
    const point = tunnelPatchVertex(patch, x, y, angle, bend, z, sample.radius);
    point.forEach((value, axis) => bytes.writeInt32LE(value, offset + axis * 4));
    bytes.writeUInt32LE(rgba, offset + 12);
    [x / 8, y / 8, float(x / 8 + scrollX), float(y / 8 + scrollY)].forEach((v, i) => bytes.writeFloatLE(v, offset + 16 + i * 4));
   }
  }
  assert.equal(hash(bytes), sample.sha256);
 });
}

for (const sample of native.machines) {
 test(`Makina: native mesh ${sample.model}/${sample.part}, frame ${sample.phase}/65536`, () => {
  const document = JSON.parse(readFileSync(new URL(`../assets/models/${sample.model}.json`, import.meta.url)));
  const source = document.meshes[sample.part];
  const positions = source.positions.slice(), normals = source.normals.slice();
  machineMorph(source, sample.phase / 65536, positions, normals);
  const bytes = Buffer.alloc(sample.vertices * 44);
  // Oracle input: identity object, quarter-view basis, +Z light, fixed row64.
  const scroll = Math.sin(13.25 / 64 * 6.283185307) * .25;
  for (let vertex = 0; vertex < sample.vertices; vertex++) {
   const index = vertex * 3, offset = vertex * 44;
   const point = positions.slice(index, index + 3);
   const normal = normals.slice(index, index + 3).map(value => value * 64);
   [...point, ...normal].forEach((value, component) => bytes.writeInt32LE(value, offset + component * 4));
   const brightness = Math.max(0, normal[2] * 4);
   const channels = [255, 96, 17].map((diffuse, channel) => Math.min(255,
    Math.trunc((diffuse * brightness + [0, 9, 53][channel] * 256)
     * Math.round(source.colors[index + channel] * 255) / 65536)));
   bytes.writeUInt32LE((0xff000000 | channels[0] << 16 | channels[1] << 8 | channels[2]) >>> 0, offset + 24);
   const uv = [float(point[0] / 4096 + .5 + scroll), float(point[1] / 4096 + .5 + scroll),
    float(normal[0] * 2 * 16384 * float(8.477105097881577e-7) + .5),
    float(normal[1] * 2 * 16384 * float(8.477105097881577e-7) + .5)];
   uv.forEach((value, component) => bytes.writeFloatLE(value, offset + 28 + component * 4));
  }
  assert.equal(hash(bytes), sample.sha256);
 });
}

test('Makina preserves the released executable’s repeated inner mesh', () => {
 const nativeBatches = ['makina', 'makina2'].map(model => native.machineOrder
  .filter(entry => entry[0] === model).map(entry => entry[1]));
 assert.deepEqual(machineParts.map(parts => parts.filter(index => index !== 3)), nativeBatches);
});

test('Makina lighting quantizes pulse color before vertex lighting', () => {
 assert.deepEqual(machineLightColors(0), { diffuse: [255,64,0], ambient: [0,0,48] });
 assert.deepEqual(machineLightColors(32768), { diffuse: [255,191,127], ambient: [0,0,96] });
 assert.deepEqual(machineLightColors(65536), { diffuse: [255,255,255], ambient: [0,0,144] });
});
