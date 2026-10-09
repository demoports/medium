import * as THREE from 'three';
import { sin as fixedSin, cos as fixedCos, mul as fixedMul, basis, setProjection, CAMERA_NEAR, CAMERA_FAR, NativeCamera } from '../core/Math.js';
import { updateComicNormals } from './ComicNormals.js';
import { fogUniforms, updateFog, fogVertex, fogFragment } from '../core/Fog.js';
import { loadNativeMipTexture } from '../core/Texture.js';

// Comic effect, medium.exe vtable 0x434414. Geometry is recovered from
// 0x407ed0 (bent tube) and 0x408b30 (two radially deforming cube-spheres).
// World coordinates below are original units / 1024; a full angle is 65536.
const UNIT = 1024;
const sin = a => fixedSin(a) / 65536;
const cos = a => fixedCos(a) / 65536;
const TEXTURES = ['comic8', 'comic12c', 'comic13c', 'comic11', 'comic7', 'petb01', 'pet02e_15', 'pet02e_3', 'peta01', 'petc01'];
const MIP_TEXTURES = new Set(['comic8', 'comic11', 'pet02e_15', 'pet02e_3', 'petc01']);

// 0x41c840. The executable stores the matrix column-major, and its first
// argument is yaw, second pitch, third roll (not XYZ Euler angles).
function rotation(a = 0, b = 0, c = 0, target = new THREE.Matrix4()) {
	const m = basis(a, b, c);
	return target.set(
		m[0], m[3], m[6], 0,
		m[1], m[4], m[7], 0,
		m[2], m[5], m[8], 0,
		0, 0, 0, 1
	);
}

function gridGeometry(columns, rows) {
	const count = (columns + 1) * (rows + 1), indices = [];
	for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
		const a = y * (columns + 1) + x, b = a + columns + 1;
		indices.push(a, b, b + 1, a, b + 1, a + 1);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
	geometry.setIndex(indices);
	return geometry;
}

// The four products and profile constants here are the literal 0x407fb0–
// 0x408350 formulas. This shape is a tapered tube bent about Z, not a torus.
function updateTube(geometry, age) {
	const vertices = geometry.attributes.position.array;
	const native = geometry.userData.nativePositions ||= new Int32Array(vertices.length);
	let index = 0;
	for (let j = 0; j <= 64; j++) {
		const u = Math.trunc(Math.trunc(j * 65536 / 65) / 2);
		const profile = u > 4096 ? Math.trunc((fixedSin(fixedMul(u, 0x12800) + 12288) + 65536) / 2) : fixedSin(u * 4);
		const m = basis(0, 0, -12288 + j * 256).map(value => Math.round(value * 65536));
		for (let i = 0; i <= 32; i++) {
			const wave = Math.trunc((0x40000
				+ fixedMul(fixedSin((j + i) * 2048), fixedSin(j * 48 - age * 32))
				+ fixedMul(fixedSin(j * 880 - age * 32), fixedSin((i - j) * 4096))
				+ fixedMul(fixedSin((144 + j * 16 - age) * 32), fixedSin((i - j) * 4096))
				+ fixedMul(fixedSin((656 - age) * 32 + j * 304), fixedSin(-(j + i) * 2048))) / 8);
			const radius = fixedMul(wave, profile) + Math.trunc(profile / 8);
			const x = fixedMul(fixedSin(i * 2048), radius) << 10;
			const y = j * 0x800000;
			const z = fixedMul(fixedCos(i * 2048), radius) << 10;
			for (let component = 0; component < 3; component++) {
				const value = (fixedMul(m[component], x) + fixedMul(m[component + 3], y) + fixedMul(m[component + 6], z)) | 0;
				native[index] = value;
				vertices[index++] = value / (65536 * UNIT);
			}
		}
	}
	geometry.attributes.position.needsUpdate = true;
	updateComicNormals(geometry, 32, 64);
}

