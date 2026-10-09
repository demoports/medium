#!/usr/bin/env python3
"""Run Makina's complete native Render to verify camera and object transforms.

Only final mesh submission and the room-corner draw are intercepted. Camera
paths, rotations, positions, light direction and morph frame selection execute
the original code at 0x40dbf0. Saved inputs use timeline states in seconds.
"""
import argparse
import copy
import json
import runpy
import struct
from pathlib import Path

from unicorn.x86_const import UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parent.parent
Native = runpy.run_path(str(Path(__file__).with_name('verify-effect-vertices.py')))['Native']


def emulate(executable, inputs):
    native = Native(executable)
    u = native.u
    obj, model_a, model_b = 0x1010000, 0x1011000, 0x1012000
    lookup, submitted = {}, []
    for model, base in [('makina', model_a), ('makina2', model_b)]:
        head = 0
        for index, flags in enumerate([0x2002, 0x2002, 0x1001, 0x3003]):
            address = base + 0x100 + index * 0x80
            lookup[address] = [model, index]
            native.integer(address, head)
            native.integer(address + 0x14, flags)
            head = address
        native.integer(base + 4, head)

    def integers(address, count):
        return list(struct.unpack('<' + 'i' * count, u.mem_read(address, count * 4)))

    def collect(uc, address, size, context):
        stack = uc.reg_read(UC_X86_REG_ESP)
        mesh, transform = native.read(stack + 4), native.read(stack + 8)
        submitted.append(dict(mesh=lookup[mesh], position=integers(transform + 4, 3),
                              matrix=integers(transform + 16, 9),
                              frame=native.read(transform + 0x68)))
        native.return_call(8)

    native.hook(0x41a8d0, collect)
    native.hook(0x40d260, lambda *args: native.return_call())
    results = copy.deepcopy(inputs)
    for sample in results:
        state, effect = sample['state'], sample['state']['effects']['makina']
        u.mem_write(obj, b'\0' * 0x100)
        native.integer(obj + 0xa0, model_a)
        native.integer(obj + 0xa4, model_b)
        native.call(0x418190, obj=0x45f420)
        for offset, key in [(0x6c, 'phase'), (0x70, 'mode')]:
            native.integer(obj + offset, effect[key])
        for offset, key in [(0xa8, 'flagA8'), (0xa9, 'flagA9'), (0xaa, 'flagAA'),
                            (0xab, 'flagAB'), (0xac, 'autoCamera')]:
            u.mem_write(obj + offset, bytes([effect[key]]))
        for index, angle in enumerate(effect['angles']):
            u.mem_write(obj + 0x84 + index * 4, struct.pack('<f', angle))
        for index, beat in enumerate(effect['beats']):
            native.integer(obj + 0xc + index * 4, beat)
        for address, key in [(0x46017c, 'row32'), (0x460180, 'row64'), (0x460184, 'row128'),
                             (0x45e9e8, 'envelopeA'), (0x45eee4, 'envelopeB'), (0x45e9e4, 'envelopeC')]:
            u.mem_write(address, struct.pack('<f', state[key]))
        for address, key in [(0x45e9f8, 'cameraOffsetA'), (0x45f3c8, 'cameraOffsetB')]:
            u.mem_write(address, struct.pack('<3i', *state[key]))
        u.mem_write(0x45e9a0, bytes([state['cameraShakeA']]))
        submitted.clear()
        native.call(0x40dbf0, obj=obj)
        sample['native'] = dict(cameraPosition=integers(0x45f448, 3),
                                cameraMatrix=integers(0x45f420, 9),
                                light=integers(0x45f4a0, 3), meshes=submitted.copy())
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-machine-transforms.json')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    expected = json.loads(args.fixture.read_text())
    actual = emulate(args.exe, expected)
    if args.write:
        args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    elif actual != expected:
        raise SystemExit('Original Makina camera or object transforms differ')
    print(f'{len(actual)} original Makina Render frames verified')


if __name__ == '__main__':
    main()
