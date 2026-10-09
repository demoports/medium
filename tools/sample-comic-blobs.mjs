// Supplies complete blob surfaces to the original x86 lighting oracle.
// Geometry is an input to this check; it does not claim native physics parity.
import './register-three.mjs';
import { readFileSync } from 'node:fs';
import { Matrix3 } from 'three';
import { Comic } from '../src/effects/Comic.js';
import { Timeline } from '../src/core/Timeline.js';
const data = JSON.parse(readFileSync(new URL('../assets/timeline.json', import.meta.url)));
const comic = new Comic();
const timeline = new Timeline(data, {
	onReset: () => comic.reset(),
	onRenderTick: state => comic.onRenderTick(state),
	onSelect: name => { if (name === 'comic') comic.reset(); },
});
const samples = [];
for (const time of [140.32, 175.32, 195.32, 225.32]) {
	const state = timeline.stateAt(time);
	comic.update(time, state.effects.comic, state);
	comic.group.updateMatrixWorld(true);
	const axes = new Matrix3().setFromMatrix4(comic.camera.matrixWorld).elements;
	for (let kind = 0; kind < 2; kind++) {
		if (!comic.meshes[kind].visible) continue;
		const mesh = comic.meshes[kind];
		const scale = comic.materials[kind].uniforms.normalTransformScale.value / 256;
		const matrix = new Matrix3().setFromMatrix4(mesh.matrix).elements.map(v => Math.round(v * 65536 / scale));
		samples.push({time,kind,effect:structuredClone(state.effects.comic),
			camera:axes.map((v,i) => Math.round(v * 65536 * (i<3||i>=6?-1:1))),matrix,scale,
			positions:Array.from(mesh.geometry.attributes.position.array, v => Math.trunc(v * 67108864))});
	}
}
console.log(JSON.stringify(samples));
comic.dispose();