function forceDirections(age) {
	const directions = [
		[sin(age * 22), 5120 / 65536, 4096 / 65536],
		[5120 / 65536, sin(age * 23), 4096 / 65536],
		[5120 / 65536, 4096 / 65536, sin(age * 18)],
		[sin(age * 25), cos(age * 25), 4096 / 65536],
		[sin(-age * 25), cos(-age * 25), 5120 / 65536]
	];
	const frequencies = [22, 12, 23, 15, 17];
	return directions.map((d, i) => {
		const length = Math.hypot(...d);
		return [d[0] / length, d[1] / length, d[2] / length, 4 + 2 * sin(age * frequencies[i])];
	});
}

class ComicBlob {
	constructor(kind) {
		this.kind = kind;
		this.geometry = new THREE.BufferGeometry();
		const normals = [], indices = [];
		// 0x408940: six cube faces, each 29 by 29, normalized to a sphere.
		for (let face = 0; face < 6; face++) {
			const offset = normals.length / 3;
			for (let y = 0; y <= 28; y++) for (let x = 0; x <= 28; x++) {
				const a = x - 14, b = y - 14, r = 14;
				const vector = [[a,b,r],[r,b,-a],[-b,-a,-r],[-r,-a,b],[a,-r,b],[-b,r,-a]][face];
				const length = Math.hypot(...vector);
				normals.push(vector[0] / length, vector[1] / length, vector[2] / length);
			}
			for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
				const a = offset + y * 29 + x, b = a + 29;
				if (kind) indices.push(a, a + 1, b + 1, a, b + 1, b);
				else indices.push(a, b, b + 1, a, b + 1, a + 1);
			}
		}
		this.directions = new Float32Array(normals);
		this.radius = new Float64Array(normals.length / 3);
		this.velocity = new Float64Array(this.radius.length);
		this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(normals.length), 3).setUsage(THREE.DynamicDrawUsage));
		this.geometry.setIndex(indices);
		this.reset();
	}

	reset() {
		this.radius.fill(this.kind ? 24576 : 512);
		this.velocity.fill(0);
	}

	step(force) {
		const direction = this.directions;
		const spring = this.kind ? 32 / 65536 : 96 / 65536;
		const strength = this.kind ? 1 : 0.5;
		for (let i = 0; i < this.radius.length; i++) {
			const x = direction[i * 3], y = direction[i * 3 + 1], z = direction[i * 3 + 2];
			let acceleration = 0;
			for (let k = 0; k < 5; k++) {
				const f = force[k];
				let dot = x * f[0] + y * f[1] + z * f[2];
				if (dot > 0) dot *= dot;
				acceleration += dot * dot * f[3];
			}
			const r = this.radius[i];
			this.radius[i] = r + this.velocity[i];
			this.velocity[i] = (this.velocity[i] + acceleration * strength - r * spring) * (0xf800 / 65536);
		}
	}

	update() {
		const out = this.geometry.attributes.position.array;
		for (let i = 0; i < this.radius.length; i++) {
			const radius = this.radius[i] / UNIT;
			out[i * 3] = this.directions[i * 3] * radius;
			out[i * 3 + 1] = this.directions[i * 3 + 1] * radius;
			out[i * 3 + 2] = this.directions[i * 3 + 2] * radius;
		}
		this.geometry.attributes.position.needsUpdate = true;
		updateComicNormals(this.geometry, 28, 28, 6);
	}
}

