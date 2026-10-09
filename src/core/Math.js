// Fixed-point conventions of yeff/math.cpp, medium.exe 0x41bc00–0x41c972.
import { Matrix4, Vector3, PerspectiveCamera } from 'three';

// 0x41a980 transposes the native camera and scales its view basis by 0x4000.
// This quarter scale leaves screen X/Y unchanged, but is essential to depth,
// clipping and fog. Native look-at matrices may also contain a reflection.
const nativeViewScale = new Matrix4().makeScale(0.25, 0.25, 0.25);
export class NativeCamera extends PerspectiveCamera {
	updateMatrixWorld(force) {
		super.updateMatrixWorld(force);
		this.matrixWorldInverse.copy(this.matrixWorld).invert().premultiply(nativeViewScale);
	}
	updateWorldMatrix(updateParents,updateChildren,force=false) {
		super.updateWorldMatrix(updateParents,updateChildren,force);
		this.matrixWorldInverse.copy(this.matrixWorld).invert().premultiply(nativeViewScale);
	}
}
// Quarter-wave recurrence from 0x41baa0, byte-for-byte checked against x86.
const quarterSine = new Int32Array(4097);
let sineAccumulator = 0, cosineAccumulator = 0x80000000;
for (let i = 1; i < 4096; i++) {
	sineAccumulator += Math.floor(cosineAccumulator * 0x1921fc / 0x100000000);
	quarterSine[i] = Math.floor(sineAccumulator / 32768);
	cosineAccumulator -= Math.floor(sineAccumulator * 0x1921fc / 0x100000000);
}
quarterSine[4096] = 65536;
export function sin(angle) {
	let i = (Math.trunc(angle) >> 2) & 16383;
	const sign = i >= 8192 ? -1 : 1;
	i &= 8191;
	return sign * quarterSine[i <= 4096 ? i : 8192 - i];
}
export const cos = angle => sin((Math.trunc(angle) + 16384) | 0);
export const mul = (a, b) => Math.floor(a * b / 65536) | 0;
export const div = (a, b) => Math.trunc(a * 65536 / b) | 0;
export class Random {
	constructor(a = 1118820455, b = 1922350462) { this.a = a; this.b = b; }
	next() {
		const a = (this.a >>> 12) | (this.a << 20);
		this.a = ((this.b >>> 5) | (this.b << 27)) ^ a;
		this.b = (this.a - a) | 0;
		return this.b & 65535;
	}
}
// Three rows are the original camera's right, up and forward basis vectors.
export function basis(a, b, c) {
	const ca = cos(a), cb = cos(b), cc = cos(c), sa = sin(a), sb = sin(b), sc = sin(c);
	return [mul(ca,cc)-mul(mul(sa,sb),sc), -mul(cb,sc), mul(sa,cc)+mul(mul(ca,sb),sc),
		mul(ca,sc)+mul(mul(sa,sb),cc),mul(cb,cc),mul(sa,sc)-mul(mul(ca,sb),cc),-mul(sa,cb),sb,mul(ca,cb)].map(value=>value/65536);
}
const matrix = new Matrix4();
// 0x418190 initializes these finite clip planes; 0x418260 marks vertices
// outside them and 0x41a4b0/0x414390 reject or clip their polygons on the CPU.
export const CAMERA_NEAR = 8;
export const CAMERA_FAR = 10240;
export function setProjection(camera, zoom) {
	camera.near = CAMERA_NEAR;
	camera.far = CAMERA_FAR;
	// 0x41ac90: focal length in pixels is viewport width * native zoom.
	camera.fov = 2 * Math.atan(0.5 / (camera.aspect * zoom)) * 180 / Math.PI;
	camera.updateProjectionMatrix();
}
export function setCamera(camera, position, axes) {
	// The original renderer looks along +Z and screen Y grows downwards.
	matrix.set(-axes[0], axes[3], -axes[6], position[0],
		-axes[1], axes[4], -axes[7], position[1],
		-axes[2], axes[5], -axes[8], position[2], 0, 0, 0, 1);
	matrix.decompose(camera.position, camera.quaternion, camera.scale);
	camera.updateMatrixWorld();
}
const right = new Vector3(), up = new Vector3(), forward = new Vector3();
export function lookingAt(position, target) {
	forward.set(target[0]-position[0], target[1]-position[1], target[2]-position[2]).normalize();
	right.crossVectors(new Vector3(0,1,0),forward).normalize();
	up.crossVectors(forward,right).normalize();
	return [...right, ...up, ...forward];
}
