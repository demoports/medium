import * as THREE from 'three';
import { sin, mul, div } from './Math.js';

const ROOT = new URL('../../assets/textures/', import.meta.url);

/** Screen-space motion from medium.exe 0x40cc90–0x40d08a.
 * The native counter is incremented before Render, so age starts at one.
 * All three image styles use the original SRCALPHA + ONE blend mode.
 */
export function overlayFrame(overlay, tick, height = 480) {
 const age = tick - overlay.startTick + 1;
 if (age < 0 || age >= overlay.durationMs) return null;
 const progress = div(age, overlay.durationMs);
 if (overlay.kind === 'photo') {
  let alpha = Math.max(0, sin(age * 99));
  const half = Math.trunc(overlay.durationMs / 2);
  if (age > half) alpha = mul(alpha, 65536 - div(age - half, half));
  const x = overlay.offsetX ?? -64, y = overlay.offsetY ?? -48;
  return { age, alpha: Math.min(255, alpha >> 8) / 255,
   x: ((x << 16) - (x + 64) * progress) / 65536,
   y: ((y << 16) - (y + 48) * progress) / 65536,
   photo: true };
 }
 if (overlay.kind === 'logo') {
  return { age, alpha: 1, x: Math.trunc((32768 - progress) / 60 + 64), y: height - 512, photo: false };
 }
 const half = Math.trunc(overlay.durationMs / 2);
 const alpha = age < half ? 255 : 255 - (div(age - half, half) >> 8);
 return { age, alpha: Math.max(0, alpha) / 255, x: 0, y: height - 512, photo: false };
}

function quad(width, height, left = 0, top = 1, right = 1, bottom = 0) {
 const geometry = new THREE.BufferGeometry();
 geometry.setAttribute('position', new THREE.Float32BufferAttribute([
  0, 0, 0, width, 0, 0, width, height, 0, 0, height, 0
 ], 3));
 geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
  left, top, right, top, right, bottom, left, bottom
 ], 2));
 geometry.setIndex([0, 1, 2, 0, 2, 3]);
 return geometry;
}

export class Overlays {
 constructor() {
  this.scene = new THREE.Scene();
  this.camera = new THREE.OrthographicCamera(0, 640, 0, 480, 0, 2);
  this.camera.position.z = 1;
  this.material = new THREE.MeshBasicMaterial({
   transparent: true, depthTest: false, depthWrite: false,
   side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false
  });
  this.picture = new THREE.Mesh(quad(512, 512), this.material);
  this.picture.frustumCulled = false;
  this.scene.add(this.picture);
  this.patches = [];
  // The 768 × 576 artwork was uploaded as six 256² and three 256 × 64
  // textures in the original. UV subrectangles retain the same nine quads.
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
   const height = row === 2 ? 64 : 256;
   const mesh = new THREE.Mesh(quad(256, height, column / 3,
    1 - row * 256 / 576, (column + 1) / 3, 1 - (row * 256 + height) / 576), this.material);
   mesh.frustumCulled = false;
   mesh.userData.column = column;
   mesh.userData.row = row;
   this.patches.push(mesh);
   this.scene.add(mesh);
  }
 }
 async init(loader = new THREE.TextureLoader(), overlayTextures = []) {
  this.textures = await Promise.all(overlayTextures.map(async path => {
   const filename = path.toLowerCase().replaceAll('\\', '/').replace(/\.bmp$/, '.png');
   const texture = await loader.loadAsync(new URL(filename, ROOT).href);
   texture.colorSpace = THREE.NoColorSpace;
   texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
   texture.generateMipmaps = false;
   texture.minFilter = texture.magFilter = THREE.LinearFilter;
   return texture;
  }));
 }
 render(renderer, state) {
  const overlay = state.overlay;
  if (!overlay) return;
  const frame = overlayFrame(overlay, state.tick);
  if (!frame || frame.alpha <= 0) return;
  const texture = this.textures[overlay.index];
  if (!texture) return;
  if (this.material.map !== texture) {
   this.material.map = texture;
   this.material.needsUpdate = true;
  }
  this.material.opacity = frame.alpha;
  this.picture.visible = !frame.photo;
  this.picture.position.set(frame.x, frame.y, 0);
  for (const mesh of this.patches) {
   mesh.visible = frame.photo;
   mesh.position.set(frame.x + mesh.userData.column * 256, frame.y + mesh.userData.row * 256, 0);
  }
  renderer.render(this.scene, this.camera);
 }
 dispose() {
  this.picture.geometry.dispose();
  for (const mesh of this.patches) mesh.geometry.dispose();
  this.material.dispose();
  this.textures?.forEach(texture => texture.dispose());
 }
}
export default Overlays;
