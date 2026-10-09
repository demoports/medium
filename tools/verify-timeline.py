#!/usr/bin/env python3
"""Compare extracted events with Medium's real x86 sequencer, using Unicorn.

The native tick, x87 math, row-change detection and jump commands are executed.
Effect callbacks, rendering and the global keyboard-command handler are stubbed;
their outputs cannot influence the sequencer clock in this build.
"""
import argparse
import json
import struct
import time
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_FPCW

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_TICKS = {1, 1000, 10000, 100000, 182543, 182544, 182545, 247627, 354613, 361744}
CLOCK_ADDRESSES = {
    'row': 0x460178, 'row32': 0x46017C, 'row64': 0x460180, 'row128': 0x460184,
    'songRow': 0x45E968, 'spring': 0x45EA4C, 'springVelocity': 0x45E96C,
    'cosine': 0x45EA04, 'envelopeA': 0x45E9E8, 'envelopeB': 0x45EEE4,
    'envelopeC': 0x45E9E4
}


def emulate(executable, count):
    emu = Uc(UC_ARCH_X86, UC_MODE_32)
    image = pefile.PE(str(executable)).get_memory_mapped_image()
    emu.mem_map(0x400000, 0x300000)
    emu.mem_write(0x400000, image)
    emu.mem_map(0x700000, 0x200000)

    def write_int(address, value):
        emu.mem_write(address, struct.pack('<I', value))

    def read_int(address):
        return struct.unpack('<I', emu.mem_read(address, 4))[0]

    def write_float(address, value):
        emu.mem_write(address, struct.pack('<f', value))

    # Minimal fake effect objects, sufficient for vtable tick/command dispatch.
    emu.mem_write(0x800000, b'\xc3\xc2\x04\x00')  # ret; ret 4
    for i in range(7):
        write_int(0x45E9A4 + i * 4, 0x710000 + i * 0x10000)
        write_int(0x710000 + i * 0x10000, 0x700000)
        write_int(0x700000 + i * 4, 0x800001 if i in (2, 3) else 0x800000)
    write_int(0x4601D8, 1)
    write_int(0x4601DC, 4)
    write_float(0x46018C, 134.6)
    for address in (0x460178, 0x46017C, 0x460180, 0x460184, 0x45E968):
        write_float(address, 10)
    emu.mem_write(0x45E974, b'\x01')
    write_int(0x45EED8, 0x43E544)
    write_int(0x45F4B0, 0x44D788)
    write_int(0x45EA48, 0xFFFFFFFF)
    write_int(0x45F3E4, 2048)
    write_int(0x45E99C, 0x4000)

    # mov ebx,count; call 0x40c160; dec ebx; jnz call; hlt.
    code = (b'\xbb' + struct.pack('<I', count) + b'\xe8' +
            struct.pack('<i', 0x40C160 - (0x810000 + 10)) + b'\x4b\x75\xf8\xf4')
    emu.mem_write(0x810000, code)
    emu.reg_write(UC_X86_REG_ESP, 0x8F0000)
    emu.reg_write(UC_X86_REG_FPCW, 0x37F)
    events, snapshots = [], []
    tick = 0

    def enter(uc, address, size, userdata):
        nonlocal tick
        tick += 1

    def return_from_call(uc):
        sp = uc.reg_read(UC_X86_REG_ESP)
        ret = read_int(sp)
        uc.reg_write(UC_X86_REG_ESP, sp + 4)
        uc.reg_write(UC_X86_REG_EIP, ret)
        return sp, ret

    def command(uc, address, size, userdata):
        sp, ret = return_from_call(uc)
        events.append({'tick': tick, 'channel': 0 if ret == 0x40C43D else 1,
                       'command': read_int(sp + 4)})

    def exit_hook(uc, address, size, userdata):
        return_from_call(uc)

    def snapshot(uc, address, size, userdata):
        if tick in SNAPSHOT_TICKS:
            snapshots.append({'tick': tick, **{
                key: struct.unpack('<f', uc.mem_read(ptr, 4))[0]
                for key, ptr in CLOCK_ADDRESSES.items()
            }})

    for address, callback in ((0x40C160, enter), (0x40BAC0, command),
                              (0x41F8A0, exit_hook), (0x40CA7C, snapshot)):
        emu.hook_add(UC_HOOK_CODE, callback, begin=address, end=address)
    emu.emu_start(0x810000, 0x81000D)
    return events, snapshots


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--timeline', type=Path, default=ROOT / 'assets/timeline.json')
    parser.add_argument('--snapshots', type=Path, help='Write native clock samples (optional).')
    args = parser.parse_args()
    timeline = json.loads(args.timeline.read_text())
    started = time.monotonic()
    events, snapshots = emulate(args.exe, round(timeline['duration'] * 1000))
    expected = [{key: event[key] for key in ('tick', 'channel', 'command')}
                for event in timeline['events']]
    if events != expected:
        differences = [(index, actual, wanted) for index, (actual, wanted)
                       in enumerate(zip(events, expected)) if actual != wanted]
        raise AssertionError(f'Native events differ: {len(events)} / {len(expected)}; '
                             f'first mismatches: {differences[:5]}')
    if args.snapshots:
        args.snapshots.parent.mkdir(parents=True, exist_ok=True)
        args.snapshots.write_text(json.dumps(snapshots, indent=2) + '\n')
    print(f"PASS: all {len(events)} native event ticks, channels and commands match; "
          f"{round(timeline['duration'] * 1000)} x86 updates, {time.monotonic() - started:.2f} s.")


if __name__ == '__main__':
    main()
