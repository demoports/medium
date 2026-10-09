import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { Comic } from '../src/effects/Comic.js';
import { Timeline } from '../src/core/Timeline.js';
import { NativeCamera } from '../src/core/Math.js';
const fixture = JSON.parse(readFileSync(new URL('fixtures/native-comic-blobs.json', import.meta.url)));
const data = JSON.parse(readFileSync(new URL('../assets/timeline.json', import.meta.url)));

test('Blob normals, diffuse and UVs match native shading, including animated object scale', () => {
	const comic = new Comic();
	const timeline = new Timeline(data, {
		onReset: () => comic.reset(), onRenderTick: s => comic.onRenderTick(s),
		onSelect: name => { if (name === 'comic') comic.reset(); },
	});
	try {
		for (const sample of fixture) {
			const state = timeline.stateAt(sample.time);
			comic.update(sample.time, state.effects.comic, state);
			comic.group.updateMatrixWorld(true);
			const mesh = comic.meshes[sample.kind], material = comic.materials[sample.kind];
			const camera = new NativeCamera(); camera.matrixAutoUpdate = false;
			const axes = sample.camera.map((v,i) => v / 65536 * (i < 3 || i >= 6 ? -1 : 1));
			camera.matrix.makeBasis(new Vector3(...axes.slice(0,3)), new Vector3(...axes.slice(3,6)), new Vector3(...axes.slice(6,9)));
			camera.updateMatrixWorld(true);
			const view = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
			const normalMatrix = new Matrix3().setFromMatrix4(view);
			for (const vertex of sample.vertices) {
				const label = `${sample.time} blob${sample.kind} vertex${vertex.index}`;
				const n = new Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, vertex.index);
				for (let i = 0; i < 3; i++) assert.ok(Math.abs(n.getComponent(i) * 65536 - vertex.normal[i]) <= 2, `${label} normal${i}`);
				const viewN = n.clone().applyMatrix3(normalMatrix).multiplyScalar(1 / material.uniforms.normalTransformScale.value);
				const lightN = n.clone().applyMatrix3(material.uniforms.lightMatrix.value);
				const scale = material.uniforms.normalScale.value;
				const uv = [.5 - viewN.x*.5, .5 + viewN.y*.5, .5 + lightN.x*scale, .5 + lightN.y*scale];
				for (let i = 0; i < 4; i++) assert.ok(Math.abs(uv[i] - vertex.uv[i]) < .00015, `${label} UV${i}: ${uv[i]} vs ${vertex.uv[i]}`);
				const brightness = Math.floor(Math.max(.3125,Math.min(65535/65536,Math.abs(lightN.z)+material.uniforms.lightBias.value))*256);
				assert.equal(brightness, parseInt(vertex.diffuse)&255, `${label} diffuse`);
			}
		}
	} finally { comic.dispose(); }
});
