#!/usr/bin/env python3
"""Prepare Medium's exact RGBA mip chains. Requires Pillow; no runtime codec.

The original sHalveBitmap (0x412200, RGBA branch 0x412586) averages each
unpremultiplied channel as (a + b + c + d + 2) >> 2. PNG alpha-zero RGB is
retained. MMIP files hold a 20-byte <4s4I header (magic, version, width,
height, levels), followed by tightly packed top-down RGBA levels, base first.
"""
import argparse
import struct
from pathlib import Path
from PIL import Image

MIP_TEXTURES = (
    'medium_stunnel/pet_t2_04', 'medium_stunnel/pet_t1_03',
    'medium_stunnel/011029_alpha_02', 'medium_stunnel/mid_tex07',
    'medium_stunnel/mid_tex08', 'medium_comic/comic8',
    'medium_comic/comic11', 'medium_comic/pet02e_15',
    'medium_comic/pet02e_3', 'medium_comic/petc01',
    'medium_makina/roomcube_01',
)


def halve_rgba(data, width, height):
    assert width >= 2 and height >= 2 and not width % 2 and not height % 2
    assert len(data) == width * height * 4
    result = bytearray(width * height)
    out = 0
    for y in range(0, height, 2):
        for x in range(0, width, 2):
            p = (y * width + x) * 4
            q = p + width * 4
            for channel in range(4):
                result[out] = (data[p + channel] + data[p + 4 + channel]
                               + data[q + channel] + data[q + 4 + channel] + 2) >> 2
                out += 1
    return bytes(result)


def mip_chain(data, width, height):
    # All mipmapped textures in this release are square powers of two.
    assert width == height and width > 0 and width & (width - 1) == 0
    levels = [bytes(data)]
    while width > 1:
        data = halve_rgba(data, width, height)
        width //= 2
        height //= 2
        levels.append(data)
    return levels


def prepare_mips(textures):
    total = 0
    for name in MIP_TEXTURES:
        with Image.open(textures / (name + '.png')) as source:
            rgba = source.convert('RGBA')
            width, height = rgba.size
            levels = mip_chain(rgba.tobytes(), width, height)
        binary = struct.pack('<4s4I', b'MMIP', 1, width, height, len(levels)) + b''.join(levels)
        (textures / (name + '.mips.bin')).write_bytes(binary)
        total += len(binary)
    print(f'Prepared {len(MIP_TEXTURES)} native RGBA mip chains ({total:,} bytes)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--textures', type=Path, default=Path(__file__).resolve().parents[1] / 'assets/textures')
    prepare_mips(parser.parse_args().textures)
