#!/usr/bin/env python3
"""Capture Comic's native lighting/environment-map matrices with Unicorn.

Executes Comic.Render (0x40a850), then the tube's matrix preparation at
0x408361–0x408430. Inputs cover every camera mode and the reference samples.
"""
import argparse
import json
import pathlib
import struct

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EBP, UC_X86_REG_ECX, UC_X86_REG_EBX

root = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('executable', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path, default=root / 'tests/fixtures/comic-lighting.json')
args = parser.parse_args()
u = Uc(UC_ARCH_X86, UC_MODE_32)
u.mem_map(0x400000, 0x400000)
u.mem_write(0x400000, pefile.PE(str(args.executable)).get_memory_mapped_image())
u.mem_map(0x1000000, 0x30000)
stack, stop, obj, tube = 0x1020000, 0x1028000, 0x1000000, 0x1001000

def wi(address, value):
    u.mem_write(address, struct.pack('<I', value & 0xffffffff))

def ri(address, count=1):
    return list(struct.unpack('<' + 'i' * count, u.mem_read(address, count * 4)))

def call(address, end=stop):
    wi(stack, stop)
    u.reg_write(UC_X86_REG_ESP, stack)
    u.reg_write(UC_X86_REG_ECX, obj)
    u.emu_start(address, end)

call(0x41baa0)
samples = json.loads((root / 'tests/fixtures/comic-transforms.json').read_text())
results = []
for sample in samples:
    case = {key: sample[key] for key in ['mode', 'autoCamera', 'phase', 'elapsedMs', 'rowY', 'rowZ']}
    if 'time' in sample:
        case['time'] = sample['time']
    u.mem_write(obj, b'\0' * 0x200)
    u.mem_write(tube, b'\0' * 0x200)
    wi(obj + 0xc4, tube)
    wi(tube, obj)
    wi(obj + 0x70, case['mode'])
    wi(obj + 0x6c, case['phase'])
    wi(tube + 4, case['elapsedMs'])
    u.mem_write(obj + 0x125, bytes([case['autoCamera']]))
    for key, offset in [('rowY', 0xec), ('rowZ', 0xf0)]:
        u.mem_write(obj + offset, struct.pack('<f', case[key]))
    wi(0x45ea50, 0)
    wi(0x45ea54, 0)
    call(0x40a850, 0x40afc0)
    case['blobLight'] = ri(obj + 0xf4, 9)
    # Resume only the native tube matrix block, with a fresh local frame.
    frame = stack - 0x1000
    u.reg_write(UC_X86_REG_EBP, frame)
    u.reg_write(UC_X86_REG_ESP, frame - 0x300)
    u.reg_write(UC_X86_REG_EBX, tube)
    u.emu_start(0x408361, 0x408430)
    case['tubeLight'] = ri(frame - 0xb8, 9)
    case['tubeView'] = ri(frame - 0xe0, 9)
    results.append(case)

args.output.write_text(json.dumps(results, indent=2) + '\n')
print(f'Captured {len(results)} native Comic lighting samples in {args.output}')
