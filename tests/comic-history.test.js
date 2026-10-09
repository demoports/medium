import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timeline } from '../src/core/Timeline.js';

const data = JSON.parse(readFileSync(new URL('../assets/timeline.json', import.meta.url)));
const samples = JSON.parse(readFileSync(new URL('fixtures/comic-history.json', import.meta.url)));

test('Comic state matches native commands, resets, RNG and updates through the whole sequence', () => {
	const timeline = new Timeline(data);
	for (const sample of samples) {
		const state = timeline.stateAt(sample.state.tick / 1000);
		for (const [key, expected] of Object.entries(sample.comic)) {
			assert.deepEqual(state.effects.comic[key], expected, `${sample.state.tick}: Comic ${key}`);
		}
		for (const key of ['randomA', 'randomB']) assert.equal(state[key], sample.state[key], `${sample.state.tick}: ${key}`);
		for (const key of ['row', 'row32', 'row64', 'row128', 'songRow', 'spring', 'springVelocity', 'cosine']) {
			assert.ok(Math.abs(state[key] - sample.state[key]) < 0.000001, `${sample.state.tick}: ${key}`);
		}
	}
});
