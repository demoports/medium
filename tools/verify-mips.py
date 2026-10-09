#!/usr/bin/env python3
"""Compare every shipped mip level against Medium's executed x86 RGBA filter.

Requires Pillow, pefile and Unicorn. The bitmap accessor and filter execute
unchanged; no operating-system calls or rendering APIs are needed.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
import pefile
from PIL import Image
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ESP
from native_mips import MIP_TEXTURES, mip_chain

ROOT = Path(__file__).resolve().parent.parent


def verify(executable, textures):
    u = Uc(UC_ARCH_X86, UC_MODE_32)
    u.mem_map(0x400000, 0x300000)
    u.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
    u.mem_map(0x700000, 0x300000)
    bitmap, pixels, stack, stop = 0x710000, 0x720000, 0x9eff00, 0x700010
    def halve(data, width, height):
        stride = width * 4
        u.mem_write(bitmap, struct.pack('<5I', 5, width, height, stride, pixels))
        u.mem_write(pixels, data)
        u.mem_write(stack, struct.pack('<3I', stop, bitmap, 1))
        u.reg_write(UC_X86_REG_ESP, stack)
        u.emu_start(0x412200, stop)
        assert struct.unpack('<2I', u.mem_read(bitmap + 4, 8)) == (width // 2, height // 2)
        # The native in-place bitmap keeps its original row stride.
        return b''.join(bytes(u.mem_read(pixels + y * stride, width * 2)) for y in range(height // 2))
    results = []
    for name in MIP_TEXTURES:
        with Image.open(textures / (name + '.png')) as image:
            image = image.convert('RGBA')
            width, height = image.size
            levels = mip_chain(image.tobytes(), width, height)
        w, h = width, height
        for level, previous in enumerate(levels[:-1]):
            native = halve(previous, w, h)
            assert native == levels[level + 1], (name, level + 1, 'native filter differs')
            w //= 2
            h //= 2
        packed = struct.pack('<4s4I', b'MMIP', 1, width, height, len(levels)) + b''.join(levels)
        assert packed == (textures / (name + '.mips.bin')).read_bytes(), (name, 'sidecar differs')
        results.append(dict(texture=name, width=width, height=height,
            levelHashes=[hashlib.sha256(level).hexdigest() for level in levels]))
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--textures', type=Path, default=ROOT / 'assets/textures')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-mips.json')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    actual = verify(args.exe, args.textures)
    if args.write:
        args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    else:
        assert actual == json.loads(args.fixture.read_text()), 'Mip fixture differs'
    print(f'Native RGBA filter verified: {len(actual)} textures, {sum(len(r["levelHashes"])-1 for r in actual)} generated levels, all bytes exact')
