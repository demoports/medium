// Native DirectSound starts with an empty 32768-frame stereo ring. Its MP3
// initializer consumes one 1152-sample frame before filling that ring.
export const SAMPLE_RATE = 44100;
export const MP3_SKIP = 1152 / SAMPLE_RATE;
export const RING_DURATION = 32768 / SAMPLE_RATE;
export const NATIVE_LEAD = (32768 - 1152) / SAMPLE_RATE;

export function sourceSchedule(timelineTime) {
	return {
		delay: Math.max(0, RING_DURATION - timelineTime),
		offset: Math.max(MP3_SKIP, timelineTime - NATIVE_LEAD)
	};
}

export function timelineTimeFromMP3(mp3Time) {
	return mp3Time + NATIVE_LEAD;
}

// Output timestamps already include the device's output delay. Subtracting
// outputLatency again would apply it twice. The latency sum is only a fallback.
export function audibleContextTime(context, performanceTime) {
	const current = context.currentTime;
	if (context.state === 'running' && typeof context.getOutputTimestamp === 'function') {
		const stamp = context.getOutputTimestamp();
		if (Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime)
			&& (stamp.contextTime !== 0 || stamp.performanceTime !== 0)) {
			const time = stamp.contextTime + (performanceTime - stamp.performanceTime) / 1000;
			return Math.max(0, Math.min(current, time));
		}
	}
	const latency = name => Number.isFinite(context[name]) ? Math.max(0, context[name]) : 0;
	return Math.max(0, current - latency('baseLatency') - latency('outputLatency'));
}

export class AudioPlayer {
	constructor({ duration = 361.745, context = null, createContext, fetch: fetchAudio, now } = {}) {
		if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Invalid timeline duration');
		this._duration = duration;
		this._context = context;
		this._createContext = createContext ?? (() => {
			const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
			if (!Context) throw new Error('Web Audio is unavailable in this browser.');
			return new Context({ latencyHint: 'interactive' });
		});
		this._fetch = fetchAudio ?? ((url) => globalThis.fetch(url));
		this._now = now ?? (() => performance.now());
		this._buffer = null;
		this._source = null;
		this._position = 0;
		this._lastTime = 0;
		this._playing = false;
		this._disposed = false;
		this._epoch = 0;
		this._pendingPlay = null;
	}

	get context() { return this._context; }
	get duration() { return this._duration; }
	set duration(value) {
		if (!Number.isFinite(value) || value <= 0) throw new RangeError('Invalid timeline duration');
		const current = this.currentTime;
		this._duration = value;
		this._position = Math.min(this._position, value);
		this._lastTime = Math.min(this._lastTime, value);
		if (this._playing && current >= value) this.pause();
		else if (this._playing && this._source) this._source.stop(this._anchorContext + value - this._anchorTimeline);
	}

	get currentTime() {
		if (!this._playing) return this._position;
		const output = audibleContextTime(this._context, this._now());
		const time = this._anchorTimeline + output - this._anchorContext;
		// A device timestamp can move slightly backward. Replaying an earlier
		// canonical frame would otherwise reset the whole visual simulation.
		this._lastTime = Math.min(this._duration, Math.max(this._lastTime, time));
		if (this._lastTime >= this._duration) {
			this._position = this._duration;
			this._playing = false;
			this._stopSource();
		}
		return this._lastTime;
	}

	set currentTime(value) {
		this.pause();
		this._position = this._lastTime = Math.max(0, Math.min(this._duration, Number(value) || 0));
	}

	get paused() {
		this.currentTime;
		return !this._playing;
	}

	async load(url) {
		if (this._disposed) throw new Error('AudioPlayer has been disposed.');
		this._context ??= this._createContext();
		const response = await this._fetch(url);
		if (!response.ok) throw new Error(`Soundtrack: HTTP ${response.status}`);
		const buffer = await this._context.decodeAudioData(await response.arrayBuffer());
		if (this._disposed) throw new Error('AudioPlayer has been disposed.');
		this._buffer = buffer;
		return this;
	}

	async play() {
		if (this._disposed) throw new Error('AudioPlayer has been disposed.');
		if (!this._buffer) throw new Error('The soundtrack has not loaded.');
		if (!this.paused || this._position >= this._duration) return;
		if (this._pendingPlay) return this._pendingPlay;
		const epoch = ++this._epoch;
		const pending = (async () => {
			try { await this._context.resume(); }
			catch (error) {
				if (epoch !== this._epoch || this._disposed) return;
				throw error;
			}
			if (epoch !== this._epoch || this._disposed) return;
			const target = this._position;
			this._anchorContext = this._context.currentTime;
			this._anchorTimeline = this._lastTime = target;
			const { delay, offset } = sourceSchedule(target);
			if (delay < this._duration - target && offset < this._buffer.duration) {
				const source = this._context.createBufferSource();
				source.buffer = this._buffer;
				source.connect(this._context.destination);
				source.onended = () => {
					source.disconnect();
					if (this._source === source) this._source = null;
				};
				source.start(this._anchorContext + delay, offset);
				// The sequencer end is authoritative; the native demo cuts the
				// final part of the MP3 instead of extending its animation tail.
				source.stop(this._anchorContext + this._duration - target);
				this._source = source;
			}
			this._playing = true;
		})();
		this._pendingPlay = pending;
		try { await pending; }
		finally { if (this._pendingPlay === pending) this._pendingPlay = null; }
	}

	pause() {
		this._position = this.currentTime;
		this._lastTime = this._position;
		this._playing = false;
		this._epoch++;
		this._pendingPlay = null;
		this._stopSource();
	}

	_stopSource() {
		const source = this._source;
		this._source = null;
		if (source) {
			source.onended = null;
			source.stop();
			source.disconnect();
		}
	}

	dispose() {
		if (this._disposed) return;
		this.pause();
		this._disposed = true;
		this._buffer = null;
		this._context?.close().catch(() => {});
	}
}

export default AudioPlayer;
