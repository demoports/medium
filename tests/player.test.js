import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run the actual browser entry module against a controlled output clock.
// vm modules need a Node flag; keep that flag out of the normal test command.
if (!vm.SourceTextModule) {
	test('browser transport follows the audible demo clock through seeks and cancellation', () => {
		const result = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url)], {
			encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' }
		});
		assert.equal(result.status, 0, result.stdout + result.stderr);
	});
} else {
	const mainURL = new URL('../src/main.js', import.meta.url);
	const source = readFileSync(mainURL, 'utf8');
	class Element extends EventTarget {
		constructor() {
			super(); this.hidden = false; this.attributes = {};
			this.classList = {
				values: new Set(), add(v) { this.values.add(v); }, remove(v) { this.values.delete(v); },
				toggle(v, on) { on ? this.add(v) : this.remove(v); }
			};
		}
		setAttribute(k, v) { this.attributes[k] = v; }
		removeAttribute(k) { delete this.attributes[k]; }
		focus() {}
	}
	class Input extends Element {}
	class Button extends Element {}
	const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
	const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

	async function playerAt(time = null) {
		let frameId = 0;
		const frames = new Map(), trace = [];
		class AudioPlayer {
			constructor() { this.paused = true; this.duration = 361.745; this._time = 0; this.epoch = 0; }
			get currentTime() { return this._time; }
			set currentTime(n) { this.pause(); this._time = Math.max(0, Math.min(this.duration, n)); trace.push(['seek', this._time]); }
			async load(url) { this.url = url; }
			async play() {
				const epoch = ++this.epoch;
				trace.push(['play', this._time]);
				if (this.pendingResume) await this.pendingResume;
				if (epoch === this.epoch) this.paused = false;
			}
			pause() { ++this.epoch; this.paused = true; trace.push(['pause', this._time]); }
			advance(seconds) {
				if (!this.paused) {
					this._time = Math.min(this.duration, this._time + seconds);
					if (this._time >= this.duration) this.paused = true;
				}
			}
			dispose() { this.pause(); this.disposed = true; }
		}
		class Demo {
			duration = 361.745; rendered = [];
			async init() {}
			render(t) { this.rendered.push(t); trace.push(['render', t]); }
			dispose() { this.disposed = true; }
		}
		const ids = Object.fromEntries(['screen', 'launcher', 'start', 'status', 'debug'].map(id => [id,
			id === 'start' ? new Button() : new Element()
		]));
		const document = new EventTarget(), window = new EventTarget();
		Object.assign(document, { getElementById: id => ids[id], body: new Element(), hidden: false, fullscreenEnabled: false });
		const context = vm.createContext({
			document, window, location: { search: time === null ? '?debug' : `?debug&t=${time}` }, URL, URLSearchParams,
			HTMLInputElement: Input, HTMLButtonElement: Button, navigator: {}, console,
			setTimeout: () => 0, clearTimeout() {},
			requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
			cancelAnimationFrame: id => frames.delete(id)
		});
		const module = new vm.SourceTextModule(source, { context, initializeImportMeta: meta => { meta.url = mainURL.href; } });
		await module.link(specifier => {
			const name = specifier.endsWith('/AudioPlayer.js') ? 'AudioPlayer' : 'Demo';
			return new vm.SyntheticModule([name], function () { this.setExport(name, name === 'Demo' ? Demo : AudioPlayer); }, { context });
		});
		await module.evaluate();
		return {
			player: window.medium, ids, trace,
			async frame(seconds = 0) {
				window.medium.audio.advance(seconds);
				const callbacks = [...frames.values()]; frames.clear();
				callbacks.forEach(callback => callback()); await flush();
			},
			close() { window.dispatchEvent(new Event('pagehide')); }
		};
	}

	test('preview uses demo time without starting or applying the native audio offset twice', async t => {
		const h = await playerAt(95.32); t.after(h.close);
		assert.equal(h.player.ready, true);
		assert.match(h.player.audio.url.href, /\/assets\/medium.mp3$/);
		assert.equal(h.player.audio.duration, h.player.demo.duration);
		assert.equal(h.player.time, 95.32);
		assert.equal(h.player.audio.currentTime, 95.32);
		assert.equal(h.player.audio.paused, true);
		await h.frame(1); assert.equal(h.player.time, 95.32);
	});

	test('live frames, pause and resume follow the output clock without adding another offset', async t => {
		const h = await playerAt(40); t.after(h.close);
		await h.player.play(); await h.frame(0.1); near(h.player.time, 40.1);
		assert.match(h.ids.debug.textContent, /\nplaying$/);
		h.player.pause(); assert.match(h.ids.debug.textContent, /\npaused$/);
		await h.frame(2); near(h.player.time, 40.1);
		await h.player.play(); assert.match(h.ids.debug.textContent, /\nplaying$/);
		await h.frame(0.05); near(h.player.time, 40.15);
	});

	test('playing seek pauses audio before reconstruction and starts again after rendering', async t => {
		const h = await playerAt(195); t.after(h.close);
		await h.player.play(); h.trace.length = 0;
		h.player.seek(95.32); await flush();
		const actions = h.trace.map(entry => entry[0]);
		assert.ok(actions.indexOf('pause') < actions.indexOf('render'));
		assert.ok(actions.indexOf('render') < actions.indexOf('play'));
		assert.equal(h.player.audio.paused, false);
		assert.equal(h.player.time, 95.32);
		await h.frame(0.2); near(h.player.time, 95.52);
	});

	test('native endpoint renders once before stopping and restarting at zero', async t => {
		const h = await playerAt(361.6); t.after(h.close);
		await h.player.play(); await h.frame(0.2);
		assert.ok(h.player.demo.rendered.includes(361.745));
		assert.equal(h.player.time, 0);
		assert.equal(h.player.audio.paused, true);
		assert.equal(h.ids.launcher.classList.values.has('hidden'), false);
		await h.player.play(); await h.frame(0.5); near(h.player.time, 0.5);
		assert.equal(h.ids.launcher.classList.values.has('hidden'), true);
	});

	test('Stop cancels a pending audio resume without hiding the launcher afterward', async t => {
		const h = await playerAt(); t.after(h.close);
		let resume;
		h.player.audio.pendingResume = new Promise(resolve => { resume = resolve; });
		const pending = h.player.play();
		h.player.stop(); resume(); await pending;
		assert.equal(h.player.audio.paused, true);
		assert.equal(h.ids.launcher.classList.values.has('hidden'), false);
		await h.frame(1); assert.equal(h.player.time, 0);
	});

	test('seek during pending resume starts only the newly reconstructed position', async t => {
		const h = await playerAt(195); t.after(h.close);
		let resume;
		h.player.audio.pendingResume = new Promise(resolve => { resume = resolve; });
		const pending = h.player.play();
		h.player.seek(40); resume(); await pending; await flush();
		assert.equal(h.player.audio.paused, false);
		assert.equal(h.player.time, 40);
		await h.frame(0.1); near(h.player.time, 40.1);
	});

	test('leaving the page cancels pending playback and disposes both engines', async () => {
		const h = await playerAt();
		let resume;
		h.player.audio.pendingResume = new Promise(resolve => { resume = resolve; });
		const pending = h.player.play();
		h.close(); resume(); await pending;
		assert.equal(h.player.audio.paused, true);
		assert.equal(h.player.audio.disposed, true);
		assert.equal(h.player.demo.disposed, true);
		assert.equal(h.ids.launcher.classList.values.has('hidden'), false);
	});
}
