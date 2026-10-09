import * as THREE from 'three';
import { setProjection, CAMERA_NEAR, CAMERA_FAR, NativeCamera } from '../core/Math.js';
import { fogUniforms, updateFog, fogVertex, fogFragment } from '../core/Fog.js';
import { loadNativeMipTexture } from '../core/Texture.js';

// Medium's machine scene: 0x40d4e0–0x40ea91. Geometry and twelve morph
// frames are decoded from the original ES streams by tools/extract.py.
const TAU = Math.PI * 2;
// Original quarter-wave recurrence, 0x41baa0; verified against executing x86.
const sineTable = new Int32Array(4097);
let sineAccumulator = 0, cosineAccumulator = 0x80000000;
for (let i = 1; i < 4096; i++) {
  sineAccumulator += Math.floor(cosineAccumulator * 0x1921fc / 0x100000000);
  sineTable[i] = Math.floor(sineAccumulator / 32768);
  cosineAccumulator -= Math.floor(sineAccumulator * 0x1921fc / 0x100000000);
}
sineTable[4096] = 65536;
function fixedSin(angle) {
  let index = (Math.trunc(angle) >> 2) & 16383;
  const sign = index >= 8192 ? -1 : 1;
  index &= 8191;
  return sign * sineTable[index <= 4096 ? index : 8192 - index];
}
const sin = a => fixedSin(a) / 65536;
const cos = a => fixedSin(Math.trunc(a) + 16384) / 65536;
const multiplyFixed = (a,b) => Math.floor(a*b/65536);
const asset = path => new URL(`../../assets/${path}`, import.meta.url).href;
const basis = new THREE.Matrix4();
const cameraFlip = new THREE.Matrix4().makeRotationY(Math.PI);

// Material batching keeps model A before B. The repeated A1 is intentional:
// the released Render fetches A again at 0x40e8d7, omitting B0 in split mode.
export const machineParts = [[2, 1, 0, 1, 3], [2, 1, 3]];

// 0x4196f3–0x41980e: interpolation uses a 16.16 frame index, then
// arithmetic shifts back to integer positions and signed normal bytes.
export function machineMorph(source, phase, positions, normals) {
  if (!source.frames.length) return;
  const tick = Math.trunc(phase * 65536) >>> 0;
  const frame = (tick >>> 16) % source.frames.length;
  const fraction = tick & 65535, inverse = 65536 - fraction;
  const a = source.frames[frame], b = source.frames[(frame + 1) % source.frames.length];
  for (let i = 0; i < a.positions.length; i++) {
    positions[i] = Math.floor((a.positions[i] * inverse + b.positions[i] * fraction) / 65536);
    normals[i] = Math.floor((a.normals[i] * 64 * inverse + b.normals[i] * 64 * fraction) / 65536) / 64;
  }
}

export function machineLightColors(beat) {
  const pulse = Math.floor(beat * 255 / 65536);
  return { diffuse: [255, Math.min(255, 64 + pulse), Math.min(255, pulse)],
    ambient: [0, 0, Math.min(255, 48 + Math.floor(beat * 96 / 65536))] };
}

// Direct translation of sMatrix::InitEuler, VA 0x41c840. Angles are turns/65536.
function rotation(a, b, c, target = new THREE.Matrix4()) {
  const ca = fixedSin(Math.trunc(a)+16384), cb = fixedSin(Math.trunc(b)+16384), cc = fixedSin(Math.trunc(c)+16384);
  const sa = fixedSin(a), sb = fixedSin(b), sc = fixedSin(c), mul = multiplyFixed;
  return target.set(
    (mul(ca,cc)-mul(mul(sa,sb),sc))/65536, (mul(ca,sc)+mul(mul(sa,sb),cc))/65536, -mul(sa,cb)/65536, 0,
    -mul(cb,sc)/65536, mul(cb,cc)/65536, sb/65536, 0,
    (mul(sa,cc)+mul(mul(ca,sb),sc))/65536, (mul(sa,sc)-mul(mul(ca,sb),cc))/65536, mul(ca,cb)/65536, 0,
    0,0,0,1
  );
}

// 0x411120 uses floating trigonometry for this fixed camera, then converts
// the float32 matrix to 16.16. It does not use the integer sine table.
function fixedSceneCamera() {
  const f=Math.fround, sa=f(Math.sin(-.047)), ca=f(Math.cos(-.047));
  const sb=f(Math.sin(.491)), cb=f(Math.cos(.491));
  const q=value=>Math.trunc(f(value)*65536)/65536;
  return new THREE.Matrix4().set(q(ca),q(sa*sb),q(-sa*cb),0,
    0,q(cb),q(sb),0,q(sa),q(-ca*sb),q(ca*cb),0,0,0,0,1);
}

