#!/usr/bin/env python3
"""Execute Medium's original bar Render and hash its unprojected vertex data.

Allocation, visibility and projection are intercepted. Geometry, vertex RGBA,
texture coordinates, integer overflow and x87 arithmetic execute natively.
Each digest covers 2560 records: XYZ int32, RGBA uint32, UV0/UV1 float32.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EIP,
    UC_X86_REG_ESP, UC_X86_REG_FPCW,
)

ROOT = Path(__file__).resolve().parent.parent
CASES = [(0, 0, 0), (1234, 16384, .65), (10000, 32768, .85),
         (16384, 131072, .85)]


def emulate(executable):
    emu = Uc(UC_ARCH_X86, UC_MODE_32)
    emu.mem_map(0x400000, 0x300000)
    emu.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
    emu.mem_map(0x700000, 0x200000)
    emu.reg_write(UC_X86_REG_FPCW, 0x37f)

    def write_int(address, value):
        emu.mem_write(address, struct.pack('<I', value & 0xffffffff))

    def read_int(address):
        return struct.unpack('<I', emu.mem_read(address, 4))[0]

    def write_float(address, value):
        emu.mem_write(address, struct.pack('<f', value))

    def return_from_call(argument_bytes=0):
        sp = emu.reg_read(UC_X86_REG_ESP)
        pc = read_int(sp)
        emu.reg_write(UC_X86_REG_ESP, sp + 4 + argument_bytes)
        emu.reg_write(UC_X86_REG_EIP, pc)

    def call(address):
        emu.reg_write(UC_X86_REG_ESP, 0x8efffc)
        write_int(0x8efffc, 0x800010)
        emu.emu_start(address, 0x800010)

    vertices = []
    positions = {}

    def intercept(uc, address, size, context):
        sp = uc.reg_read(UC_X86_REG_ESP)
        if address == 0x41a980:  # shared-camera matrix preparation
            return_from_call(4)
        elif address == 0x41a2d0:  # include all 32 segments
            uc.reg_write(UC_X86_REG_EAX, 1)
            return_from_call(12)
        elif address == 0x41a270:  # reserve sixteen output vertices
            positions.clear()
            uc.reg_write(UC_X86_REG_EAX, 0x880000)
            return_from_call(4)
        elif address == 0x418260:  # record XYZ before camera projection
            source, destination, transform = struct.unpack('<3I', uc.mem_read(sp + 4, 12))
            point = struct.unpack('<3i', uc.mem_read(source, 12))
            translation = struct.unpack('<3i', uc.mem_read(transform + 4, 12))
            positions[(destination - 0x880000) // 40] = [
                point[i] + translation[i] // 65536 for i in range(3)]
            return_from_call(12)
        elif address == 0x41a4b0:  # quad submission order
            indices = struct.unpack('<4I', uc.mem_read(sp + 4, 16))
            for index in indices:
                memory = uc.mem_read(0x880000 + index * 40, 40)
                color = struct.unpack_from('<I', memory, 16)[0]
                uv = struct.unpack_from('<4f', memory, 24)
                vertices.append(positions[index] + [color] + list(uv))
            return_from_call(16)

    for address in (0x41a980, 0x41a2d0, 0x41a270, 0x418260, 0x41a4b0):
        emu.hook_add(UC_HOOK_CODE, intercept, begin=address, end=address)
    call(0x41baa0)  # original sine-table initialization
    results = []
    for tick, amplitude, inner90 in CASES:
        emu.reg_write(UC_X86_REG_ECX, 0x720000)
        call(0x40eba0)  # native reset computes the section-length sum
        write_int(0x720000, tick)
        write_float(0x720090, inner90)
        write_float(0x720094, amplitude)
        vertices.clear()
        emu.reg_write(UC_X86_REG_ECX, 0x720000)
        call(0x40ecd0)
        packed = b''.join(struct.pack('<3iI4f', *vertex) for vertex in vertices)
        results.append(dict(tick=tick, amplitude=amplitude, inner90=inner90,
                            vertices=len(vertices), sha256=hashlib.sha256(packed).hexdigest()))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-tunnel-bars.json')
    parser.add_argument('--write', action='store_true', help='Regenerate the golden fixture')
    args = parser.parse_args()
    result = emulate(args.exe)
    if args.write:
        args.fixture.write_text(json.dumps(result, indent=2) + '\n')
    elif json.loads(args.fixture.read_text()) != result:
        raise SystemExit('Original bar geometry/UV/color differs from fixture')
    print(f'{len(result)} original bar render cases verified: {sum(s["vertices"] for s in result)} vertices')


if __name__ == '__main__':
    main()
