#!/usr/bin/env python3
"""Verify Tunnel camera fixtures by running its x86 camera and vertex projector.

Fixture inputs are effect state after a tick. The native camera block executes
before its phase/counter increments, so those four counters are reduced by one.
No camera, matrix, normalization or projection functions are stubbed.
"""
import argparse
import copy
import json
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import (
    UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_ESI, UC_X86_REG_ESP, UC_X86_REG_FPCW,
)

ROOT = Path(__file__).resolve().parent.parent
FIELDS = {'phase': 0x6c, 'counter70': 0x70, 'counter74': 0x74,
          'counter78': 0x78, 'counter7c': 0x7c, 'counter80': 0x80,
          'mode': 0xd240, 'overlayMode': 0xd268, 'innerMode': 0xd280,
          'countD238': 0xd238, 'cameraX': 0xd244, 'cameraY': 0xd248}


def emulate(executable, inputs):
    emu = Uc(UC_ARCH_X86, UC_MODE_32)
    emu.mem_map(0x400000, 0x300000)
    emu.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
    emu.mem_map(0x700000, 0x200000)
    emu.reg_write(UC_X86_REG_FPCW, 0x37f)

    def write_int(address, value):
        emu.mem_write(address, struct.pack('<I', int(value) & 0xffffffff))

    def write_float(address, value):
        emu.mem_write(address, struct.pack('<f', value))

    def call(address, ecx=0, args=()):
        emu.reg_write(UC_X86_REG_ECX, ecx)
        emu.reg_write(UC_X86_REG_ESP, 0x8eff00)
        write_int(0x8eff00, 0x800010)
        for i, value in enumerate(args):
            write_int(0x8eff04 + i * 4, value)
        emu.emu_start(address, 0x800010)

    call(0x41baa0)
    write_int(0x44db44, 640)
    write_int(0x44db48, 480)
    results = copy.deepcopy(inputs)
    for sample in results:
        state, effect = sample['state'], sample['effect']
        emu.mem_write(0x720000, b'\0' * 0x10000)
        for key, offset in FIELDS.items():
            before_increment = key in ('phase', 'counter78', 'counter7c', 'counter80')
            write_int(0x720000 + offset, effect[key] - int(before_increment))
        for key, address in [('spring', 0x45ea4c), ('row32', 0x46017c),
                             ('row64', 0x460180), ('row128', 0x460184)]:
            write_float(address, state[key])
        call(0x418190, 0x45f420)
        write_int(0x45f454, state['projection']['zoom'] * 65536)
        for register, value in [(UC_X86_REG_EBP, 0x8e0000), (UC_X86_REG_EBX, 0x720000),
                                (UC_X86_REG_ESI, effect['phase'] - 1),
                                (UC_X86_REG_ESP, 0x8d0000)]:
            emu.reg_write(register, value)
        emu.emu_start(0x40fdf3, 0x410859)
        matrix = struct.unpack('<9i', emu.mem_read(0x45f420, 36))
        sample['axes'] = [value / 65536 * (-1 if i < 3 or i >= 6 else 1)
                          for i, value in enumerate(matrix)]
        sample['position'] = [value / 65536 for value in
                              struct.unpack('<3i', emu.mem_read(0x45f448, 12))]
        if 'projections' in sample:
            call(0x41ac90, 0x730000, [0x45f420])
            call(0x417f80, 0x740000)
            call(0x41a980, 0x730000, [0x740000])
            for projection in sample['projections']:
                for i, value in enumerate(projection['point']):
                    write_int(0x750000 + i * 4, value)
                call(0x418260, 0x730000, [0x750000, 0x760000, 0x740000])
                projection['screen'] = list(struct.unpack('<2f', emu.mem_read(0x760000, 8)))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-tunnel-camera.json')
    parser.add_argument('--write', action='store_true', help='Regenerate expected outputs for saved inputs')
    args = parser.parse_args()
    expected = json.loads(args.fixture.read_text())
    actual = emulate(args.exe, expected)
    if args.write:
        args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    elif actual != expected:
        raise SystemExit('Original Tunnel camera differs from fixture')
    print(f'{len(actual)} original Tunnel cameras and their projected points verified')


if __name__ == '__main__':
    main()