function orient(object, angles, position) {
  rotation(...angles, object.matrix);
  object.matrix.setPosition(...position);
  object.matrixWorldNeedsUpdate = true;
}

function geometry(source) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(source.normals, 3));
  result.setAttribute('color', new THREE.Float32BufferAttribute(source.colors, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(source.uvs, 2));
  result.setIndex(source.indices);
  for (const group of source.groups) result.addGroup(group.start, group.count, group.materialIndex);
  return result;
}

function machineMaterial(base, highlight) {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseMap: { value: base }, highlightMap: { value: highlight },
      scroll: { value: 0 }, lightDirection: { value: new THREE.Vector3(0, 0, 1) },
      diffuse: { value: new THREE.Color(255, 64, 0) },
      ambient: { value: new THREE.Color(0, 0, 48) },
      ...fogUniforms()
    },
    vertexShader: `
      ${fogVertex}
      uniform float scroll;
      uniform vec3 lightDirection, diffuse, ambient;
      attribute vec3 color;
      varying vec2 baseUV, highlightUV;
      varying vec3 litColor;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        vec3 worldNormal = mat3(modelMatrix) * normal;
        vec3 viewNormal = mat3(viewMatrix) * worldNormal;
        baseUV = position.xy / 4096.0 + vec2(0.5 + scroll);
        // The native renderer emits its second UV pair from transformed normals.
        // NativeCamera preserves the original quarter-scale view basis.
        highlightUV = vec2(0.5) + vec2(-viewNormal.x, viewNormal.y) * 7.1111112;
        float light = floor(max(0.0, dot(worldNormal, lightDirection)) * 256.0);
        vec3 rgb = floor((ambient * 256.0 + diffuse * light) * (color * 255.0) / 65536.0);
        litColor = clamp(rgb, 0.0, 255.0) / 255.0;
        fogRetained = nativeFog(-p.z);
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: `
      ${fogFragment}
      uniform sampler2D baseMap, highlightMap;
      varying vec2 baseUV, highlightUV;
      varying vec3 litColor;
      void main() {
        vec4 base = texture2D(baseMap, baseUV);
        if (base.a <= 4.0 / 255.0) discard;
        vec3 rgb = base.rgb * litColor + texture2D(highlightMap, highlightUV).rgb;
        gl_FragColor = vec4(mix(fogColor, clamp(rgb, 0.0, 1.0), fogRetained), base.a);
      }`,
    // Native D3DCULL_CCW with its mirrored projection preserves this winding.
    transparent: true, depthWrite: true, side: THREE.BackSide,
    toneMapped: false
  });
}

export class Makina {
  constructor() {
    this.group = new THREE.Group();
    this.camera = new NativeCamera(53.130102, 4 / 3, CAMERA_NEAR, CAMERA_FAR);
    this.instances = [];
    this.materials = [];
    this.textures = [];
    this.ready = false;
  }

  async init(textureLoader = new THREE.TextureLoader()) {
    const documents = await Promise.all(['makina', 'makina2'].map(async name => {
      const response = await fetch(asset(`models/${name}.json`));
      if (!response.ok) throw new Error(`Cannot load ${name}: ${response.status}`);
      return response.json();
    }));
    for (const [modelIndex, doc] of documents.entries()) {
      const maps = await Promise.all(doc.textures.map(entry => textureLoader.loadAsync(asset(`textures/${entry.path}`))));
      for (const map of maps) {
        map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
        map.minFilter = map.magFilter = THREE.LinearFilter;
        map.generateMipmaps = false;
        map.colorSpace = THREE.NoColorSpace;
        map.flipY = false;
        this.textures.push(map);
      }
      const material = machineMaterial(maps[1], maps[0]);
      this.materials.push(material);
      for (let instanceIndex = 0; instanceIndex < 3; instanceIndex++) {
        const instance = new THREE.Group();
        const parts = machineParts[modelIndex].map((sourceIndex, partIndex) => {
          const source = doc.meshes[sourceIndex];
          const part = new THREE.Mesh(geometry(source), material);
          part.matrixAutoUpdate = false;
          part.frustumCulled = false;
          part.renderOrder = modelIndex * 100 + instanceIndex * 10 + partIndex;
          instance.add(part);
          return { part, source };
        });
        this.group.add(instance);
        this.instances.push({ instance, parts, index: instanceIndex });
      }
    }
    const roomMap = await loadNativeMipTexture(asset('textures/medium_makina/roomcube_01.mips.bin'));
    roomMap.colorSpace = THREE.NoColorSpace;
    roomMap.minFilter = THREE.LinearMipmapNearestFilter;
    roomMap.flipY = false;
    this.textures.push(roomMap);
    this.room = this.createRoom(roomMap);
    this.group.add(this.room);
    this.ready = true;
    return this;
  }

  createRoom(map) {
    // 0x40d260: eight corner objects, each comprising exactly three 1536-unit quads.
    const room = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const turns = [[16384,16384,0],[32768,16384,0],[16384,49152,0],[16384,32768,0],
      [49152,0,0],[32768,0,0],[49152,32768,0],[0,32768,0]];
    for (let corner = 0; corner < 8; corner++) {
      const positions = [], uvs = [], indices = [];
      for (let i = 0; i < 12; i++) {
        const u = ((i + 1) >> 1) & 1, v = (i >> 1) & 1;
        positions.push(...(i < 4 ? [u * 1536, v * 1536, 0] : i < 8 ? [u * 1536, 0, v * 1536] : [0, u * 1536, v * 1536]));
        uvs.push(u, v);
      }
      for (let i = 0; i < 12; i += 4) indices.push(i, i+1, i+2, i, i+2, i+3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = 1000; // additive materials flush after the machines
      mesh.matrixAutoUpdate = false;
      orient(mesh, turns[corner], [(((corner + 1) & 2) * 2048) - 2048,
        ((corner & 2) * 1536) - 1536, (((corner >> 1) & 2) * 2048) - 2048]);
      room.add(mesh);
    }
    return room;
  }

  setCamera(position, nativeRotation, zoom = .75) {
    setProjection(this.camera, zoom);
    basis.copy(nativeRotation).multiply(cameraFlip);
    this.camera.quaternion.setFromRotationMatrix(basis);
    this.camera.position.set(...position);
    this.camera.updateMatrixWorld();
  }

  animate(part, source, phase) {
    if (!source.frames.length) return;
    const {position, normal} = part.geometry.attributes;
    machineMorph(source, phase, position.array, normal.array);
    position.needsUpdate = normal.needsUpdate = true;
  }

  update(time, state = {}, beat = {}) {
    if (!this.ready) return;
    const m = state.effects?.makina || state.makina || state;
    this.useOwnCamera = m.autoCamera !== false;
    const row32 = state.row32 ?? beat.row32 ?? 0;
    const row64 = state.row64 ?? beat.row64 ?? 0;
    const row128 = state.row128 ?? beat.row128 ?? 0;
    const phase = m.phase ?? 0;
    const angles = m.angles || [4,4,4];
    const a = m.flagAB ? angles[1] * 1024 : phase * 7;
    const b = m.flagAB ? angles[2] * 512 : phase * 3;
    const c = m.flagAB ? angles[0] * 2048 : phase * 5;
    const mode = m.mode || 0;
    const transforms = [];
    let zoom = .75, position = [0,0,-1792], cameraRotation = new THREE.Matrix4();
    let split = true;
    let direction = new THREE.Vector3(0,0,1);
    const envelope = { z: state.envelopeC ?? 0, animationA: state.envelopeA ?? 0, animationB: state.envelopeB ?? 0 };
    const offsetA = state.cameraOffsetA || [0,0,0];
    const offsetB = state.cameraOffsetB || [0,0,0];
    const lighting = machineLightColors(m.beats?.[1] || 0);
    if (mode === 0) {
      transforms.push({ position:[0,0,m.flagAA ? (envelope.z ?? 0) * 3072 : 0], primary:[a,c,0], secondary:[a,b,phase*3] });
    } else if (mode === 1) {
      transforms.push({ position:[-256,-192,0], primary:[a,b,c], secondary:[a,0,0] });
    } else if (mode === 2) {
      split = false;
      // Original fixed camera Euler values are -0.047 and 0.491 radians.
      cameraRotation = fixedSceneCamera();
      position = [-146.5625,-490.375,-1696.4375];
      direction.set(-1,1,1).normalize();
      const triangle = Math.min(row128 * 1024, 131072 - row128 * 1024);
      transforms.push({ position:[640,576,512], primary:[10240 + sin(triangle / 3 + 20480) * 8192,0,0] });
    } else if (mode === 3) {
      zoom = .375;
      const q = (sin(row128 * 512) + 1) * 16384;
      position = [sin(phase*4)*1024,sin(q)*2048,cos(q)*4352];
      cameraRotation = this.lookRotation(position, [0,0,0]);
      transforms.push({position:[0,0,0],primary:[a,c,0],secondary:[b,0,0]},
        {position:[0,0,2816],primary:[c,b,0],secondary:[c,0,0]},
        {position:[0,0,-2816],primary:[b,a,0],secondary:[c,0,0]});
    } else {
      split = false;
      zoom = m.flagA9 ? 1.625 : .625;
      if (mode === 4) {
        cameraRotation = rotation(45056 + sin(Math.trunc(phase/7) + row128 * (2048/3)) * (65536/6),
          2560 + cos(Math.trunc(phase/11) + row64 * (8192/3)) * (65536/20), 0);
        const directionVector = new THREE.Vector3().setFromMatrixColumn(cameraRotation,2);
        directionVector.multiplyScalar(sin(row32*2048)*768-2432);
        position = directionVector.toArray().map(value=>Math.floor(value*65536)/65536);
      } else {
        const radius = 2816 + Math.trunc(fixedSin(row64*1024)/96);
        const angle = phase + Math.trunc(fixedSin(row64*1024)/3);
        position = [sin(angle)*radius,sin(row128*2048)*512,cos(angle)*radius];
        cameraRotation = this.lookRotation(position,[sin(row32*2048)*1024,sin(row64*2048)*1024,cos(row32*2048)*1024]);
      }
      transforms.push({position:[256,0,-512],primary:[0,0,0]}, {position:[1280,0,0],primary:[0,0,0]});
    }
    for (let i = 0; i < 3; i++) {
      if (mode === 0) position[i] += offsetB[i] / 65536;
      else if (mode === 2) position[i] += offsetA[i] / 65536;
      else if (mode >= 4) position[i] += (offsetA[i] + offsetB[i]) / 65536;
    }
    const incomingCamera = beat.camera;
    if (m.autoCamera === false && incomingCamera) {
      incomingCamera.updateMatrixWorld();
      cameraRotation.extractRotation(incomingCamera.matrixWorld).multiply(cameraFlip);
      position = new THREE.Vector3().setFromMatrixPosition(incomingCamera.matrixWorld).toArray();
      zoom = 1 / (incomingCamera.aspect * 2 * Math.tan(THREE.MathUtils.degToRad(incomingCamera.fov) / 2));
      if (mode < 2) {
        const forward = new THREE.Vector3().setFromMatrixColumn(cameraRotation,2).multiplyScalar(2560);
        for (const transform of transforms) for (let i=0;i<3;i++) transform.position[i] += forward.getComponent(i);
      }
    } else if (m.autoCamera === false && this.nativeCamera) {
      cameraRotation.copy(this.nativeCamera.rotation);
      position = this.nativeCamera.position;
      zoom = this.nativeCamera.zoom;
      if (mode < 2) {
        const forward = new THREE.Vector3().setFromMatrixColumn(cameraRotation,2).multiplyScalar(2560);
        for (const transform of transforms) for (let i=0;i<3;i++) transform.position[i] += forward.getComponent(i);
      }
    } else this.nativeCamera = { position:[...position], rotation:cameraRotation.clone(), zoom };
    this.setCamera(position,cameraRotation,zoom);
    if (mode !== 2) direction.setFromMatrixColumn(cameraRotation,2).normalize();
    for (const material of this.materials) {
      updateFog(material,state.fog??beat.fog);
      material.uniforms.scroll.value = .25 * Math.sin(row64 / 64 * TAU);
      material.uniforms.lightDirection.value.copy(direction);
      material.uniforms.diffuse.value.setRGB(...lighting.diffuse);
      material.uniforms.ambient.value.setRGB(...lighting.ambient);
    }
    for (const instance of this.instances) {
      const transform = transforms[instance.index];
      instance.instance.visible = !!transform;
      if (!transform) continue;
      for (const {part,source} of instance.parts) {
        const animated = source.flags === 0x3003;
        part.visible = split ? !animated : animated;
        if (!part.visible) continue;
        const euler = source.flags === 0x2002 ? transform.secondary : transform.primary;
        orient(part,euler || [0,0,0],transform.position);
        if (animated) this.animate(part,source,state.cameraShakeA ? (instance.index ? envelope.animationB : envelope.animationA) * 11 : 0);
      }
    }
    this.room.visible = !!m.flagA8;
  }

  lookRotation(position, target) {
    const forward = new THREE.Vector3(...target).sub(new THREE.Vector3(...position)).normalize();
    const right = new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,-1,0)).normalize();
    const up = new THREE.Vector3().crossVectors(forward,right);
    return new THREE.Matrix4().makeBasis(right,up,forward);
  }

  reset() {
    this.nativeCamera = null;
  }

  dispose() {
    const geometries = new Set(), materials = new Set();
    this.group.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.group.clear();
  }
}
