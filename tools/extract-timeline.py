#!/usr/bin/env python3
"""Recover Medium's tracker tables, then execute its float32 clock arithmetic.

All addresses refer to the original medium.exe, image base 0x400000.
No effect selection or scene timestamp is hand-authored.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import pefile

ROOT = Path(__file__).resolve().parent.parent
BASE = 0x400000
SEQUENCE = 0x44D788
BEAT_SEQUENCE = 0x43E544
OVERLAY_NAMES = 0x44DB58


def float32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def extract(executable):
    raw = executable.read_bytes()
    image = pefile.PE(data=raw).get_memory_mapped_image()

    def uint32(address):
        return struct.unpack_from('<I', image, address - BASE)[0]

    def rows(address, width):
        return [list(struct.unpack_from(f'<{width}I', image,
                    address - BASE + row * width * 4)) for row in range(16)]

    def string(address):
        return image[address - BASE:].split(b'\0', 1)[0].decode().replace('\\', '/')

    sequence = []
    address = SEQUENCE
    while uint32(address):
        sequence.append(uint32(address))
        address += 4
    patterns = {hex(p): rows(p, 4) for p in sorted(set(sequence))}
    bpm = struct.unpack('<f', struct.pack('<I', 0x4306999A))[0]
    result = {
        'sourceSha256': hashlib.sha256(raw).hexdigest(),
        'bpm': bpm, 'rowsPerBeat': 4, 'rowsPerPattern': 16, 'initialRow': 10,
        'sequenceAddress': hex(SEQUENCE), 'sequence': list(map(hex, sequence)),
        'patterns': patterns,
        'beatPatterns': [rows(uint32(BEAT_SEQUENCE + i * 4), 17) for i in range(4)],
        'overlayTextures': [string(uint32(OVERLAY_NAMES + i * 4)) for i in range(30)],
        'events': [],
        'timing': 'Float32, 1 ms simulation of 0x40c160, including initial row 10 and command 0xff skip.'
    }
    position, pattern, tick = 10.0, 0, 0
    previous = [0, 0]
    step = float32(bpm / 15 * .001)
    while True:
        tick += 1
        position = float32(position + step)
        if position >= 16:
            position = float32(position - 16)
            pattern += 1
            if pattern == len(sequence):
                break
        row = int(position)
        record = patterns[hex(sequence[pattern])][row]
        for channel, column in enumerate((0, 2)):
            command = record[column]
            if command != previous[channel] and command not in (0, 32):
                result['events'].append({
                    'time': tick / 1000, 'tick': tick, 'pattern': pattern, 'row': row,
                    'channel': channel, 'command': command,
                    'address': hex(sequence[pattern] + row * 16 + column * 4)
                })
                if channel == 0 and command == 255:
                    position = float32(position + 8)
            previous[channel] = command
    result['duration'] = tick / 1000
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/timeline.json')
    args = parser.parse_args()
    result = extract(args.exe)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    print(f"Recovered {len(result['sequence'])} patterns, {len(result['events'])} events; "
          f"native clock length {result['duration']:.3f} s. Wrote {args.output}")


if __name__ == '__main__':
    main()
