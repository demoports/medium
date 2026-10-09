#!/usr/bin/env python3
"""Record the original D3D material flush order and depth/blend state.

Runs the complete 0x415850 routine in Unicorn. Only the four D3D COM
endpoints are stubbed; bucket selection and render-state decisions execute
the released x86 instructions. Each representative bucket contains one
triangle. No rasterizer or effect geometry is required for this check.
"""
import argparse
import json
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parent.parent

# Relative registration order: overlays 0x40b648/0x40b7e8, Tunnel constructor
# 0x40b710, Comic constructor 0x40b852, Makina constructor 0x40b87f.
# The Makina flag is also preserved in assets/models/makina*.json.
REGISTRATIONS = [
    ('overlays', 0x40030302),
    ('tunnel patches', 0x41474705),
    ('tunnel bars', 0x41575702),
    ('comic', 0x40030704),
    ('makina', 0x40030301),
]
STATE_NAMES = {14: 'depthWrite', 15: 'alphaTest', 19: 'sourceBlend',
               20: 'destinationBlend', 22: 'cullMode', 24: 'alphaReference',
               25: 'alphaFunction', 27: 'alphaBlend', 34: 'fogColor'}


def samples(executable):
    emu = Uc(UC_ARCH_X86, UC_MODE_32)
    emu.mem_map(0x400000, 0x300000)
    emu.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
    emu.mem_map(0x700000, 0x200000)

    def write(address, value):
        emu.mem_write(address, struct.pack('<I', value & 0xffffffff))

    def read(address):
        return struct.unpack('<I', emu.mem_read(address, 4))[0]

    engine, camera, device, vtable = 0x710000, 0x720000, 0x730000, 0x731000
    write(0x614cd0, device)
    write(device, vtable)
    # SetRenderState, SetTexture, SetTextureStageState, DrawIndexedPrimitive.
    for offset, stub, argc in [(0x50, 0x800100, 3), (0x8c, 0x800200, 3),
                               (0x94, 0x800300, 4), (0x68, 0x800400, 8)]:
        write(vtable + offset, stub)
        emu.mem_write(stub, b'\x31\xc0\xc2' + struct.pack('<H', argc * 4))

    state, draws = {}, []

    def hook(machine, pc, size, data):
        stack = machine.reg_read(UC_X86_REG_ESP)
        if pc == 0x800100:
            state[read(stack + 8)] = read(stack + 12)
        if pc == 0x800400:
            index = (machine.reg_read(UC_X86_REG_EBX) - engine - 0x196c) // 32
            name, flags = REGISTRATIONS[index]
            draws.append(dict(name=name, material=f'0x{flags:08x}',
                              indexCount=read(stack + 28),
                              states={STATE_NAMES[k]: v for k, v in sorted(state.items())}))

    emu.hook_add(UC_HOOK_CODE, hook, begin=0x800100, end=0x800400)
    write(engine + 0x40, len(REGISTRATIONS))
    emu.mem_write(engine + 0x4c, b'\x01')
    write(engine + 0xcc, camera)
    write(engine + 0x34, 3)
    write(engine + 0x38, 0x740000)
    for i, (_, flags) in enumerate(REGISTRATIONS):
        bucket, indices = engine + 0x196c + i * 32, 0x750000 + i * 32
        write(bucket, flags)
        write(bucket + 0x10, indices)
        write(bucket + 0x14, indices + 6)
        emu.mem_write(indices, struct.pack('<3H', 0, 1, 2))

    emu.reg_write(UC_X86_REG_ECX, engine)
    emu.reg_write(UC_X86_REG_ESP, 0x8eff00)
    write(0x8eff00, 0x800010)
    emu.emu_start(0x415850, 0x800010)
    return dict(routine='0x415850',
                registrations=[dict(name=name, material=f'0x{flags:08x}')
                               for name, flags in REGISTRATIONS],
                secondPassByLowByte=list(emu.mem_read(0x44e7f4, 7)), draws=draws)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-material-order.json')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    actual = samples(args.exe)
    if args.write:
        args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    elif actual != json.loads(args.fixture.read_text()):
        raise SystemExit('Original x86 material order/state differs from fixture')
    print('Native material order verified: ' + ' -> '.join(draw['name'] for draw in actual['draws']))


if __name__ == '__main__':
    main()
