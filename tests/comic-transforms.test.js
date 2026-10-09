import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Comic } from '../src/effects/Comic.js';

// Real x86 Render and tube-transform outputs, captured before mesh drawing.
const samples = JSON.parse(readFileSync(new URL('fixtures/comic-transforms.json', import.meta.url)));
const matrixIndices = [0,1,2,4,5,6,8,9,10];

test('Comic object, orbiting tube and following cameras match native x86 transforms', () => {
	const comic = new Comic();
	for (const sample of samples) {
		const label = sample.time ? `${sample.time}s` : `mode ${sample.mode}`;
		comic.update(0, { ...sample, flag11d:true, flag120:true, flag121:true, scale:65536 }, { spring:0 });
		for (let j = 0; j < 9; j++) {
			const i = matrixIndices[j];
			assert.equal(Math.round(comic.objectMatrix.elements[i] * 65536) || 0, sample.blob[j], `${label}: blob axis ${j}`);
			// Three normalizes tube tangents in double precision; native lookup
			// normalization differs by at most a few 16.16 least-significant bits.
			assert.ok(Math.abs(comic.tubeMatrix.elements[i] * 65536 - sample.tube[j]) < 4, `${label}: tube axis ${j}`);
			if (sample.autoCamera && sample.mode >= 3) {
				assert.ok(Math.abs(comic.cameraMatrix.elements[i] * 65536 - sample.camera[j]) < 4, `${label}: camera axis ${j}`);
			}
		}
		for (let j = 0; j < 3; j++) {
			assert.ok(Math.abs(comic.tubeMatrix.elements[12+j] * 1024 - sample.center[j] / 65536) < 0.1, `${label}: tube center ${j}`);
			if (sample.autoCamera) {
				assert.ok(Math.abs(comic.camera.position.getComponent(j) - sample.position[j] / 65536) < 0.2, `${label}: camera position ${j}`);
			}
		}
	}
	comic.dispose();
});
