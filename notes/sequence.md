# Medium executable timeline reconstruction

The source binary is the original 352256-byte `medium.exe` from the [original release](https://files.scene.org/view/parties/2001/theparty01/demo/medium.zip), with image base `0x400000`. Recovered file strings and data were treated as program evidence, not instructions. [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md) describes the asset formats, rendering, and remaining fidelity limits.

## Main flow and timing

- `0x40d090` is the demo main loop; `0x40b290` initializes effects, textures, and audio.
- `0x40d129` computes elapsed integer milliseconds. `0x40d13e` calls `0x40c160` once per elapsed millisecond, independent of render frame rate.
- `0x40b30a` sets the float BPM to `134.60000610351562` (bits `0x4306999a`).
- `0x40c160` advances the tracker row by `float32(BPM * (1/15) * .001)`. Each pattern has 16 rows. The global beat/clock row at `0x460178` and song row at `0x45e968` start at `10.0`.
- `0x46017c`, `0x460180`, and `0x460184` are row clocks wrapping at 32, 64, and 128.
- The sequence at `0x44d788` has 204 pattern pointers and terminates at `0x44dab8`. There are 129 distinct patterns. Each pattern consists of 16 records, with four `uint32` values per record. Column 0 dispatches to the primary layer; column 2 dispatches to the secondary layer. Columns 1 and 3 are unused in this build.
- When a command changes to a nonzero, nonspace value, the global handler at `0x40bac0` executes first, followed by the current effect's vtable slot `+8`. Consecutive identical row values are intentionally not retriggered; separated equal values are retriggered.
- Special primary command `255` at tick `182544` adds eight to all five row clocks, skipping eight rows. The next row-8 command appears 1 ms later.
- The sequencer terminates at tick `361745`, or 361.745 seconds of demo time. Under the native audio mapping below, this corresponds to source MP3 time approximately 361.028084 seconds; playback ends there.

[assets/timeline.json](../assets/timeline.json) was generated through float32 simulation at 1 ms intervals. Independent verification emulated the original x86 routine at `0x40c160` for 361745 calls using Unicorn. All 423 command events matched the tick, channel, and code exactly. Effect graphics callbacks and the global command dispatcher were stubbed; timing, row arithmetic, event-change detection, and skip handling executed natively. Reproduce this check with `python tools/verify-timeline.py`. [Native clock samples](../tests/fixtures/native-timeline.json) are checked by `node --test tests/timeline.test.mjs`.

## Audio playback clock

The original visual clock leads the audible soundtrack. Its DirectSound ring holds 32768 stereo sample frames at 44100 Hz, or 0.743038549 seconds. The MP3 initializer discards one 1152-sample frame, so the first audible native sample corresponds to source MP3 time 0.026122449 seconds. Canonical playback begins with a silent pre-roll and then follows:

```text
first audible sample: demo 0.743038549 s, source MP3 0.026122449 s
demoTime = sourceMp3Time + 31616 / 44100
         = sourceMp3Time + 0.716916100 s
```

The relevant native operations are:

- `0x41cf30`: creates and starts a silent `0x20000`-byte, 16-bit stereo, 44100 Hz looping buffer.
- `0x41d140`: reads the play cursor, converts byte positions to stereo frames, and refills the consumed region behind that cursor in multiples of 64 frames. Newly written samples reach playback one complete ring later.
- `0x41d2d0`: computes `generatedFrames + consumedDelta`, converts that count to integer milliseconds with `* 1000 / 44100`, and aligns a wall-clock origin. Later refills adjust the origin by ±1 ms outside a ±10 ms error band.
- `0x404fe0`: consumes the first MP3 frame during initialization; subsequent `0x405090` calls supply audio output. The discarded frame contains 1152 stereo samples.
- `0x41d370` / `0x41d3a0`: Start resets the generated-frame count and origin; GetTime returns wall time minus that origin. Startup calls Start at `0x40b960`, then resets both effects. The main loop saves its initial GetTime at `0x40d0b0`, before the first audio refill. That subtraction removes only the elapsed final-reset time, not the ring lead. The reproducible port uses a zero-millisecond startup baseline.

Initial row `10.0` is already part of the recovered tracker state; it adds no separate audio offset. [AudioPlayer.js](../src/core/AudioPlayer.js) schedules the native pre-roll and skip, while reporting demo time to the transport and sequencer. The native 361.745-second endpoint cuts approximately the final 167 ms of the 361.195-second source MP3. It does not append a silent tail.

[tools/verify-audio-clock.py](../tools/verify-audio-clock.py) executes the original clock and refill instructions with tagged samples in a simulated DirectSound ring, including mainloop tick accumulation and 0/2/7 ms startup baselines. [native-audio-clock.json](../tests/fixtures/native-audio-clock.json) records the results. The optional `--compare-decoder ffmpeg` check confirms the exact 1152-sample shift against modern PCM decoding. The roughly +0.32 to +0.35-second offset used to align reference-video frames is a separate recording alignment and must not replace this audio mapping.

## Effect layers

| ID | Effect | Constructor | Initialization | Command | Tick | Render |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Tunnel | `0x40f170` | `0x40f2d0` | `0x40f4d0` | `0x40faf0` | `0x4108c0` |
| 4 | Comic | `0x409d20` | `0x409fa0` | `0x40a110` | `0x40a750` | `0x40a850` |
| 5 | Makina | `0x40d4e0` | `0x40d650` | `0x40d7b0` | `0x40db10` | `0x40dbf0` |

Initially, Tunnel is the primary layer and Comic is the secondary layer. Both have tick and render callbacks; the secondary layer renders before the primary layer. Commands `0x10001 + n` select primary effect ID `n` and initialize it; `0x10010001 + n` select the secondary effect. The sequence changes layers as follows:

- Tick `247627`: primary becomes Makina.
- Tick `354613`: primary becomes Tunnel; secondary becomes Makina.
- Tick `359962`: secondary becomes Comic.

Effects share native camera state. At the ending, secondary Makina has automatic camera control disabled and uses the camera supplied by Tunnel.

## Shared beat signals

`0x43e544` contains a four-pattern cyclic beat track. Each pattern has 16 rows of 17 `uint32` values. A nonzero column 0 sets the current primary effect's bit flags at offset `+8`. The next eight columns trigger beat targets when the corresponding global masks at `0x45e9dc` through `0x45e9e3` are enabled. Targets rise to 65536 and decay by 96 per smoothing pass by default. Every millisecond performs two smoothing passes:

```js
target = Math.max(0, target - decay);
beat[i] = ((beat[i] * 7 + target) << 9) >> 12;
```

These eight integers occupy effect object offsets `0xc` through `0x28`.

The envelope calculations use the native floating-point cosine and sine functions at `0x41ba90` and `0x41ba80`. The PI constant in the data is `3.141592654`. Global `0x45ea04` is a cosine kick envelope; `0x45ea4c` is its spring-filtered version, reproduced in [Timeline.js](../src/core/Timeline.js). Globals `0x45e9e8` and `0x45eee4` are cosine envelopes eight rows out of phase, used for machine animation frames. Global `0x45e9e4` is another half-bar cosine pulse.

## Overlay images

Global commands `0xd0` through `0xed` map to 30 filenames at `0x44db58`:

- `0xd0` through `0xd4`: five credit images displayed for 2048 ms, solid during the first half and fading during the second.
- `0xd5`: the Einklang logo, displayed as a moving 512-pixel square for 16384 ms.
- `0xd6` through `0xed`: artwork displayed for 896 ms. Each source image is split into a 3 × 3 grid with individual alpha and offsets. Sources are 768 × 576 pixels, so the last row is 64 pixels high.

The artwork overlays freeze both effect tick callbacks for the first 597 ms. Effect rendering still runs: `0x40cc96` calls the secondary and primary render callbacks before checking overlay age. Comic springs and Tunnel render-time damping therefore continue at their canonical 60 Hz cadence while effect ages stay fixed. Native overlay rendering starts at `0x40cc90`. [Native overlay samples](../tests/fixtures/native-overlays.json) verify placement and alpha against [the overlay tests](../tests/overlays.test.mjs).

## Randomness and fidelity limits

The PRNG recurrence at `0x41bc00` is reproduced exactly, starting from state words `1118820455` and `1922350462`. Camera phases, photo offsets, and Tunnel particle resets consume one shared stream. Startup consumption is reproduced for a fixed profile: the native system-time sum is divisible by 101, giving an initial random skip of zero, and textures use 32-bit conversion without dithering. Both startup Tunnel resets are included.

[tools/verify-startup-rng.py](../tools/verify-startup-rng.py) executes the native reset and random routines and verifies 579 random words and three sets of 96 Tunnel particle positions. The captured data is in [startup-rng.json](../tests/fixtures/startup-rng.json). Native startup can consume a different number of words depending on the system clock and texture conversion/dithering path. The port fixes this profile to make playback and seeking reproducible.

Angle and camera fields follow the recovered source behavior. Names such as `flag11d` identify object offsets where the original author's names are unavailable. The native timeline checks establish sequencing correctness, not pixel equivalence of WebGL materials, lighting, or rasterization. Render-time simulation advances at a canonical 60 Hz in the port; native runs at other rendering frame rates can evolve differently.

## Reproduction

```sh
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt
.venv/bin/python tools/extract-timeline.py
.venv/bin/python tools/verify-timeline.py
.venv/bin/python tools/verify-audio-clock.py
.venv/bin/python tools/verify-startup-rng.py original/medium.exe
node --test tests/timeline.test.mjs
```

The timeline scripts default to `original/medium.exe` and `assets/timeline.json`. Use `--exe` and `--output` / `--timeline` to select other paths. `verify-timeline.py --snapshots path.json` writes freshly emulated clock samples.
