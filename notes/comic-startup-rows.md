# Comic's uninitialized rotation clocks

The released executable leaves three Comic angle-clock floats at object offsets `+0xe8`, `+0xec`, and `+0xf0` uninitialized. Constructor `0x409d20` and Reset `0x409fa0` preserve their previous heap bytes. Init `0x409f80` writes `4.0` to them, but startup calls the Reset vtable slot at `0x40b8a0` and `0x40b9e0`, not Init. The ordinary heap allocator does not guarantee zero-filled reused blocks.

Update `0x40a750` adds or subtracts the row increment and stores each result as a float. In camera modes 3 and 4, Render converts row Y × 1024 and row Z × 512 to integer rotation angles. These angles rotate the two blobs after the tube and its following camera have already been computed. They do not alter the tube, camera, music, or sequencer.

Large float values can be too coarse to change under the row increment. NaN also remains NaN. The executable's `_ftol` returns a 64-bit integer, of which this code uses only the low 32 bits: NaN and out-of-range values produce zero there. Tested large finite values produce multiples of a full turn. Both paths therefore leave the blob orientation at identity.

[tools/verify-comic-row-profile.py](../tools/verify-comic-row-profile.py) executes the actual constructor, two Resets, ten Updates and Render for six seeded memory profiles: zero, four, positive/negative large floats, a very large float, and NaN. The [fixture](../tests/fixtures/comic-row-profile.json) records the untouched heap bits, converted angles, and native matrices. All four non-advancing profiles produce the same exact identity blob matrix; all six have identical camera matrices and positions. Explicitly calling Init separately demonstrates the otherwise unused `4.0` initialization.

The reference recording's blob and enclosure orientation at approximately video 175.0 seconds (mode 4) and 224.8 seconds (mode 3) matches this frozen identity behavior. Zero-start and `4.0` clocks do not match those two shots. This is an inference about the recording's observable behavior; its actual heap bytes cannot be recovered from the video.

`Demo` therefore defaults to `comicRotationProfile: 'frozen'`. The implementation represents that output symbolically with zero angles and no angle-clock advances, rather than inventing a particular original heap value. `new Demo({ comicRotationProfile: 'zero' })` selects the deterministic zero-start comparison. `Timeline` retains `'zero'` as its default so the existing native sequence fixtures continue to describe their explicitly zeroed emulation memory. The choice remains stable through effect selection, photo freezes, and backward seeks.

The isolated [startup-row comparison page](../tools/visual-comic-rows.html) accepts independent initial floats, replays all normal updates, and prints the resulting rows and matrices. Useful examples are `?t=175.38&y=0&z=0`, `?t=175.38&y=4&z=4`, and `?t=175.38&y=100000000&z=100000000`. These controls do not change production state.

Run `python tools/verify-comic-row-profile.py` with `pefile` and `unicorn` installed to reproduce the native checks. `npm test` additionally verifies that the profile changes only the two row-driven blob transforms and remains deterministic after seeking.
