import { Demo } from 'medium/Demo.js';
import { AudioPlayer } from 'medium/core/AudioPlayer.js';

const canvas = document.getElementById('screen');
const launcher = document.getElementById('launcher');
const startButton = document.getElementById('start');
const status = document.getElementById('status');
const debug = document.getElementById('debug');
const params = new URLSearchParams(location.search);
const demo = new Demo();
const audio = new AudioPlayer();

async function loadAudio() {
	await audio.load(new URL('../assets/medium.mp3', import.meta.url));
}

let ready = false;
let active = false;
let starting = false;
let renderedTime = 0;
let wakeLock = null;
let frameRequest = 0;
let statusTimer = 0;
let lastDebugTime = -1;
let lastDebugPlaying = null;
let playGeneration = 0;

debug.hidden = !params.has('debug');

function duration() {
	return Number.isFinite(demo.duration) && demo.duration > 0 ? demo.duration : audio.duration;
}

function isPlaying() {
	return active && !audio.paused;
}

function clockTime() {
	return audio.currentTime;
}

function formatTime(value) {
	const seconds = Math.max(0, Math.floor(value || 0));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function showStatus(message, temporary = false) {
	clearTimeout(statusTimer);
	status.textContent = message;
	if (temporary) statusTimer = setTimeout(() => { status.textContent = ''; }, 1600);
}

function updateDebug() {
	const playing = isPlaying();
	if (!debug.hidden && (Math.abs(renderedTime - lastDebugTime) >= 0.1 || playing !== lastDebugPlaying)) {
		debug.textContent = `${renderedTime.toFixed(2)} s / ${duration().toFixed(2)} s\n${playing ? 'playing' : 'paused'}`;
		lastDebugTime = renderedTime;
		lastDebugPlaying = playing;
	}
}

function render(time) {
	renderedTime = Math.max(0, Math.min(duration(), Number(time) || 0));
	demo.render(renderedTime);
	updateDebug();
}

function frame() {
	frameRequest = 0;
	if (!active) return;
	try {
		const time = clockTime();
		if (time >= duration()) { render(duration()); stop(); return; }
		if (!isPlaying()) { updateDebug(); return; }
		render(time);
		frameRequest = requestAnimationFrame(frame);
	} catch (error) {
		pause();
		showStatus(`Unable to render: ${error.message || error}`);
		console.error(error);
	}
}

function requestFrame() {
	if (!frameRequest && isPlaying()) frameRequest = requestAnimationFrame(frame);
}

async function requestWakeLock() {
	if (!navigator.wakeLock || wakeLock || !isPlaying() || document.hidden) return;
	try {
		const lock = await navigator.wakeLock.request('screen');
		if (wakeLock || !isPlaying() || document.hidden) {
			await lock.release();
			return;
		}
		wakeLock = lock;
		lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
	} catch { /* Screen wake lock is optional. */ }
}

function releaseWakeLock() {
	const lock = wakeLock;
	wakeLock = null;
	lock?.release().catch(() => {});
}

async function play() {
	if (!ready || starting || isPlaying()) return;
	if (clockTime() >= duration()) seek(0);
	const generation = ++playGeneration;
	starting = true;
	try {
		await audio.play();
		if (generation !== playGeneration || audio.paused) return;
		active = true;
		launcher.classList.add('hidden');
		launcher.setAttribute('aria-hidden', 'true');
		launcher.inert = true;
		showStatus('');
		updateDebug();
		requestFrame();
		requestWakeLock();
	} catch (error) {
		if (generation === playGeneration) {
			showStatus(`Unable to play audio: ${error.message || error}`);
			console.error(error);
		}
	} finally {
		if (generation === playGeneration) starting = false;
	}
}

function pause() {
	playGeneration++;
	starting = false;
	audio.pause();
	cancelAnimationFrame(frameRequest);
	frameRequest = 0;
	releaseWakeLock();
	if (ready) updateDebug();
}

function seek(seconds) {
	if (!ready) return 0;
	const target = Math.max(0, Math.min(duration(), Number(seconds) || 0));
	const wasPlaying = isPlaying() || starting;
	// Reconstruction may replay minutes of simulation. Hold the soundtrack
	// first, then establish a fresh scheduled audio start after rendering.
	pause();
	audio.currentTime = target;
	render(target);
	if (wasPlaying) play();
	return target;
}

function stop() {
	pause();
	active = false;
	if (ready) seek(0);
	launcher.classList.remove('hidden');
	launcher.removeAttribute('aria-hidden');
	launcher.inert = false;
	showStatus('');
	startButton.focus({ preventScroll: true });
}

async function fullscreen() {
	if (!document.fullscreenEnabled) return;
	try {
		if (document.fullscreenElement) await document.exitFullscreen();
		else await document.documentElement.requestFullscreen();
	} catch (error) { showStatus(error.message || String(error), true); }
}

startButton.addEventListener('click', play);
canvas.addEventListener('click', () => { if (active) isPlaying() ? pause() : play(); });

document.addEventListener('keydown', event => {
	if (event.key === 'Escape' && active) { stop(); return; }
	if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
	if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
		event.preventDefault();
		if (!event.repeat) isPlaying() ? pause() : play();
	} else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && active) {
		event.preventDefault();
		const target = seek(renderedTime + (event.key === 'ArrowLeft' ? -5 : 5));
		showStatus(formatTime(target), true);
	} else if (event.code === 'KeyF' && !event.repeat) {
		fullscreen();
	}
});

document.addEventListener('visibilitychange', () => {
	if (document.hidden) releaseWakeLock();
	else requestWakeLock();
});
window.addEventListener('pagehide', () => {
	pause();
	demo.dispose?.();
	audio.dispose();
});

// Stable hooks for deterministic captures and browser playback checks.
window.medium = { demo, audio, play, pause, seek, stop, get ready() { return ready; }, get time() { return renderedTime; } };

try {
	await Promise.all([demo.init(canvas), loadAudio()]);
	audio.duration = demo.duration;
	ready = true;
	render(0);
	startButton.disabled = false;
	startButton.textContent = 'start';
	if (params.has('t')) {
		active = true;
		launcher.classList.add('hidden');
		launcher.setAttribute('aria-hidden', 'true');
		launcher.inert = true;
		seek(Number(params.get('t')) || 0);
	}
} catch (error) {
	startButton.textContent = 'unavailable';
	showStatus(`Unable to load medium: ${error.message || error}`);
	console.error(error);
}
