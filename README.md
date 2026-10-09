# medium

A JavaScript / Three.js port of [medium by einklang.net](https://www.pouet.net/prod.php?which=4771), released at The Party 2001. Reconstructed from the Windows executable using the original textures, models, artwork and soundtrack.

Uses ES modules, an import map, WebGL 2 and Web Audio.

Space or click to pause · ← → seek · F fullscreen · Esc stop.

## Reconstruction notes

The executable was disassembled to recover the sequencer, cameras, and Tunnel, Comic and Makina effects. Textures, artwork, animated models and the soundtrack were extracted from `packfile.pak`. Selected original x86 routines were emulated to check asset decoding, sequencing, geometry, shading and audio timing against the JavaScript implementation.

The sequencer retains its native 1 ms tick. Render-dependent simulation runs at a reproducible 60 Hz, while visuals follow the Web Audio output clock with the original buffering offset. WebGL rasterization and the original demo's variable startup state can still produce differences from a native recording.

See the [detailed reconstruction notes](notes/REVERSE_ENGINEERING.md) for the address maps, verification methods and fidelity limits, and [NOTICE.md](NOTICE.md) for credits and attribution.
