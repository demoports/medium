#!/usr/bin/env python3
"""Verify camera clipping and projection by running the released x86 code.

Calls the camera/object constructors, projection-cache update, vertex projector,
and quad submitter. No rendering arithmetic is replaced or intercepted.
"""
import argparse
import json
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ECX, UC_X86_REG_ESP, UC_X86_REG_FPCW

ROOT = Path(__file__).resolve().parent.parent


def samples(executable):
    emu = Uc(UC_ARCH_X86, UC_MODE_32)
    emu.mem_map(0x400000, 0x300000)
    emu.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
    emu.mem_map(0x700000, 0x200000)
    # Frame-start routine 0x41d510 selects single-precision x87 arithmetic.
    emu.reg_write(UC_X86_REG_FPCW, 0x3f)

    def write(address, value):
        emu.mem_write(address, struct.pack('<I', value & 0xffffffff))

    def read(address):
        return struct.unpack('<I', emu.mem_read(address, 4))[0]

    def call(address, this, arguments=()):
        emu.reg_write(UC_X86_REG_ECX, this)
        emu.reg_write(UC_X86_REG_ESP, 0x8eff00)
        write(0x8eff00, 0x800010)
        for i, argument in enumerate(arguments):
            write(0x8eff04 + i * 4, argument)
        emu.emu_start(address, 0x800010)

    camera, engine, obj = 0x720000, 0x730000, 0x740000
    vertices, point, buffer, indices = 0x750000, 0x760000, 0x770000, 0x780000
    write(0x44db44, 640)
    write(0x44db48, 480)
    call(0x418190, camera)
    call(0x417f80, obj)
    result = dict(near=read(camera + 0x5c) / 65536,
                  far=read(camera + 0x60) / 65536,
                  width=640, height=480, vertices=[], quads=[])

    def project(xyz, index=0):
        for i, value in enumerate(xyz):
            write(point + i * 4, value)
        call(0x418260, engine, (point, vertices + index * 40, obj))
        raw = emu.mem_read(vertices + index * 40, 40)
        x, y, sz, rhw = struct.unpack_from('<4f', raw)
        return dict(point=xyz, flags=raw[0x14], output=[x, y, sz, rhw])

    for zoom in (.25, .5, .625, .75, 1, 1.625):
        write(camera + 0x34, int(zoom * 65536))
        call(0x41ac90, engine, (camera,))
        for xyz in ([0, 0, 7], [0, 0, 8], [0, 0, 9], [0, 0, 10239],
                    [0, 0, 10240], [0, 0, 10241], [0, 0, 15777],
                    [1024, 512, 4096], [-1024, -512, 4096]):
            result['vertices'].append(dict(zoom=zoom, **project(xyz)))

    # This distinguishes true CPU far clipping from mere depth-buffer mapping:
    # a quad wholly beyond far submits zero indices, despite sz=near/z being
    # an otherwise valid reversed-depth value for any positive depth.
    write(engine + 0x5c, vertices)
    write(engine + 0x58, buffer)
    write(buffer + 0x10, indices)
    write(buffer + 0x18, 1024)
    for depth in (7, 8, 10240, 10241, 15777):
        write(buffer + 0x14, indices)
        for i, (x, y) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            project([x, y, depth], i)
        call(0x41a4b0, engine, (0, 1, 2, 3))
        result['quads'].append(dict(depth=depth, indexCount=(read(buffer + 0x14) - indices) // 2))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-projection.json')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    actual = samples(args.exe)
    if args.write:
        args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    elif actual != json.loads(args.fixture.read_text()):
        raise SystemExit('Original x86 projection differs from fixture')
    print(f"Native projection: {len(actual['vertices'])} vertices and {len(actual['quads'])} quad submissions verified; near={actual['near']:g}, far={actual['far']:g}")


if __name__ == '__main__':
    main()