function comicMaterial() {
	// Both original texture coordinates are normal-derived (0x4086d6 and
	// 0x4097bd): view-space normal / 2, and light-space normal / the beat divisor.
	return new THREE.ShaderMaterial({
		uniforms: {
			mapA: { value: null }, mapB: { value: null }, normalScale: { value: 0.5 },
			lightBias: { value: 0 }, normalTransformScale: { value: 256 }, lightMatrix: { value: new THREE.Matrix3() }, ...fogUniforms()
		},
		vertexShader: `
			${fogVertex}
			varying vec2 uvA; varying vec2 uvB;
			varying float brightness;
			uniform float normalScale; uniform float lightBias; uniform float normalTransformScale; uniform mat3 lightMatrix;
			void main() {
				// Native fixed normals retain their lookup-table quantization.
				// modelView includes 1024 geometry units and the camera quarter scale.
				vec3 n = mat3(modelViewMatrix) * normal / normalTransformScale;
				vec3 lightN = lightMatrix * normal;
				// The Three camera includes Y(PI); restore native camera X for UVs.
				uvA = vec2(0.5) + vec2(-n.x, n.y) * 0.5;
				uvB = vec2(0.5) + lightN.xy * normalScale;
				// 0x4087b1 / 0x4097fd clamp 16.16 light and pack its high byte.
				brightness = floor(clamp(abs(lightN.z) + lightBias, 0.3125, 65535.0 / 65536.0) * 256.0) / 255.0;
				vec4 p = modelViewMatrix * vec4(position, 1.0);
				fogRetained = nativeFog(-p.z);
				gl_Position = projectionMatrix * p;
			}`,
		fragmentShader: `
			${fogFragment}
			uniform sampler2D mapA; uniform sampler2D mapB;
			varying vec2 uvA; varying vec2 uvB; varying float brightness;
			void main() {
				vec3 stage0 = clamp(texture2D(mapA, uvA).rgb * brightness, 0.0, 1.0);
				vec3 color = clamp(stage0 * texture2D(mapB, uvB).rgb * 2.0, 0.0, 1.0);
				color = mix(fogColor, color, fogRetained);
				gl_FragColor = vec4(color, 1.0);
			}`,
		side: THREE.BackSide,
		depthTest: true,
		depthWrite: true,
		toneMapped: false
	});
}

export class Comic {
	constructor(textures = {}) {
		this.textures = textures;
		this.group = new THREE.Group();
		this.group.name = 'Comic / 0x434414';
		// Match the other effects' original world units at the public boundary.
		this.group.scale.setScalar(UNIT);
		this.camera = new NativeCamera(60, 4 / 3, CAMERA_NEAR, CAMERA_FAR);
		this.camera.position.set(1.75 * UNIT, 0.75 * UNIT, -6 * UNIT);
		this.camera.rotation.y = Math.PI;
		this.useOwnCamera = false;
		this.materials = [comicMaterial(), comicMaterial(), comicMaterial()];
		this.blobs = [new ComicBlob(0), new ComicBlob(1)];
		this.meshes = this.blobs.map((blob, i) => new THREE.Mesh(blob.geometry, this.materials[i]));
		this.tube = new THREE.Mesh(gridGeometry(32, 64), this.materials[2]);
		this.meshes.push(this.tube);
		for (const mesh of this.meshes) {
			mesh.frustumCulled = false;
			mesh.matrixAutoUpdate = false;
			this.group.add(mesh);
		}
		this.ownedTextures = [];
		this.textureVariants = new Map();
		this.objectMatrix = new THREE.Matrix4();
		this.tubeMatrix = new THREE.Matrix4();
		this.cameraMatrix = new THREE.Matrix4();
		this.renderAccumulator = 0;
		this.previousEffect = null;
	}

	async init(loader = new THREE.TextureLoader()) {
		for (const name of TEXTURES) {
			let texture = this.textures[name] || this.textures[`medium_comic/${name}`] || this.textures[`medium_comic/${name}.png`];
			if (!texture) {
				texture = MIP_TEXTURES.has(name)
					? await loadNativeMipTexture(new URL(`../../assets/textures/medium_comic/${name}.mips.bin`, import.meta.url))
					: await loader.loadAsync(new URL(`../../assets/textures/medium_comic/${name}.png`, import.meta.url).href);
				this.ownedTextures.push(texture);
			}
			texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
			texture.flipY = false;
			texture.minFilter = texture.magFilter = THREE.LinearFilter;
			texture.generateMipmaps = false;
			texture.colorSpace = THREE.NoColorSpace;
			this.textures[name] = texture;
		}
		this.setTextures(true);
		return this;
	}

