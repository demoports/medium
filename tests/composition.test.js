import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PerspectiveCamera } from 'three';
import { Demo } from '../src/Demo.js';

const nativeMaterials = JSON.parse(fs.readFileSync(new URL('./fixtures/native-material-order.json', import.meta.url)));

function frame(layers, ownCamera, inheritedCameraOffset=[0,0,0]) {
	const calls = [];
	const state = { time:195.32,layers, effects: {}, clearColor: [16, 22, 32], fog: {}, inheritedCameraOffset,
		renderCache:{projection:{zoom:1},fog:{},fogSlope:0,clearColor:[16,22,32]} };
	const demo = Object.create(Demo.prototype);
	demo.timeline = { frameAt: () => state };
	demo.effects = {};
	demo.scenes = {};
	for (const name of layers) {
		state.effects[name] = {};
		demo.scenes[name] = name;
		const camera=new PerspectiveCamera(60,4/3);camera.name=`${name} camera`;
		demo.effects[name] = {
			camera, useOwnCamera: ownCamera[name],
			update(time, effect, context) {
				assert.equal(time,state.time,'Geometry uses the canonical displayed frame');
				// Effect callbacks may write a new lens and camera transform. Only
				// the lens must be replaced by the frame-begin projection cache.
				camera.fov=110;camera.position.set(123,456,789);camera.updateProjectionMatrix();
				calls.push(['update', name, context]);
			}
		};
		if (name === 'tunnel') Object.assign(demo.effects[name], { mesh: { visible: true }, bars: { visible: true } });
	}
	demo.renderer = {
		setClearColor() {},
		clear() { calls.push(['clear']); },
		render(scene, camera) {
			assert.ok(Math.abs(camera.projectionMatrix.elements[0]-2)<1e-12,'Every material uses the cached native lens');
			const expected=[123,456,789].map((value,i)=>value+(camera.name==='tunnel camera'?inheritedCameraOffset[i]/65536:0));
			assert.deepEqual(camera.position.toArray(),expected,'The current camera transform and shared shake stay live');
			const part = scene === 'tunnel' ? (demo.effects.tunnel.bars.visible ? 'tunnel bars' : 'tunnel patches') : scene;
			calls.push(['draw', part, camera.name]);
		}
	};
	demo.overlays = { render() { calls.push(['overlay']); } };
	demo.render(195.32);
	assert.equal(calls.filter(call => call[0] === 'clear').length, 1);
	assert.equal(calls[0][0], 'clear', 'Clear before either effect, preserving both layers afterward');
	assert.equal(calls.at(-1)[0], 'overlay');
	// 0x415850 executes material registration order, independently of effect
	// callback order. Overlays and bars are both SRCALPHA/ONE with no depth
	// writes, so their additive color contributions commute; the port's
	// overlay renderer remains last while these effect buckets match x86.
	const nativeOrder = nativeMaterials.draws
		.filter(draw => draw.name !== 'overlays' && layers.includes(draw.name.split(' ')[0]))
		.map(draw => draw.name);
	assert.deepEqual(calls.filter(call => call[0] === 'draw').map(call => call[1]), nativeOrder);
	if (demo.effects.tunnel) {
		assert.equal(demo.effects.tunnel.mesh.visible, true);
		assert.equal(demo.effects.tunnel.bars.visible, true);
	}
	return calls;
}

test('Comic shares its view while native buckets draw patches, foreground, then bars', () => {
	const calls = frame(['tunnel', 'comic'], { comic: true });
	assert.deepEqual(calls.filter(call => call[0] === 'draw'), [
		['draw', 'tunnel patches', 'comic camera'], ['draw', 'comic', 'comic camera'], ['draw', 'tunnel bars', 'comic camera']
	]);
});

test('ending Makina inherits Tunnel camera and both layers share the frame buffer', () => {
	const calls = frame(['tunnel', 'makina'], { makina: false });
	assert.equal(calls.find(call => call[0] === 'update' && call[1] === 'makina')[2].camera.name, 'tunnel camera');
	assert.deepEqual(calls.filter(call => call[0] === 'draw'), [
		['draw', 'tunnel patches', 'tunnel camera'], ['draw', 'makina', 'tunnel camera'], ['draw', 'tunnel bars', 'tunnel camera']
	]);
});

test('primary Makina restores its camera after Comic, without another clear', () => {
	const calls = frame(['makina', 'comic'], { makina: true, comic: true });
	assert.deepEqual(calls.filter(call => call[0] === 'draw'), [
		['draw', 'comic', 'comic camera'], ['draw', 'makina', 'makina camera']
	]);
});

test('Comic shakes an inherited Tunnel camera before both material buckets draw',()=>{
	const calls=frame(['tunnel','comic'],{comic:false},[65536,-131072,196608]);
	assert.ok(calls.filter(call=>call[0]==='draw').every(call=>call[2]==='tunnel camera'));
});
