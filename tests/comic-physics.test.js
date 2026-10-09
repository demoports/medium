import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Comic } from '../src/effects/Comic.js';
import { Timeline } from '../src/core/Timeline.js';
const fixture = JSON.parse(readFileSync(new URL('fixtures/native-comic-physics.json', import.meta.url)));
const data = JSON.parse(readFileSync(new URL('../assets/timeline.json', import.meta.url)));

test('Blob spring history follows native visibility, frozen ages and reset semantics', () => {
	const comic = new Comic(), counts = [0,0];
	for (let i = 0; i < 2; i++) {
		const blob = comic.blobs[i], step = blob.step.bind(blob);
		blob.step = force => { counts[i]++; step(force); };
	}
	const timeline = new Timeline(data, {
		onReset: () => comic.reset(), onRenderTick: s => comic.onRenderTick(s),
		onSelect: name => { if (name === 'comic') comic.reset(); },
	});
	try {
		assert.equal(fixture.cadenceHz, 60);
		assert.deepEqual(fixture.resetTicks, [0]);
		for (const sample of fixture.samples) {
			timeline.stateAt(sample.tick / 1000);
			const blob = comic.blobs[sample.kind];
			assert.equal(counts[sample.kind], sample.frames, `${sample.tick} blob${sample.kind} render count`);
			for (const vertex of sample.vertices) {
				const actual = [0,1,2].map(c => blob.directions[vertex.index * 3 + c] * blob.radius[vertex.index]);
				const expected = vertex.position.map(v => v / 65536);
				const error = Math.hypot(...actual.map((v,i) => v - expected[i]));
				// Native springs quantize 3-D fixed-point velocities every frame;
				// JS uses a floating radial velocity. This bound is in original world
				// units, not rendered units, and catches reset/freeze/cadence errors.
				const tolerance = sample.tick === 140320 ? 16 : 7;
				assert.ok(error < tolerance, `${sample.tick} blob${sample.kind} vertex${vertex.index}: ${error} world units`);
			}
		}
	} finally { comic.dispose(); }
});
