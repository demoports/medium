import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { Comic } from '../src/effects/Comic.js';

const samples = JSON.parse(readFileSync(new URL('fixtures/comic-geometry.json', import.meta.url)));

test('Tube fixed-point geometry and full camera projection match native rendering', () => {
	const comic = new Comic();
	try {
		for (const sample of samples) {
			comic.update(sample.time, { ...sample.effect, flag11d:true });
			comic.group.updateMatrixWorld(true);
			const geometry = comic.tube.geometry;
			const native = geometry.userData.nativePositions;
			assert.equal(createHash('sha256').update(new Uint8Array(native.buffer)).digest('hex'), sample.sha256, `${sample.time}: all 2145 native vertices`);
			for (const vertex of sample.projections) {
				const position = new Vector3().fromArray(geometry.attributes.position.array, vertex.index * 3).applyMatrix4(comic.tube.matrixWorld);
				const view = position.clone().applyMatrix4(comic.camera.matrixWorldInverse);
				const screen = position.project(comic.camera);
				assert.ok(Math.abs((screen.x + 1) * 320 - vertex.screen[0]) < 0.5, `${sample.time}: vertex ${vertex.index} X`);
				assert.ok(Math.abs((1 - screen.y) * 240 - vertex.screen[1]) < 0.5, `${sample.time}: vertex ${vertex.index} Y`);
				assert.ok(Math.abs(-view.z - vertex.viewDepth) < 1, `${sample.time}: vertex ${vertex.index} native quarter-depth`);
			}
		}
	} finally { comic.dispose(); }
});