	setTextures(alternate) {
		// Material pairs from ctor 0x409d9f. Reset selects the pet textures;
		// command 9 explicitly selects comic, command 17 explicitly selects pet.
		const pairs = alternate
			? [['petb01','pet02e_15'],['pet02e_3','pet02e_3'],['peta01','petc01']]
			: [['comic8','comic12c'],['comic11','comic13c'],['comic8','comic7']];
		for (let i = 0; i < 3; i++) {
			this.materials[i].uniforms.mapA.value = this.textureVariant(pairs[i][0], !alternate);
			this.materials[i].uniforms.mapB.value = this.textureVariant(pairs[i][1], alternate);
		}
	}

	textureVariant(name, mipmaps) {
		const key = `${name}:${mipmaps}`;
		if (this.textureVariants.has(key)) return this.textureVariants.get(key);
		const source = this.textures[name];
		if (!source) return null;
		const texture = source.clone();
		texture.generateMipmaps = mipmaps && !source.userData.nativeMipmaps;
		texture.minFilter = mipmaps ? THREE.LinearMipmapNearestFilter : THREE.LinearFilter;
		texture.needsUpdate = true;
		this.textureVariants.set(key, texture);
		this.ownedTextures.push(texture);
		return texture;
	}

	onRenderTick(global) {
		if (!global.layers.includes('comic')) return;
		const effect = global.effects.comic;
		if (effect !== this.previousEffect) {
			this.reset();
			this.previousEffect = effect;
		}
		// 0x408b30 integrates springs in the render routine. A canonical 60 Hz
		// cadence makes browser playback and complete timeline replay agree.
		// Photos freeze the force-direction clock, but native Render continues
		// integrating visible blobs. Reset/seek replays every render step.
		this.renderAccumulator += 60;
		if (this.renderAccumulator < 1000) return;
		this.renderAccumulator -= 1000;
		if (!effect.flag120 && !effect.flag121) return;
		const force = forceDirections(effect.elapsedMs);
		if (effect.flag120) this.blobs[0].step(force);
		if (effect.flag121) this.blobs[1].step(force);
	}

