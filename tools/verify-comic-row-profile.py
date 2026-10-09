#!/usr/bin/env python3
"""Verify the native behavior behind the recording's frozen Comic rotation.

The original constructor, Reset, Update and Render execute. External texture
loading/allocation and child geometry construction/reset are substituted.
Row memory is seeded before construction, allowing us to distinguish untouched
heap fields from the uncalled Init method that writes 4. No recording's actual
heap bits are claimed: several unrelated invalid/unadvanceable floats produce
the same fixed blob orientation while camera and tube continue animating.
"""
import argparse
import json
import struct
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP, UC_X86_REG_FPCW

ROOT = Path(__file__).resolve().parent.parent


def samples(executable):
    u = Uc(UC_ARCH_X86, UC_MODE_32)
    u.mem_map(0, 0x1000)  # Constructor's saved Win32 exception-chain pointer.
    u.mem_map(0x400000, 0x300000)
    u.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
    u.mem_map(0x700000, 0x300000)
    obj, heap, stack, stop = 0x710000, 0x730000, 0x9eff00, 0x700010
    def wi(a, v): u.mem_write(a, struct.pack('<I', int(v) & 0xffffffff))
    def ri(a): return struct.unpack('<I', u.mem_read(a, 4))[0]
    def words(a, count): return list(struct.unpack('<' + 'i' * count, u.mem_read(a, count * 4)))
    def ret(cleanup=0):
        sp = u.reg_read(UC_X86_REG_ESP)
        u.reg_write(UC_X86_REG_EIP, ri(sp))
        u.reg_write(UC_X86_REG_ESP, sp + 4 + cleanup)
    def allocation(uc, address, size, data):
        nonlocal heap
        u.reg_write(UC_X86_REG_EAX, heap)
        heap += 0x1000
        ret()
    def substitute(uc, address, size, cleanup):
        u.reg_write(UC_X86_REG_EAX, u.reg_read(UC_X86_REG_ECX))
        ret(cleanup)
    u.hook_add(UC_HOOK_CODE, allocation, begin=0x42b35b, end=0x42b35b)
    for address, cleanup in [(0x41af40,4),(0x419db0,4),(0x419e90,4),(0x4088c0,20),(0x407c50,20),(0x408940,4),(0x407cc0,4)]:
        u.hook_add(UC_HOOK_CODE, substitute, cleanup, begin=address, end=address)
    def call(address, this=obj, end=stop):
        wi(stack, stop)
        u.reg_write(UC_X86_REG_ESP, stack)
        u.reg_write(UC_X86_REG_ECX, this)
        u.emu_start(address, end)
    def row_bits(): return [f'{ri(obj + offset):08x}' for offset in (0xe8,0xec,0xf0)]
    u.reg_write(UC_X86_REG_FPCW, 0x37f)
    call(0x41baa0)
    u.mem_write(0x45eedc, struct.pack('<f', 134.6 / 15 * .001))
    result = []
    for name, bits in [('zero',0),('four',0x40800000),('positive-large',0x4cbebc20),('negative-large',0xccbebc20),('very-large',0x60ad78ec),('quiet-nan',0x7fc00000)]:
        u.mem_write(obj, bytes(0x200))
        for offset in (0xe8,0xec,0xf0): wi(obj + offset, bits)
        call(0x409d20)
        after_constructor = row_bits()
        call(0x409fa0)
        call(0x409fa0)
        after_resets = row_bits()
        for _ in range(10): call(0x40a750)
        after_updates = row_bits()
        wi(obj + 0x70, 4)
        wi(obj + 0x6c, 10910155)
        wi(ri(obj + 0xc4) + 4, 167022)
        u.mem_write(obj + 0x125, b'\1')
        call(0x40a850, end=0x40afc0)
        bp = u.reg_read(UC_X86_REG_EBP)
        entry = dict(name=name, inputBits=f'{bits:08x}', afterConstructor=after_constructor,
            afterTwoResets=after_resets, afterTenUpdates=after_updates,
            angles=words(obj + 0xd4, 4), blob=words(bp - 0x8c, 9),
            camera=words(0x45f420, 9), position=words(0x45f448, 3))
        call(0x409f80)
        entry['afterExplicitInit'] = row_bits()
        result.append(entry)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/comic-row-profile.json')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    actual = samples(args.exe)
    if args.write: args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    else: assert actual == json.loads(args.fixture.read_text()), 'Comic startup-row fixture differs'
    print(f'Native Comic row startup: {len(actual)} memory profiles verified through constructor, two Resets, ten Updates and Render')
