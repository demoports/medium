#!/usr/bin/env python3
"""Run the released x86 overlay, vertex fog and tunnel color arithmetic.

Only geometry allocation/submission are intercepted. All sampled arithmetic
executes from medium.exe, including the original sine table and x87 rounding.
"""
import argparse
import json
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_ECX, UC_X86_REG_EDI,
    UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP, UC_X86_REG_FPCW,
)

ROOT = Path(__file__).resolve().parent.parent


def samples(executable):
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

    def intercept(uc, address, size, context):
        if address == 0x41a270:  # reserve output vertices
            uc.reg_write(UC_X86_REG_EAX, 0x880000)
            return_from_call(4)
        elif address == 0x41a4b0:  # submit quad indices
            return_from_call(16)
        elif address == 0x4180c0:  # record screen vertex arguments
            arguments = uc.mem_read(uc.reg_read(UC_X86_REG_ESP) + 4, 24)
            vertices.append((struct.unpack_from('<2f', arguments),
                             struct.unpack_from('<I', arguments, 12)[0]))
            return_from_call(24)

    for address in (0x41a270, 0x41a4b0, 0x4180c0):
        emu.hook_add(UC_HOOK_CODE, intercept, begin=address, end=address)
    emu.mem_write(0x800000, b'\xc3')
    for i in range(7):
        write_int(0x45e9a4 + i * 4, 0x710000 + i * 0x1000)
        write_int(0x710000 + i * 0x1000, 0x700000)
        write_int(0x700000 + i * 4, 0x800000)
    for address, value in ((0x4601d8, 1), (0x4601dc, 4),
                           (0x44db44, 640), (0x44db48, 480)):
        write_int(address, value)
    call(0x41baa0)  # original sine-table initialization

    overlays = []
    for index, age in [(6, 1), (6, 100), (6, 400), (6, 600), (6, 895),
                       (0, 1), (0, 1024), (0, 1600),
                       (5, 1), (5, 8192), (5, 16383)]:
        duration = 896 if index > 5 else 16384 if index == 5 else 2048
        kind = 1 if index > 5 else 2 if index == 5 else 0
        for address, value in ((0x45eee0, index), (0x45e99c, age),
                               (0x45f3e4, duration), (0x45f4ac, kind),
                               (0x45e9d8, -12), (0x45e9d4, -63)):
            write_int(address, value)
        vertices.clear()
        call(0x40cc90)
        (x, y), color = vertices[0]
        overlays.append(dict(index=index, age=age, x=x, y=y,
                             alpha=color >> 24, vertices=len(vertices)))

    lighting = []
    for beat in (0, 1, 100, 218, 219, 1024, 20000, 56000, 65536):
        emu.reg_write(UC_X86_REG_EBP, 0x8e0000)
        emu.reg_write(UC_X86_REG_EDI, 0x720000)
        emu.reg_write(UC_X86_REG_ESI, 0x880000)
        write_int(0x720010, beat)
        write_int(0x8e0000 - 0x18, 0xabcdef)
        write_int(0x8e0000 - 0x80, 0x1234)
        emu.emu_start(0x410fbf, 0x411017)
        lighting.append(dict(beat=beat, color=read_int(0x880000 - 0x10)))

    fog = []
    for near, far, low, high in [(2048, 7168, 255, 255), (0, 3072, 184, 207),
                                (0, 5120, 216, 239), (0, 10240, 0, 255)]:
        for depth in (0, 8, 1024, 1536, 2048, 3072, 5120, 7168, 10240):
            camera, engine, vertex, frame = 0x720000, 0x730000, 0x740000, 0x8e0000
            write_int(camera + 0x64, near * 65536)
            write_int(camera + 0x68, far * 65536)
            write_int(camera + 0x6c, low)
            write_int(camera + 0x70, high)
            write_int(engine + 0xcc, camera)
            write_float(engine + 0xbc, low / ((far - near) * 65536))
            write_float(frame + 8, depth * 65536)
            for register, value in ((UC_X86_REG_EBP, frame), (UC_X86_REG_EDI, camera),
                                    (UC_X86_REG_ECX, engine), (UC_X86_REG_ESI, vertex),
                                    (UC_X86_REG_ESP, 0x8d0000)):
                emu.reg_write(register, value)
            emu.emu_start(0x418576, 0x4185cd)
            fog.append(dict(near=near, far=far, min=low, max=high, depth=depth,
                            retained=emu.mem_read(vertex + 0x17, 1)[0]))
    return {'native-overlays': overlays, 'native-tunnel-lighting': lighting,
            'native-fog': fog}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixtures', type=Path, default=ROOT / 'tests/fixtures')
    parser.add_argument('--write', action='store_true', help='Regenerate golden fixtures')
    args = parser.parse_args()
    for name, actual in samples(args.exe).items():
        path = args.fixtures / f'{name}.json'
        if args.write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(actual, indent=2) + '\n')
        else:
            expected = json.loads(path.read_text())
            if expected != actual:
                raise SystemExit(f'{name}: original x86 output differs from fixture')
        print(f'{name}: {len(actual)} original x86 samples verified')


if __name__ == '__main__':
    main()
