#!/usr/bin/env python3
"""Capture Medium's native shared RNG and Tunnel.Reset particle arrays.

Canonical startup chooses a GetSystemTime sum divisible by 101 and 32-bit
texture conversion (neither operation discards random words). Main calls
Tunnel.Reset at 0x40b8b1 and 0x40b9f1. The native reset and RNG execute here;
only unrelated light normalization and equalizer reset are stubbed.
"""
import argparse
import json
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_ECX, UC_X86_REG_EAX

ROOT = Path(__file__).resolve().parent.parent


def capture(executable):
    emu = Uc(UC_ARCH_X86, UC_MODE_32)
    emu.mem_map(0x400000, 0x300000)
    emu.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
    emu.mem_map(0x1000000, 0x20000)
    emu.mem_map(0x1100000, 0x10000)
    emu.mem_map(0x1200000, 0x10000)
    obj, stop, stack = 0x1000000, 0x1200000, 0x110f000
    emu.mem_write(obj + 0xd278, struct.pack('<I', 0x1010000))
    words = []

    def hook(uc, address, size, data):
        if address in (0x41c1a0, 0x40eba0):
            sp = uc.reg_read(UC_X86_REG_ESP)
            ret, = struct.unpack('<I', uc.mem_read(sp, 4))
            uc.reg_write(UC_X86_REG_ESP, sp + 4)
            uc.reg_write(UC_X86_REG_EIP, ret)
        if address == 0x41bc34:
            words.append(uc.reg_read(UC_X86_REG_EAX))

    emu.hook_add(UC_HOOK_CODE, hook)

    def call(address):
        emu.mem_write(stack, struct.pack('<I', stop))
        emu.reg_write(UC_X86_REG_ESP, stack)
        emu.reg_write(UC_X86_REG_ECX, obj)
        emu.emu_start(address, stop)
        return emu.reg_read(UC_X86_REG_EAX)

    def snapshot():
        return {
            'rngState': list(struct.unpack('<II', emu.mem_read(0x44fd5c, 8))),
            'particles': list(struct.unpack('<288i', emu.mem_read(obj + 0x388, 96 * 12))),
            'enabled': list(emu.mem_read(obj + 0xc88, 96)),
        }

    call(0x40f2d0)
    first = snapshot()
    call(0x40f2d0)
    second = snapshot()
    # One camera phase and two photo offsets use the same stream.
    subsequent_words = [call(0x41bc00) for _ in range(3)]
    call(0x40f2d0)
    third = snapshot()
    assert len(words) == 579
    a, b = 0x42afd867, 0x7294bd7e
    for i, word in enumerate(words):
        rotated = ((a >> 12) | (a << 20)) & 0xffffffff
        a = (((b >> 5) | (b << 27)) ^ rotated) & 0xffffffff
        b = (a - rotated) & 0xffffffff
        assert word == b & 65535, (i, word, b & 65535)
    assert third['rngState'] == [a, b]
    for offset, result in ((0, first), (192, second), (387, third)):
        expected = []
        for i in range(96):
            z, angle = words[offset + i * 2:offset + i * 2 + 2]
            expected.extend([angle, 0, z % 0xb000 - 0x5800])
        assert result['particles'] == expected
    return {
        'profile': 'GetSystemTime sum divisible by 101; 32-bit texture conversion without dithering',
        'initialSeeds': [0x42afd867, 0x7294bd7e],
        'callsPerTunnelReset': 192,
        'startupResetCount': 2,
        'firstResetRng': first['rngState'],
        'startup': second,
        'subsequentWords': subsequent_words,
        'subsequentReset': third,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path, nargs='?', default=ROOT / 'original/medium.exe')
    parser.add_argument('--output', type=Path, default=ROOT / 'tests/fixtures/startup-rng.json')
    args = parser.parse_args()
    result = capture(args.executable)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print('Native reset and RNG matched 579 random words and 288 particle triples.')
    print(f'Wrote {args.output}')
