import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Comic } from '../src/effects/Comic.js';
import { Timeline } from '../src/core/Timeline.js';

const data = JSON.parse(readFileSync(new URL('../assets/timeline.json', import.meta.url)));

function replay() {
	const comic = new Comic();
	const timeline = new Timeline(data, {
		onRenderTick: state => comic.onRenderTick(state),
		onReset: () => comic.reset(),
		onSelect: name => { if (name === 'comic') comic.reset(); }
	});
	return { comic, timeline };
}

function equalSprings(a, b) {
	for (let i = 0; i < 2; i++) {
		assert.deepEqual(a.blobs[i].radius, b.blobs[i].radius);
		assert.deepEqual(a.blobs[i].velocity, b.blobs[i].velocity);
	}
}

test('Comic full seeks reproduce springs from continuous playback', () => {
	const sequential = replay(), seek = replay();
	try {
		for (let frame = 1; frame <= 12000; frame++) sequential.timeline.stateAt(frame / 60);
		seek.timeline.stateAt(200);
		equalSprings(sequential.comic, seek.comic);
		// A backwards seek replays native commands, including geometry resets.
		seek.timeline.stateAt(175);
		sequential.timeline.reset();
		sequential.timeline.stateAt(175);
		equalSprings(sequential.comic, seek.comic);
	} finally {
		sequential.comic.dispose();
		seek.comic.dispose();
	}
});

test('Comic geometry, matrices, and camera remain finite through the demo', () => {
	const { comic, timeline } = replay();
	try {
		for (const time of [0, 130, 140, 156, 166, 175, 182, 200, 215, 240, 280, 320, 350]) {
			const state = timeline.stateAt(time);
			comic.update(time, state.effects.comic, state);
			for (const mesh of comic.meshes) {
				for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value), `position at ${time}`);
				for (const value of mesh.matrix.elements) assert.ok(Number.isFinite(value), `matrix at ${time}`);
			}
			for (const value of comic.camera.position.toArray()) assert.ok(Number.isFinite(value), `camera at ${time}`);
		}
	} finally { comic.dispose(); }
});

test('Comic rendering a paused frame does not advance physics', () => {
	const { comic, timeline } = replay();
	try {
		const state = timeline.stateAt(200);
		comic.update(200, state);
		const radii = comic.blobs.map(blob => blob.radius.slice());
		const vertices = comic.meshes.map(mesh => mesh.geometry.attributes.position.array.slice());
		for (let i = 0; i < 10; i++) comic.update(200, state);
		for (let i = 0; i < 2; i++) assert.deepEqual(comic.blobs[i].radius, radii[i]);
		for (let i = 0; i < 3; i++) assert.deepEqual(comic.meshes[i].geometry.attributes.position.array, vertices[i]);
	} finally { comic.dispose(); }
});

test('Comic visible geometry and camera are independent of earlier rendered frames', () => {
	const sequential = replay();
	function render(player, time) {
		player.comic.update(time, player.timeline.stateAt(time));
		player.comic.group.updateMatrixWorld(true);
	}
	function visibleFrame(comic) {
		return {
			meshes: comic.meshes.filter(mesh => mesh.visible).map(mesh => ({
				position: mesh.geometry.attributes.position.array.slice(),
				normal: mesh.geometry.attributes.normal.array.slice(),
				matrix: mesh.matrix.elements.slice(),
				world: mesh.matrixWorld.elements.slice()
			})),
			camera: {
				position: comic.camera.position.toArray(),
				quaternion: comic.camera.quaternion.toArray(),
				projection: comic.camera.projectionMatrix.elements.slice(),
				world: comic.camera.matrixWorld.elements.slice(),
				inverse: comic.camera.matrixWorldInverse.elements.slice()
			}
		};
	}
	try {
		for (const time of [10, 20, 40, 95, 140, 160]) render(sequential, time);
		// Includes tube-following camera modes 3/4 and the intervening mode 0.
		for (const time of [175.32, 195.32, 225.32]) {
			const direct = replay();
			try {
				render(sequential, time);
				render(direct, time);
				equalSprings(sequential.comic, direct.comic);
				const expected = visibleFrame(direct.comic);
				assert.deepEqual(visibleFrame(sequential.comic), expected, `direct seek at ${time}`);
				for (let repeat = 0; repeat < 10; repeat++) render(sequential, time);
				assert.deepEqual(visibleFrame(sequential.comic), expected, `paused frame at ${time}`);
			} finally { direct.comic.dispose(); }
		}
	} finally { sequential.comic.dispose(); }
});


test('photo freezes hold Comic clocks while visible springs keep rendering', () => {
	const { comic, timeline } = replay();
	try {
		// Native 0x40ca3d skips Update during a photo; 0x40cc96 still renders.
		const effect = timeline.state.effects.comic;
		effect.flag120 = true;
		effect.flag121 = false;
		timeline.state.overlay = { kind: 'photo', startTick: 0, durationMs: 896 };
		const visibleBefore = comic.blobs[0].radius.slice();
		const hiddenBefore = comic.blobs[1].radius.slice();
		timeline.stateAt(0.5);
		assert.equal(timeline.state.effectsFrozen, true);
		assert.equal(effect.elapsedMs, 0);
		assert.equal(effect.phase, 0);
		assert.notDeepEqual(comic.blobs[0].radius, visibleBefore);
		assert.deepEqual(comic.blobs[1].radius, hiddenBefore);
		// A paused playback frame does not add any render-simulation time.
		const rendered = comic.blobs[0].radius.slice();
		timeline.stateAt(0.5);
		assert.deepEqual(comic.blobs[0].radius, rendered);
	} finally { comic.dispose(); }
});
