import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { setProjection, setCamera, CAMERA_NEAR, CAMERA_FAR, NativeCamera } from '../src/core/Math.js';
import { Demo } from '../src/Demo.js';
import { fogRetained } from '../src/core/Fog.js';

const native = JSON.parse(readFileSync(new URL('fixtures/native-projection.json', import.meta.url)));
const nativeView = JSON.parse(readFileSync(new URL('fixtures/native-view-transform.json', import.meta.url)));

test('full native camera preparation matches projection, clipping and fog', () => {
	const camera = new NativeCamera(60, 4 / 3);
	setProjection(camera, 1);
	const fog = {enabled:true, near:2048, far:7168, min:255, max:255};
	for (const sample of nativeView) {
		setCamera(camera, sample.position, sample.axes);
		for (const vertex of sample.vertices) {
			const point = new Vector3(...vertex.point).add(new Vector3(...sample.translation));
			const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
			const projected = point.clone().project(camera);
			const label = `${sample.name}: ${vertex.point}`;
			const flags = vertex.flags & 0x30;
			if (flags & 0x10) assert.ok(projected.z < -1, label);
			else if (flags & 0x20) assert.ok(projected.z > 1, label);
			else {
				assert.ok(projected.z >= -1 - 1e-12 && projected.z <= 1 + 1e-12, label);
				assert.ok(Math.abs((projected.x + 1) * 320 - vertex.output[0]) < .001, label);
				assert.ok(Math.abs((1 - projected.y) * 240 - vertex.output[1]) < .001, label);
				assert.equal(Math.round(fogRetained(fog, depth) * 255), vertex.fog, label);
			}
		}
	}
});

test('isolated projector matches native focal length and finite clipping', () => {
	const camera = new PerspectiveCamera(60, native.width / native.height);
	setCamera(camera, [0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
	assert.equal(CAMERA_NEAR, native.near);
	assert.equal(CAMERA_FAR, native.far);
	for (const sample of native.vertices) {
		setProjection(camera, sample.zoom);
		const projected = new Vector3(...sample.point).project(camera);
		const nearFarFlags = sample.flags & 0x30;
		const label = JSON.stringify(sample);
		if (nearFarFlags === 0) {
			assert.ok(projected.z >= -1 - 1e-12 && projected.z <= 1 + 1e-12, label);
			assert.ok(Math.abs((projected.x + 1) * native.width / 2 - sample.output[0]) < 1e-4, label);
			assert.ok(Math.abs((1 - projected.y) * native.height / 2 - sample.output[1]) < 1e-4, label);
		} else if (nearFarFlags & 0x10) assert.ok(projected.z < -1, label);
		else assert.ok(projected.z > 1, label);
	}
});

test('the original quad submitter rejects fully far-clipped polygons', () => {
	const camera = new PerspectiveCamera(60, native.width / native.height);
	setProjection(camera, .25);
	for (const sample of native.quads) {
		const depth = new Vector3(0, 0, -sample.depth).applyMatrix4(camera.projectionMatrix).z;
		const clipped = depth < -1 - 1e-12 || depth > 1 + 1e-12;
		assert.equal(clipped ? 0 : 6, sample.indexCount, `depth ${sample.depth}`);
	}
});

test('native quarter view retains the enclosure with the original clip planes', () => {
	const demo = new Demo();
	try {
		const effect = { mode: 0, autoCamera: true, flag121: true };
		const point = new Vector3(1792, 10234.4567, 10401.4278);
		demo.effects.comic.update(195.32, effect);
		const camera = demo.effects.comic.camera;
		const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
		assert.ok(Math.abs(depth - 15777.4278 / 4) < 1e-8);
		assert.ok(point.clone().project(camera).z <= 1, 'native quarter-space depth is inside the original far plane');
		for (const effect of Object.values(demo.effects)) {
			assert.ok(effect.camera instanceof NativeCamera);
			assert.equal(effect.camera.near, CAMERA_NEAR);
			assert.equal(effect.camera.far, CAMERA_FAR);
		}
	} finally { demo.effects.comic.dispose(); }
});
