import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { Comic } from '../src/effects/Comic.js';
import { blobSeamSources } from '../src/effects/ComicNormals.js';
import { NativeCamera, setProjection } from '../src/core/Math.js';
import { fogRetained } from '../src/core/Fog.js';

// Full native 0x407ed0 execution, including 0x41a980 view preparation,
// 0x41c1a0 normalization, packed diffuse and both texture-coordinate stages.
const fixture = JSON.parse(readFileSync(new URL('fixtures/native-comic-pipeline.json', import.meta.url)));

test('Comic tube normals and packed lighting match executed native vertices', () => {
	const comic = new Comic();
	try {
		comic.update(160.32, { ...fixture.case, flag11d:true, flag11e:true, beats:[0,0] }, {});
		comic.group.updateMatrixWorld(true);
		const camera = new NativeCamera(60, 4 / 3);
		camera.matrixAutoUpdate = false;
		const axes = fixture.camera.axes;
		camera.matrix.makeBasis(new Vector3(...axes.slice(0,3)), new Vector3(...axes.slice(3,6)), new Vector3(...axes.slice(6,9)));
		camera.matrix.setPosition(...fixture.camera.position);
		camera.updateMatrixWorld(true);
		setProjection(camera, 1);
		const view = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, comic.tube.matrixWorld);
		const viewNormal = new Matrix3().setFromMatrix4(view);
		const light = comic.materials[2].uniforms.lightMatrix.value;
		const geometry = comic.tube.geometry;
		for (const vertex of fixture.vertices) {
			const label = `vertex ${vertex.index}`;
			assert.deepEqual(Array.from(geometry.userData.nativePositions.slice(vertex.index * 3, vertex.index * 3 + 3)), vertex.position, `${label} fixed position`);
			const normal = new Vector3().fromBufferAttribute(geometry.attributes.normal, vertex.index);
			assert.deepEqual(normal.toArray().map(v => v * 65536), vertex.normal, `${label} fixed forward normal`);
			const lightNormal = normal.clone().applyMatrix3(light);
			const viewN = normal.clone().applyMatrix3(viewNormal).multiplyScalar(1 / 256);
			const uv = [.5 - viewN.x * .5, .5 + viewN.y * .5, .5 + lightNormal.x * .5, .5 + lightNormal.y * .5];
			for (let i = 0; i < 4; i++) assert.ok(Math.abs(uv[i] - vertex.uv[i]) < .0001, `${label} UV${i}: ${uv[i]} vs ${vertex.uv[i]}`);
			const brightness = Math.floor(Math.max(.3125, Math.min(65535 / 65536, Math.abs(lightNormal.z))) * 256);
			assert.equal(brightness, parseInt(vertex.diffuse) & 255, `${label} packed diffuse`);
			const p = new Vector3().fromBufferAttribute(geometry.attributes.position, vertex.index).applyMatrix4(view);
			const retained = fogRetained({enabled:true,near:2048,far:7168,min:255,max:255}, -p.z);
			assert.equal(Math.round(retained * 255), vertex.fog, `${label} native fog`);
		}
	} finally { comic.dispose(); }
});

test('Comic copies all 342 native cube-face lighting seams', () => {
	const sort = pairs => pairs.sort((a, b) => a[0] - b[0]);
	assert.deepEqual(sort(blobSeamSources()), fixture.blobSeams);
});

test('Comic quad diagonals and winding match the native index emitter', () => {
	const comic = new Comic();
	try {
		const meshes = {tube:comic.tube,smallBlob:comic.meshes[0],outerBlob:comic.meshes[1]};
		for (const quad of fixture.quads) assert.deepEqual(Array.from(meshes[quad.name].geometry.index.array.slice(0,6)), quad.indices, quad.name);
	} finally { comic.dispose(); }
});
