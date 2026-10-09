import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { Comic } from '../src/effects/Comic.js';

// Executed x86 matrix preparation, independent of the JavaScript shader.
const samples = JSON.parse(readFileSync(new URL('fixtures/comic-lighting.json', import.meta.url)));

test('Comic light and environment-map frames match native preparation', () => {
	const comic = new Comic();
	try {
		for (const sample of samples) {
			const label = sample.time ? `${sample.time}s` : `mode ${sample.mode}`;
			comic.update(0, { ...sample, flag11d:true, flag120:true, flag121:true, scale:65536 });
			for (let i = 0; i < 3; i++) {
				const expected = i < 2 ? sample.blobLight : sample.tubeLight;
				const actual = comic.materials[i].uniforms.lightMatrix.value.elements;
				for (let j = 0; j < 9; j++) assert.ok(Math.abs(actual[j] * 65536 - expected[j]) < 4, `${label}: mesh ${i} light axis ${j}`);
			}
			if (!sample.autoCamera) continue; // External camera is supplied by Demo.
			comic.group.updateMatrixWorld(true);
			const modelView = new Matrix4().multiplyMatrices(comic.camera.matrixWorldInverse, comic.tube.matrixWorld);
			const normalMatrix = new Matrix3().getNormalMatrix(modelView);
			const nativeView = new Matrix3().fromArray(sample.tubeView.map(value => value / 65536));
			for (const normal of [[1,0,0],[0,1,0],[0,0,1]]) {
				const actual = new Vector3(...normal).applyMatrix3(normalMatrix).normalize();
				const expected = new Vector3(...normal).applyMatrix3(nativeView).normalize();
				// The camera adaptation negates native X/Z; the shader restores X.
				assert.ok(Math.abs(-actual.x - expected.x) < 0.0002, `${label}: texture U`);
				assert.ok(Math.abs(actual.y - expected.y) < 0.0002, `${label}: texture V`);
			}
		}
	} finally { comic.dispose(); }
});