	update(time, effect = {}, global = {}) {
		if (effect.effects) { global = effect; effect = effect.effects.comic; }
		const age = effect.elapsedMs ?? time * 1000, phase = effect.phase ?? age;
		const visible = [!!effect.flag120, !!effect.flag121, !!effect.flag11d];
		this.group.visible = visible.some(Boolean);
		this.useOwnCamera = !!effect.autoCamera;
		if (!this.group.visible) return;
		this.setTextures(effect.textureSet ? effect.textureSet === 'pet' : !effect.alternateTextures);
		const beat = effect.beats?.[1] || 0;
		for (const material of this.materials) {
			material.uniforms.normalScale.value = effect.flag11e ? 65536 / ((beat + 8192) * 16) : 0.5;
			material.uniforms.lightBias.value = effect.flag11e ? beat / 65536 : 0;
			updateFog(material, global.fog);
		}
		let yaw = 0, pitch = 0, roll = 0, lens = 0.5;
		const mode = effect.mode || 0;
		if (mode === 0 && effect.autoCamera) {
			yaw = phase * 17 / 4; pitch = phase * 11 / 4; roll = phase * 3 / 4 + (effect.drift || 0);
			this.camera.position.set(1.75, 0.75, -5.25); lens = 0.25;
		} else if (mode === 1) {
			yaw = effect.autoCamera ? 0xb9a0 : 0; pitch = effect.autoCamera ? 0x0ee0 : 0xd000;
			this.camera.position.set(1.75, 0.75, -6); lens = 0.5;
		} else if (mode === 2 && effect.autoCamera) {
			yaw = 0xb600; pitch = 0xa650; roll = effect.drift || 0;
			this.camera.position.set(0, 0.75, -6); lens = 0.625;
		}
		rotation(yaw, pitch, roll, this.objectMatrix);
		// 0x407d20: moving center at radius 3072; its tangent and up vector
		// form the orientation used to carry the bent tube around that path.
		const a = age * 8, center = new THREE.Vector3(sin(a), 0, cos(a));
		const tangent = new THREE.Vector3(sin(a - 8192), 0, cos(a - 8192)).sub(center).normalize();
		const up = new THREE.Vector3(0, 1, 0);
		const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
		this.tubeMatrix.makeBasis(right, tangent, up);
		// 0x40af2b resets the light frame to identity. Blob normals stay local;
		// 0x408361–0x4083d4 rotates tube light/UV normals by its orbit basis,
		// before the outer object rotation used to position the geometry.
		this.materials[2].uniforms.lightMatrix.value.setFromMatrix4(this.tubeMatrix);
		this.tubeMatrix.premultiply(this.objectMatrix);
		center.multiplyScalar(3).applyMatrix4(this.objectMatrix);
		this.tubeMatrix.setPosition(center);
		if (mode >= 3) {
			const cameraRotation = mode === 3
				? rotation(0xe0d0 + sin(phase * 2) * 4096, 0x5860 + sin(phase * 5) * 2048, 0xc000 + sin(phase * 3) * 1024)
				: rotation(0xe770 + sin(phase * 3) * 1024, 0xf6c0 + sin(phase * 5) * 2048, 0xc000 + sin(phase * 2) * 4096);
			// 0x40ab9e / 0x40ad73 remap the tube columns to right, forward,
			// negative up. 0x41c980 then computes tubeFrame * cameraRotation.
			// This is a quarter turn about the tube's local X, not an inverse.
			const tube = this.tubeMatrix.elements;
			this.cameraMatrix.makeBasis(
				new THREE.Vector3(tube[0], tube[1], tube[2]),
				new THREE.Vector3(tube[8], tube[9], tube[10]),
				new THREE.Vector3(-tube[4], -tube[5], -tube[6])
			).multiply(cameraRotation);
			const m = this.cameraMatrix.elements;
			this.camera.position.copy(center).add(new THREE.Vector3(m[8],m[9],m[10]).multiplyScalar(-6.125)).add(new THREE.Vector3(m[4],m[5],m[6]).multiplyScalar(-1.171875));
			this.camera.quaternion.setFromRotationMatrix(this.cameraMatrix);
			this.camera.rotateY(Math.PI);
			lens = mode === 3 ? 1 : 0.625;
			rotation(0, (effect.rowY || 0) * 1024, (effect.rowZ || 0) * 512, this.objectMatrix);
		} else this.camera.rotation.set(0, Math.PI, 0);
		if (this.useOwnCamera) {
			for (const offset of [global.cameraOffsetA, global.cameraOffsetB]) if (offset) this.camera.position.add(new THREE.Vector3(...offset).multiplyScalar(1 / (65536 * UNIT)));
			this.camera.position.multiplyScalar(UNIT);
			setProjection(this.camera, lens);
			this.camera.updateMatrixWorld();
		}
		const pulse = effect.flag122 ? 1 + (global.spring || 0) * (10240 / 65536) : 1;
		const scale = (effect.scale ?? 65536) / 65536 * pulse;
		for (let i = 0; i < 3; i++) {
			const mesh = this.meshes[i]; mesh.visible = visible[i];
			this.materials[i].uniforms.normalTransformScale.value = 256 * (i < 2 ? scale : 1);
			if (!visible[i]) continue;
			if (i < 2) {
				this.blobs[i].update();
				mesh.matrix.copy(this.objectMatrix).scale(new THREE.Vector3(scale, scale, scale));
			} else {
				updateTube(mesh.geometry, age);
				mesh.matrix.copy(this.tubeMatrix);
			}
			mesh.matrixWorldNeedsUpdate = true;
		}
	}

	reset() {
		for (const blob of this.blobs) blob.reset();
		this.renderAccumulator = 0;
		this.previousEffect = null;
	}
	dispose() {
		for (const mesh of this.meshes) mesh.geometry.dispose();
		for (const material of this.materials) material.dispose();
		for (const texture of this.ownedTextures) texture.dispose();
	}
}

export default Comic;
