# Reconstructing Medium

This port was reconstructed from the released 32-bit Windows executable and its packed assets. The JavaScript expresses the recovered algorithms directly; the original executable is used as evidence and as input to the extraction and verification tools. The browser runs ES modules through the import map in `index.html`.

The starting files are `medium.exe`, `packfile.pak`, and `file_id.diz` from the [original release](https://files.scene.org/view/parties/2001/theparty01/demo/medium.zip). Place them in the Git-ignored `original/` directory to rerun native checks. Addresses below are virtual addresses in the executable, whose image base is `0x400000`. The working disassembly, `notes/medium.asm`, is generated investigation material and is not included in the repository. Original filenames and strings were treated as program data.

## Assets recovered without replacement

The archive contains 55 entries: 52 bitmap files, two ES model files, and one MP3. The bitmap count includes three pairs of color and alpha files. The browser assets retain the original image pixels, mesh data, and soundtrack; procedural geometry is rebuilt from the executable's formulas.

[tools/extract.py](../tools/extract.py) implements the archive decoder at `0x41b4e0` and the readers at `0x41b890`, `0x41b0c0`, and `0x412b80`:

- The directory consists of 80-byte records: four little-endian 32-bit integers followed by a 64-byte filename. The integers specify packed size, file offset in 2048-byte sectors, allocation size, and unpacked size. An empty filename ends the directory.
- Compressed streams skip an eight-byte prefix and contain literal runs, zero runs, and backward references. The port translates this bytecode directly. Two entries are stored uncompressed.
- `.bmp` files become PNGs. Each `.bma`/`.bmc` pair becomes a PNG with the original color and grayscale alpha channels. Original directory names are retained in lowercase under `assets/textures/`.
- The MP3 is copied byte-for-byte to [assets/medium.mp3](../assets/medium.mp3).
- ES model files become [makina.json](../assets/models/makina.json) and [makina2.json](../assets/models/makina2.json), with their embedded BGRA images exported separately.

Each ES file contains two 256 × 256 textures and four meshes. Their vertex/triangle counts are 1280/2048, 848/1136, 1224/1680, and 2382/2516. The fourth mesh has twelve distinct animation frames. The reader preserves signed integer positions, packed normals, vertex colors, UVs, triangle indices, material batches, and original header fields. These ES files contain flattened meshes; object transformations and camera choreography come from the executable.

[assets/inventory.json](../assets/inventory.json) records unpacked sizes and SHA-256 hashes. [tools/verify-assets.py](../tools/verify-assets.py) independently runs the original decompression routine in Unicorn: all 53 compressed entries match the Python output byte-for-byte. It also checks the two raw entries and the delivered soundtrack. The recorded result is [asset-validation.json](asset-validation.json). [tests/models.test.js](../tests/models.test.js) checks topology, coordinate bounds, material references, attribute lengths, and preservation of all animation frames.

## Executable to JavaScript map

| Effect | Constructor / initialization | Commands | Millisecond update | Render | Port |
| --- | --- | --- | --- | --- | --- |
| Tunnel, ID 1 | `0x40f170` / `0x40f2d0` | `0x40f4d0` | `0x40faf0` | `0x4108c0` | [Tunnel.js](../src/effects/Tunnel.js) |
| Comic, ID 4 | `0x409d20` / `0x409fa0` | `0x40a110` | `0x40a750` | `0x40a850` | [Comic.js](../src/effects/Comic.js) |
| Makina, ID 5 | `0x40d4e0` / `0x40d650` | `0x40d7b0` | `0x40db10` | `0x40dbf0` | [Makina.js](../src/effects/Makina.js) |

Tunnel rebuilds the 96 eight-by-eight surface patches and the crossed equalizer strips. Comic implements the bent tube and the two deforming cube-spheres; the source formulas include radial forces, spring motion, and texture coordinates derived from normals. Makina uses the extracted meshes, interpolates their twelve animation frames, and reconstructs the six camera modes and the eight room corners, each made of three quads.

The original invokes the secondary effect's Render callback before the primary effect's callback. These callbacks transform vertices using shared camera state and enqueue material buckets; the later GPU flush uses material registration order. Tunnel patches draw before Comic, then Makina, with additive bars in a second pass. Preserving only callback order would let tunnel patches obscure Comic's foreground objects. Near the ending, secondary Makina inherits the primary Tunnel camera. [Demo.js](../src/Demo.js) preserves both the camera relationships and the material draw order. Offset-based names such as `flagA8` remain where the original author's field names could not be recovered.

## Timing and reproducible state

The native main loop calls `0x40c160` once per elapsed millisecond. [Timeline.js](../src/core/Timeline.js) preserves that cadence and float32 clock updates. The embedded BPM is `134.60000610351562`; patterns contain sixteen rows, and the initial row is ten.

The recovered sequence contains 204 pattern references and 423 dispatched commands. [tools/extract-timeline.py](../tools/extract-timeline.py) produces [assets/timeline.json](../assets/timeline.json). [tools/verify-timeline.py](../tools/verify-timeline.py) executes 361745 native sequencer ticks under Unicorn and compares all command ticks, channels, and values. All 423 match. Rendering, effect callbacks, and the global command handler are stubbed in this harness, so this result establishes sequencing correctness rather than complete visual equivalence.

[Native clock samples](../tests/fixtures/native-timeline.json) also exercise the JavaScript row clocks and pulse envelopes. Tests cover layer switches, the eight-row skip, the 597 ms effect freeze during photo overlays, backward seeking, and the final sequencer tick. [sequence.md](sequence.md) gives the detailed address and event map. Overlay placement and alpha are checked against [native render samples](../tests/fixtures/native-overlays.json).

The native audio clock follows generated PCM samples, with a significant lead over audible playback. DirectSound initialization at `0x41cf30` creates a 131072-byte ring containing 32768 stereo frames at 44100 Hz. The refill routine at `0x41d140` writes the region that the play cursor has just consumed; those samples become audible one ring later. The clock wrapper at `0x41d2d0` converts generated frames plus the current consumed-region delta into integer milliseconds using `frames * 1000 / 44100`. It aligns a wall-clock origin on the first refill and subsequently adjusts that origin by 1 ms when the error exceeds a ±10 ms band. It does not subtract the ring duration.

MP3 initialization at `0x404fe0` also decodes and discards the first 1152-sample frame. Consequently, the canonical first audible sample occurs at demo time `32768 / 44100 = 0.743038549` seconds and corresponds to source MP3 time `1152 / 44100 = 0.026122449` seconds. Once playback begins, the mapping is:

```text
demoTime = sourceMp3Time + (32768 - 1152) / 44100
         = sourceMp3Time + 0.716916100 seconds
```

[AudioPlayer.js](../src/core/AudioPlayer.js) preserves this opening silent pre-roll, source skip, and mapping. It uses the Web Audio playback-output clock to account for the browser's output delay. The native main loop subtracts its initial `GetTime` result, but this captures only the host-dependent time spent in the final effect resets after audio-clock Start; audio refilling has not yet begun. The port's reproducible startup profile uses zero elapsed milliseconds for that baseline. Initial tracker row ten is the authored sequence phase and adds no further audio-time offset.

[tools/verify-audio-clock.py](../tools/verify-audio-clock.py) executes the original refill, clock wrapper, Start/GetTime, and mainloop tick-delta instructions with simulated DirectSound COM endpoints and tagged PCM samples. The [fixture](../tests/fixtures/native-audio-clock.json) verifies ring wraps and startup baselines of 0, 2, and 7 ms; none cancels the ring lead. An optional FFmpeg comparison of actual native-decoded PCM confirms the 1152-sample shift, with approximately −0.999999 correlation from the native decoder's inverted polarity.

The sequencer endpoint remains **361.745 seconds of demo time**, corresponding to source MP3 time approximately **361.028084 seconds**. The roughly 361.195-second MP3 therefore has its final 167 ms cut at the canonical endpoint; there is no extra silent tail after the soundtrack. The native program can add its final presentation/shutdown latency, which the deterministic browser transport omits. The roughly +0.32 to +0.35-second alignment used for reference-video frame comparisons describes that recording's timeline and is separate from this source-audio clock mapping.

The random generator at `0x41bc00` is a shared two-word stream. Camera phase changes, photo offsets, and Tunnel resets consume that same stream. The port selects a fixed startup profile: a system-time sum divisible by 101 and 32-bit texture conversion without dithering. It reproduces the two startup Tunnel resets and subsequent stream consumption for that profile. [tools/verify-startup-rng.py](../tools/verify-startup-rng.py) checks 579 native random words and three sets of Tunnel particle positions; [startup-rng.json](../tests/fixtures/startup-rng.json) is the captured fixture. An arbitrary launch of the Windows executable can select different startup random consumption.

## Math, projection, and materials

[Math.js](../src/core/Math.js) reconstructs the integer quarter-wave sine-table generator at `0x41baa0`, the lookup functions at `0x41bc60`/`0x41bcc0`, and fixed-point matrix products from `0x41c840`. A full turn is 65536 angle units. The native projector subtracts both projected coordinates from the screen center. Camera conversion therefore reverses the native right and forward axes when constructing a Three.js camera.

The native camera has finite near and far planes at **8 and 10240 in prepared view space**, equivalent to 32 and 40960 raw world units. Before projection, `0x41a980` transposes the camera basis and scales it by `0x4000` (one quarter); the object translation receives the same scale. `NativeCamera` preserves this scale as well as reflected camera bases. Screen X/Y are unchanged by a uniform view scale, but clipping and fog depend on it. The camera constructor at `0x418190` stores the clip limits, and `0x418260` emits near/far flags. `0x41a4b0` discards polygons entirely beyond a plane; `0x414390` clips crossing polygons.

[tools/verify-projection.py](../tools/verify-projection.py) checks the projector in isolation against 54 native vertices and five quad submissions. [tools/verify-view-transform.py](../tools/verify-view-transform.py) additionally executes the real camera/object preparation before projection and fog, checking 44 vertices across identity, translated, rotated and reflected cameras. The [projection tests](../tests/projection.test.js) verify both stages independently, including the raw-world far boundary at 40960. The earlier analysis mistook prepared view units for raw world units.

The Direct3D texture-stage calls at `0x415850` determine the shader combinations. With `T0` and `T1` denoting sampled textures and `D` the vertex diffuse color, the recovered operations are:

| Material | RGB stages | Alpha / framebuffer blending |
| --- | --- | --- |
| Tunnel `0x41474705` | Clamp `2 × T0 × D`, then add `T1` and clamp | `T0.a × D.a × T1.a`; source alpha / inverse source alpha |
| Bars `0x41575702` | `T0 × D`, then add `T1` and clamp | `T0.a × D.a`; source alpha / one |
| Comic, low byte `4` | `T0 × D`, then multiply by `2 × T1` and clamp | Opaque framebuffer writes |
| Makina `0x40030301` | `T0 × D`, then add the highlight texture sampled using transformed normals and clamp | `T0.a × D.a`; source alpha / inverse source alpha |

The two texture stages have separate filtering and addressing flags. The bitmap loader converts BMP rows to top-down engine pixels, so those textures use `flipY = false`. Comic uses separate light and camera frames for its normal-derived texture coordinates: the light frame is identity for the blobs, and the pre-object orbit basis for the tube. Its grayscale diffuse color uses the original high-byte quantization. [tools/verify-comic-lighting.py](../tools/verify-comic-lighting.py) checks these frames in eight native samples. Makina retains the source normals and winding: the original cull mode and projection correspond to `BackSide` for these meshes in the port. Shared fog state is significant too: the released sequence disables fog strength before the machine section.

[Fog.js](../src/core/Fog.js) implements the original vertex fog byte, including rounding to even. [tools/verify-overlays.py](../tools/verify-overlays.py) checks 56 native samples covering image placement, alpha, Tunnel lighting and fog. The Tunnel lighting accumulation is overwritten in the released binary at `0x410fc9`; the surviving color comes from beat channel 1. Shared projection, fog and clear colors follow effect selection and camera commands.

## Visual corrections and fidelity limits

The frame comparison prompted corrections to Tunnel's bar coordinates, vertex RGBA, texture-stage blending, and camera reflection. The native look-at camera can have a reflected basis; Three.js normally removes camera scaling from its view matrix. `NativeCamera` preserves that reflected view. The bar oracle checks 10,240 complete vertex records, and the camera oracle checks twelve states plus five projected bar points (within 0.032 screen pixels). Comic camera modes 3 and 4 now use the native quarter-turn remapping of the tube basis, verified against eight x86 transform samples.

The missing Comic enclosure and excessive haze had the same cause: the omitted quarter-scale view transform. A reconstructed enclosure point at raw depth about 15777 has native prepared depth about 3944, inside the original far limit. The port now uses the original clip limits for every effect; the earlier Comic-only far=32768 workaround and `?native-clipping` option have been removed. The foreground silhouette still supports a canonical 60 Hz spring cadence: its single-frame overlap is approximately 0.943, compared with 0.523 at 200 Hz. These are limited, manually aligned silhouette measurements, not whole-image similarity scores; see [comic-reference-fit.json](comic-reference-fit.json).

Comic also adds camera shake when it inherits the Tunnel camera. Tunnel constructs that camera during Tick, before render-time damping; Comic's secondary Render modifies it, and the primary Tunnel Render retains the displacement. During photo freezes, repeated Render calls accumulate the offset until the next Tunnel Tick. Timeline stores this canonical history and the last Tick camera inputs so paused renders and backward seeks remain deterministic. [tools/verify-shared-camera.py](../tools/verify-shared-camera.py) traces shared-camera writes through the real dispatcher at four points and repeats each Render without Tick.

No scene clears the frame between layers. Native camera byte `+0x59` is initialized to 1 at `0x4181cd`, selecting a color-and-depth clear at `0x4157a5`; this happens once before effect rendering. The port likewise clears once and preserves both layers. [Composition tests](../tests/composition.test.js) cover shared-camera ordering for Comic/Tunnel and Makina/Tunnel combinations.

This is a reconstructed implementation with verified assets and sequencing. It has not been established as pixel-identical to the Windows executable over every frame.

Comic rotation clocks are not initialized by the released constructor or Reset. Native experiments with large or non-finite heap values reproduce stationary identity rotations while preserving the camera and Tube. That behavior matches both video 175.0 and 224.8; it is the default playback profile, represented symbolically without inventing heap bytes. The original memory values are unknown. The independent zero-start emulation profile remains available. See [comic-startup-rows.md](comic-startup-rows.md) for the evidence, six native startup fixtures, and limitations.

[ComicNormals.js](../src/effects/ComicNormals.js) reproduces forward-difference normals, lookup normalization, and seam lighting copies. Tube local coordinates and packed normals have complete native fixtures. Makina morph coordinates, normals, diffuse bytes, and normal-derived UVs are checked across 25,760 Makina vertex records, alongside 18,432 Tunnel records. The original material mesh list repeats one submesh; that behavior is preserved.

All 98 mip levels in the 11 mipmapped textures use the original rounded box filter, verified byte for byte against `0x412200`. Explicit mip sidecars avoid browser-dependent mip generation. See [texture-upload.md](texture-upload.md). MSAA is disabled: the original D3D7 renderer leaves antialiasing at its disabled default.

Three.js/WebGL replaces the Direct3D renderer. Rasterization, clipping, interpolation, texture filtering, color precision, antialiasing, and driver behavior can differ. Some effect calculations use JavaScript floating-point arithmetic where the native engine used x87 or integer intermediate results.

The native engine caches projection, GPU fog enable/color, and the fog slope at frame start, before effect rendering changes the shared camera. Camera basis/position and the vertex fog thresholds remain live. The port preserves that split on its canonical 60 Hz frame schedule. At 225.350 seconds, new mode 0 geometry uses the previous mode 3 lens (1.0); the next frame uses 0.25. This reproduces the brief enlarged composition in the reference at video 225.000. [tools/verify-render-cache.py](../tools/verify-render-cache.py) executes frame preparation, the real Tube allocator/clipper, and three complete native Tube draws. Tests check 150 projected vertices, 54 fog cases, and deterministic seeking across the cut.

The native renderer also changes simulation state during rendering. Comic's spring integration and Tunnel's render-time damping are advanced at a canonical 60 Hz in the port, while the sequencer continues at its original 1 ms cadence. During photo overlays the effect clocks freeze, but rendering and its spring/damping steps continue; the separate `onRenderTick` callback preserves that distinction. This makes seeking reproducible, but a native run at a different rendering frame rate can evolve differently. The fixed startup random profile described above is another deliberate source of repeatability.

There is no fixed frame-rate cap in the native main loop (`0x40d090`). Fullscreen presentation calls `Flip(NULL, DDFLIP_WAIT)` at `0x420381`, using the display mode’s default refresh rate; the `-w` windowed path uses a waiting blit without an explicit vertical-blank wait. These paths can evolve render-dependent geometry at different rates. [Microsoft’s DirectDraw documentation](https://learn.microsoft.com/en-us/windows/win32/api/ddraw/nf-ddraw-idirectdrawsurface7-flip) describes the flip synchronization. A recording’s output frame rate alone does not establish the executable’s render-call cadence.

## Reproducing the checks

From the repository root, create a Python environment and install [tools/requirements.txt](../tools/requirements.txt), then run:

```sh
python tools/verify-assets.py
python tools/verify-timeline.py
python tools/verify-audio-clock.py
python tools/verify-startup-rng.py original/medium.exe
python tools/verify-overlays.py
python tools/verify-projection.py
python tools/verify-view-transform.py
python tools/verify-comic-pipeline.py
python tools/verify-material-order.py
python tools/verify-tunnel-bars.py
python tools/verify-tunnel-camera.py
python tools/verify-comic-transforms.py original/medium.exe
python tools/verify-comic-lighting.py original/medium.exe
python tools/verify-comic-row-profile.py
python tools/verify-render-cache.py
python tools/verify-shared-camera.py
python tools/verify-effect-vertices.py
python tools/verify-mips.py
npm test
```

The Python verification scripts emulate selected native routines without launching the Windows program. Generated fixtures and reports are inspectable alongside the JavaScript tests.

To reproduce the optional PCM alignment comparison as well, install FFmpeg and run `python tools/verify-audio-clock.py --compare-decoder ffmpeg`.
