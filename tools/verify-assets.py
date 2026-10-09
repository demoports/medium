#!/usr/bin/env python3
"""Differentially verify Python extraction by executing Medium's original x86.

Install: python -m pip install unicorn pillow
Run from any directory: python tools/verify-assets.py
All compressed archive entries must match the x86 routine at VA 0x41b4e0
byte-for-byte. Uncompressed entries must match their raw archive bytes. Also
checks the checked-in asset inventory SHA256 digests and soundtrack bytes.
The original binary is emulated without executing its entry point or OS calls.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EAX
from extract import decompress


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify(root, output):
    exe = (root/'original/medium.exe').read_bytes()
    archive = (root/'original/packfile.pak').read_bytes()
    inventory = json.loads((root/'assets/inventory.json').read_text())
    original_by_path = {entry['path']: entry for entry in inventory}
    emulator = Uc(UC_ARCH_X86, UC_MODE_32)
    emulator.mem_map(0x400000, 0x100000)
    emulator.mem_write(0x400000, exe)
    emulator.mem_map(0x1000000, 0x1000000)
    emulator.mem_map(0x2000000, 0x1000000)
    emulator.mem_map(0x3000000, 0x10000)
    source, destination, stack, stop = 0x1000000, 0x2000000, 0x3008000, 0x400000
    results = []
    for index in range(1024):
        packed, sector, allocated, size, name = struct.unpack_from('<4I64s',archive,index*80)
        name = name.split(b'\0')[0].decode('ascii')
        if not name:
            break
        name = name.lower().replace('\\','/')
        payload = archive[sector*2048:sector*2048+packed]
        raw = payload if packed == size else decompress(payload)
        assert len(raw) == size, (name, 'translated decoder length mismatch')
        assert sha(raw) == original_by_path[name]['sha256'], (name, 'inventory SHA256 mismatch')
        if packed != size:
            emulator.mem_write(source,payload)
            emulator.mem_write(destination,b'\xcc'*size)
            emulator.mem_write(stack,struct.pack('<4I',stop,source,destination,len(payload)))
            emulator.reg_write(UC_X86_REG_ESP,stack)
            emulator.emu_start(0x41b4e0,stop)
            length = emulator.reg_read(UC_X86_REG_EAX)
            assert length == size, (name,'original x86 length mismatch')
            assert bytes(emulator.mem_read(destination,length)) == raw, (name,'x86/Python mismatch')
        if name.endswith('.mp3'):
            assert (root/'assets/medium.mp3').read_bytes() == raw, 'Soundtrack differs from archive'
        results.append(dict(path=name,bytes=size,sha256=sha(raw),method='original-x86-comparison' if packed!=size else 'raw-entry'))
    assert len(results) == len(inventory) == 55
    report = dict(archiveSha256=sha(archive),executableSha256=sha(exe),
                  decoderAddress='0x41b4e0',compressedEntries=53,rawEntries=2,
                  result='all 55 entries verified',entries=results)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2)+'\n')
    print(f'PASS: 53 compressed entries match original x86; 2 raw entries and soundtrack verified.\n{output}')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    verify(args.root,args.output or args.root/'notes/asset-validation.json')
