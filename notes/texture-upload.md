# Transparent RGB and texture upload

The browser probe at [tools/texture-probe.html](../tools/texture-probe.html) checks whether uploading PNGs preserves RGB values beneath fully transparent alpha. Those RGB values matter because the original two-stage material operations can use texture RGB separately from alpha.

On 2026-10-09, the browser used for the frame review preserved all three tested texels exactly. Both `TextureLoader`/`HTMLImageElement` and `createImageBitmap` with `premultiplyAlpha: 'none'` produced the same GPU bytes:

| Texture | Pixel, top-down | Original RGBA | Both GPU uploads |
| --- | --- | --- | --- |
| `medium_stunnel/pet_t1_03.png` | 14, 0 | 240, 0, 0, 0 | 240, 0, 0, 0 |
| `medium_makina/makina_texture_1.png` | 1, 0 | 255, 0, 255, 0 | 255, 0, 255, 0 |
| `medium_makina/makina2_texture_1.png` | 0, 0 | 255, 0, 255, 0 | 255, 0, 255, 0 |

The probe uses `texelFetch` into a one-pixel RGBA render target, disables blending and color conversion, and reads the target bytes back. It does not use a 2D canvas to inspect the uploaded texture. Its visible JSON output includes both upload paths and the first generated mip level. This is a reproducible browser check, not a guarantee about every browser or driver. No replacement image loader was required by this result.

The generated mip samples were `(235, 0, 0, 0)` for the Tunnel texture and `(255, 0, 255, 128)` for each machinery texture. Native `sHalveBitmap` at `0x412200` has an RGBA averaging branch at `0x412586–0x4126e1`: each channel is `(sum of four source bytes + 2) >> 2`. The Tunnel sample's four red values are `240, 231, 240, 231`, so the native result is `236`, one byte above the browser's generated mip. Both machinery alpha samples match the native result of `128`. This small mip rounding difference is separate from preservation of transparent RGB.

The port now supplies every mip level explicitly for the eleven maps that use mip filtering: five Tunnel maps, five Comic maps, and the Makina room map. The ES machinery maps use linear filtering without mips. [tools/native_mips.py](../tools/native_mips.py) decodes the extracted PNGs with Pillow, preserves straight RGBA including invisible RGB, and applies the original integer average through the 1×1 level. Extraction runs this step automatically; to regenerate only these sidecars, run:

```sh
python tools/native_mips.py
```

Each `.mips.bin` file has a 20-byte little-endian header (`MMIP`, version 1, width, height, level count) followed by tightly packed top-down RGBA levels, including the base level. [src/core/Texture.js](../src/core/Texture.js) loads the bytes into a `DataTexture`, disables automatic mip generation and color conversion, and uses linear sampling within the nearest mip level. No browser PNG decoder or canvas readback participates in this path. The original PNGs remain available for inspection.

[tools/verify-mips.py](../tools/verify-mips.py) executes the unmodified original `sHalveBitmap` and verifies all bytes of all 98 generated levels against the sidecars. Run it with Python packages `pefile`, `unicorn`, and `Pillow` installed:

```sh
python tools/verify-mips.py
```

The resulting [native fixture](../tests/fixtures/native-mips.json) records SHA-256 hashes for every level. The JavaScript tests verify those hashes after parsing, texture configuration, transparent RGB, and Comic's simultaneous mip/non-mip use of one map. The browser probe additionally checks the explicit native mip upload at the previously differing Tunnel texel; its expected GPU value is now `(236, 0, 0, 0)`.
