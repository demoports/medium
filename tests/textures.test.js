import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { nativeMipTexture } from '../src/core/Texture.js';
import { Comic } from '../src/effects/Comic.js';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('tests/fixtures/native-mips.json', root)));
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('explicit mip levels match all bytes produced by the original RGBA filter', async () => {
  for (const sample of fixture) {
    const bytes = await readFile(new URL(`assets/textures/${sample.texture}.mips.bin`, root));
    const texture = nativeMipTexture(arrayBuffer(bytes));
    assert.equal(texture.image.width, sample.width);
    assert.equal(texture.image.height, sample.height);
    assert.equal(texture.mipmaps.length, sample.levelHashes.length);
    for (let i = 0; i < texture.mipmaps.length; i++) {
      const mip = texture.mipmaps[i];
      assert.equal(mip.width, sample.width >> i);
      assert.equal(mip.height, sample.height >> i);
      assert.equal(createHash('sha256').update(mip.data).digest('hex'), sample.levelHashes[i], `${sample.texture}, level ${i}`);
    }
    assert.equal(texture.generateMipmaps, false);
    assert.equal(texture.flipY, false);
    assert.equal(texture.premultiplyAlpha, false);
    assert.equal(texture.colorSpace, THREE.NoColorSpace);
    assert.equal(texture.minFilter, THREE.LinearMipmapNearestFilter);
    texture.dispose();
  }
});

test('native mip filtering retains transparent RGB and rounds a half byte upward', async () => {
  const bytes = await readFile(new URL('assets/textures/medium_stunnel/pet_t1_03.mips.bin', root));
  const texture = nativeMipTexture(arrayBuffer(bytes));
  assert.deepEqual(Array.from(texture.image.data.slice(14 * 4, 15 * 4)), [240, 0, 0, 0]);
  assert.deepEqual(Array.from(texture.mipmaps[1].data.slice(7 * 4, 8 * 4)), [236, 0, 0, 0]);
  texture.dispose();
});

test('Comic can bind one native texture with and without mip sampling', async () => {
  const bytes = await readFile(new URL('assets/textures/medium_comic/pet02e_3.mips.bin', root));
  const source = nativeMipTexture(arrayBuffer(bytes));
  const comic = new Comic();
  comic.textures.pet02e_3 = source;
  const linear = comic.textureVariant('pet02e_3', false);
  const mip = comic.textureVariant('pet02e_3', true);
  assert.equal(linear.generateMipmaps, false);
  assert.equal(mip.generateMipmaps, false);
  assert.equal(linear.minFilter, THREE.LinearFilter);
  assert.equal(mip.minFilter, THREE.LinearMipmapNearestFilter);
  assert.equal(mip.mipmaps[1].data, source.mipmaps[1].data);
  comic.dispose();
  source.dispose();
});

test('invalid or truncated mip files fail before texture upload', () => {
  assert.throws(() => nativeMipTexture(new ArrayBuffer(0)), /header/);
  const bytes = new ArrayBuffer(20), header = new DataView(bytes);
  header.setUint32(0, 0x50494d4d, true);
  header.setUint32(4, 1, true);
  header.setUint32(8, 2, true);
  header.setUint32(12, 2, true);
  header.setUint32(16, 2, true);
  assert.throws(() => nativeMipTexture(bytes), /Truncated/);
});
