#!/usr/bin/env python3
"""Execute native Tunnel patches and Makina's ES vertex reader with Unicorn.

The patch Render runs with visibility/projection intercepted. Makina's reader,
frame interpolation, lighting, and both UV stages execute unmodified x86 using
ES streams decompressed from the original packfile. A separate native dispatch
probe records the released machine scene's repeated/omitted split meshes.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX,
                               UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP,
                               UC_X86_REG_FPCW)
from extract import Reader, decompress

ROOT = Path(__file__).resolve().parent.parent


class Native:
    def __init__(self, executable):
        self.u = Uc(UC_ARCH_X86, UC_MODE_32)
        self.u.mem_map(0x400000, 0x300000)
        self.u.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
        self.u.mem_map(0x1000000, 0x1000000)
        self.u.reg_write(UC_X86_REG_FPCW, 0x37f)
        self.stack, self.stop = 0x1fe0000, 0x1ff0000
        self.call(0x41baa0)  # native sine table

    def integer(self, address, value):
        self.u.mem_write(address, struct.pack('<I', value & 0xffffffff))

    def read(self, address):
        return struct.unpack('<I', self.u.mem_read(address, 4))[0]

    def call(self, address, args=(), obj=0):
        self.u.reg_write(UC_X86_REG_ESP, self.stack)
        self.u.reg_write(UC_X86_REG_ECX, obj)
        self.integer(self.stack, self.stop)
        for index, value in enumerate(args):
            self.integer(self.stack + 4 + index * 4, value)
        self.u.emu_start(address, self.stop)

    def return_call(self, argument_bytes=0):
        stack = self.u.reg_read(UC_X86_REG_ESP)
        address = self.read(stack)
        self.u.reg_write(UC_X86_REG_ESP, stack + 4 + argument_bytes)
        self.u.reg_write(UC_X86_REG_EIP, address)

    def hook(self, address, callback):
        self.u.hook_add(UC_HOOK_CODE, callback, begin=address, end=address)


def digest(records, format):
    payload = b''.join(struct.pack(format, *record) for record in records)
    return dict(vertices=len(records), sha256=hashlib.sha256(payload).hexdigest())


def particle_ticks(executable):
    """Exercise the real 96-particle update, including both wrap boundaries."""
    native = Native(executable)
    u, obj = native.u, 0x1000000
    results = []
    for phase, velocity in [(0, 0), (1234, -2), (40320, 0), (98217, 7)]:
        u.mem_write(obj, b'\0' * 0xd300)
        native.integer(obj + 0x6c, phase)
        native.integer(obj + 0xce8, velocity)
        native.integer(obj + 0xcec, 3)
        for index in range(96):
            z = (index * 7523) % 45056 - 22528
            if index < 4:
                z = [-22529, -22528, 22528, 22529][index]
            values = [(index * 16271 + phase * 17) & 65535,
                      (index * 375 + phase) & 65535, z]
            u.mem_write(obj + 0x388 + index * 12, struct.pack('<3i', *values))
        u.reg_write(UC_X86_REG_EBP, 0x1fd1000)
        u.reg_write(UC_X86_REG_EBX, obj)
        u.reg_write(UC_X86_REG_ESP, 0x1fd0000)
        u.emu_start(0x40fb1f, 0x40fd5b)
        payload = bytes(u.mem_read(obj + 0x388, 96 * 12))
        payload += bytes(u.mem_read(obj + 0x808, 96 * 12))
        payload += bytes(u.mem_read(obj + 0xc88, 96))
        results.append(dict(phase=phase, velocity=velocity,
                            sha256=hashlib.sha256(payload).hexdigest()))
    return results


def patches(executable):
    native = Native(executable)
    u, obj, output = native.u, 0x1000000, 0x1100000
    points, records = [], []
    submitted = False

    def intercept(uc, address, size, context):
        nonlocal submitted
        stack = uc.reg_read(UC_X86_REG_ESP)
        if address == 0x41a980:
            native.return_call(4)
        elif address == 0x41a2d0:
            uc.reg_write(UC_X86_REG_EAX, 1)
            native.return_call(12)
        elif address == 0x41a270:
            points.clear()
            submitted = False
            uc.reg_write(UC_X86_REG_EAX, output)
            native.return_call(4)
        elif address == 0x418260:
            source = native.read(stack + 4)
            points.append(list(struct.unpack('<3i', uc.mem_read(source, 12))))
            native.return_call(12)
        elif address == 0x41a4b0:
            if not submitted:
                for index, point in enumerate(points):
                    memory = uc.mem_read(output + index * 40, 40)
                    records.append(point + [struct.unpack_from('<I', memory, 16)[0]]
                                   + list(struct.unpack_from('<4f', memory, 24)))
                submitted = True
            native.return_call(16)

    for address in (0x41a980, 0x41a2d0, 0x41a270, 0x418260, 0x41a4b0):
        native.hook(address, intercept)
    results = []
    cases = [(-7168, 0, 0, False), (25173, 1234, 35271, True),
             (65259, 40320, 14528, True)]
    for radius, phase, pulse, lighting in cases:
        u.mem_write(obj, b'\0' * 0xd300)
        u.mem_write(obj + 0xc88, b'\1' * 96)
        u.mem_write(obj + 0xd270, b'\1')
        u.mem_write(obj + 0xd26c, bytes([lighting]))
        native.integer(obj + 0xd254, radius)
        native.integer(obj + 0x10, pulse)
        u.mem_write(obj + 0xd22c, struct.pack('<2f', ((phase * 3) & 65535) / 65536,
                                             ((phase * 5) & 65535) / 65536))
        for index in range(96):
            point = [(index * 16271 + phase * 17) & 65535,
                     (index * 375 + phase) & 65535,
                     (index * 7523) % 45056 - 22528]
            u.mem_write(obj + 0x808 + index * 12, struct.pack('<3i', *point))
        records.clear()
        native.call(0x4108c0, obj=obj)
        results.append(dict(radius=radius, phase=phase, pulse=pulse, lighting=lighting,
                            **digest(records, '<3iI4f')))
    return results


def mesh_streams(packfile, name):
    packed_data = packfile.read_bytes()
    for index in range(1024):
        packed, sector, _, size, path = struct.unpack_from('<4I64s', packed_data, index * 80)
        path = path.split(b'\0')[0].decode().lower().replace('\\', '/')
        if path.endswith('/' + name + '.es'):
            stream = packed_data[sector * 2048:sector * 2048 + packed]
            reader = Reader(stream if packed == size else decompress(stream))
            break
    else:
        raise ValueError(f'Missing {name}.es')
    reader.tag(b'ES  ')
    version, textures, meshes, *_ = reader.unpack('7I')
    assert version == 1
    for _ in range(textures):
        reader.tag(b'EST ')
        reader.read(32)
        reader.tag(b'BMAP')
        _, _, _, height, stride, _, _ = reader.unpack('7I')
        reader.read(stride * height)
        reader.tag(b'bmap')
        reader.tag(b'est ')
    for _ in range(meshes):
        reader.tag(b'ESM ')
        header = reader.unpack('12I')
        vertices = reader.read(header[10])
        reader.read(header[11])
        frames = reader.read(header[8] * header[9])
        reader.read(header[7] * 16)
        reader.tag(b'esm ')
        yield header, vertices, frames


def machines(executable, packfile):
    native = Native(executable)
    u = native.u
    transform, mesh, camera = 0x1000000, 0x1001000, 0x1002000
    stream, frames, output = 0x1010000, 0x1020000, 0x1100000
    normals = []

    def intercept(uc, address, size, context):
        stack = uc.reg_read(UC_X86_REG_ESP)
        if address == 0x418260:
            source, destination, _ = struct.unpack('<3I', uc.mem_read(stack + 4, 12))
            uc.mem_write(destination, bytes(uc.mem_read(source, 12)) + b'\0' * 12)
            native.return_call(12)
        elif address == 0x4193b0:
            packed = native.read(stack + 12)
            normals.append(list(struct.unpack('<bbb', struct.pack('<I', packed)[:3])))

    for address in (0x418260, 0x4193b0):
        native.hook(address, intercept)
    results = []
    for name in ('makina', 'makina2'):
        for part, (header, vertices, animation) in enumerate(mesh_streams(packfile, name)):
            for phase in ([0] if part != 3 else [0, 32768, 154771, 720895]):
                u.mem_write(transform, b'\0' * 0x3000)
                u.mem_write(stream, vertices)
                u.mem_write(frames, animation)
                u.mem_write(output, b'\0' * 0x40000)
                for offset, value in [(4, stream), (0x10, frames), (0x18, header[1]),
                                      (0x38, header[8]), (0x3c, header[9])]:
                    native.integer(mesh + offset, value)
                native.integer(0x460244, 0)
                native.integer(0x460248, output)
                native.integer(0x4602dc, camera)
                native.integer(transform + 0x68, phase)
                for offset in (0xc0, 0xd0, 0xe0):
                    native.integer(transform + offset, 16384)
                native.integer(transform + 0xf0, 65536)
                u.mem_write(camera + 0x5a, b'\1')
                u.mem_write(camera + 0x78, bytes([17, 96, 255, 0, 53, 9, 0, 0]))
                u.mem_write(0x460180, struct.pack('<f', 13.25))
                normals.clear()
                native.call(0x4195a0, [mesh, transform], 0x460210)
                records = []
                for index in range(native.read(0x460244)):
                    memory = u.mem_read(output + index * 40, 40)
                    records.append(list(struct.unpack_from('<3i', memory)) + normals[index]
                                   + [struct.unpack_from('<I', memory, 16)[0]]
                                   + list(struct.unpack_from('<4f', memory, 24)))
                results.append(dict(model=name, part=part, phase=phase,
                                    **digest(records, '<6iI4f')))
    return results


def machine_order(executable):
    native = Native(executable)
    u = native.u
    obj, model_a, model_b = 0x1010000, 0x1011000, 0x1012000
    native.integer(obj + 0xa0, model_a)
    native.integer(obj + 0xa4, model_b)
    native.integer(obj + 0x78, 1)
    u.mem_write(obj + 0x74, b'\1')
    lookup, order = {}, []
    for model, base in [('makina', model_a), ('makina2', model_b)]:
        head = 0
        for index, flag in enumerate([0x2002, 0x2002, 0x1001, 0x3003]):
            address = base + 0x100 + index * 0x80
            lookup[address] = [model, index]
            native.integer(address, head)
            native.integer(address + 0x14, flag)
            head = address
        native.integer(base + 4, head)

    def collect(uc, address, size, context):
        stack = uc.reg_read(UC_X86_REG_ESP)
        order.append(lookup[native.read(stack + 4)])
        native.return_call(8)

    native.hook(0x41a8d0, collect)
    u.reg_write(UC_X86_REG_ESP, 0x1fd0000)
    u.reg_write(UC_X86_REG_EBP, 0x1fd1000)
    u.reg_write(UC_X86_REG_EBX, obj)
    u.emu_start(0x40e6e1, 0x40ea76)
    return order


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--pak', type=Path, default=ROOT / 'original/packfile.pak')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-effect-vertices.json')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    result = dict(particles=particle_ticks(args.exe), patches=patches(args.exe), machines=machines(args.exe, args.pak),
                  machineOrder=machine_order(args.exe))
    if args.write:
        args.fixture.write_text(json.dumps(result, indent=2) + '\n')
    elif json.loads(args.fixture.read_text()) != result:
        raise SystemExit('Native effect vertex data differs from fixture')
    count = sum(case['vertices'] for key in ('patches', 'machines') for case in result[key])
    print(f'{count} native vertices and machine dispatch verified')


if __name__ == '__main__':
    main()
