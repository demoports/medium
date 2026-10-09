#!/usr/bin/env python3
"""Execute Medium's DirectSound refill, audio clock and mainloop tick delta.

The original 0x41d140 refills a simulated 32768-frame stereo ring through
stubbed COM endpoints. A tagged decoder substitutes PCM sample numbers, making
the actual audible/generated-frame relationship observable. The real clock
0x41d2d0, Start/GetTime and 0x40d129 tick-delta block execute. Native MP3 setup
and frame decoding are separately run to check the discarded initial frame.
Use --compare-decoder to also compare native PCM against an installed ffmpeg.
"""
import argparse
from array import array
import hashlib
import json
import runpy
import struct
import subprocess
import sys
from pathlib import Path

from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
Native = runpy.run_path(str(ROOT / 'tools/verify-effect-vertices.py'))['Native']
RATE, RING = 44100, 32768


def ring_clock(executable, startup_ms):
    n = Native(executable)
    u = n.u
    device, vtable, clock, ring = 0x1000000, 0x1001000, 0x1002000, 0x1100000
    now_ms, played_frames, ticks = 1000, 0, 0
    n.integer(device, vtable)
    n.integer(0x6143c8, device)
    n.integer(0x6143cc, clock)
    u.mem_write(ring, b'\xff' * (RING * 4))
    calls = []
    for offset, stub, argc in [(0x10, 0x1f01000, 3), (0x2c, 0x1f01100, 8), (0x4c, 0x1f01200, 5)]:
        n.integer(vtable + offset, stub)
        u.mem_write(stub, b'\x31\xc0\xc2' + struct.pack('<H', argc * 4))

    def get_position(uc, address, size, context):
        sp = uc.reg_read(UC_X86_REG_ESP)
        n.integer(n.read(sp + 8), (played_frames % RING) * 4)
        n.integer(n.read(sp + 12), ((played_frames + 512) % RING) * 4)

    def lock(uc, address, size, context):
        sp = uc.reg_read(UC_X86_REG_ESP)
        offset, length = n.read(sp + 8), n.read(sp + 12)
        first = min(length, RING * 4 - offset)
        for slot, value in [(16, ring + offset), (20, first), (24, ring), (28, length - first)]:
            n.integer(n.read(sp + slot), value)
        calls.append(dict(playFrame=played_frames, offset=offset // 4, frames=length // 4))

    def wall_clock(uc, address, size, context):
        uc.reg_write(UC_X86_REG_EAX, now_ms)
        n.return_call()

    def decode(uc, address, size, context):
        sp = uc.reg_read(UC_X86_REG_ESP)
        destination, frames = n.read(sp + 4), n.read(sp + 8)
        first = n.read(clock + 0x10)
        u.mem_write(destination, struct.pack('<' + 'I' * frames, *range(first, first + frames)))
        n.return_call(16)

    def tick(uc, address, size, context):
        nonlocal ticks
        ticks += 1
        n.return_call()
    for address, hook in [(0x1f01000, get_position), (0x1f01100, lock), (0x41f2e0, wall_clock), (0x407b60, decode), (0x40c160, tick)]:
        n.hook(address, hook)
    n.hook(0x40ca90, lambda *args: n.return_call())
    n.call(0x41d2b0, obj=clock)
    n.call(0x41d370, obj=clock)
    now_ms += startup_ms
    n.call(0x41d3a0, obj=clock)
    baseline = u.reg_read(UC_X86_REG_EAX)
    previous = baseline
    samples = []
    for played_frames in range(512, 65537, 512):
        now_ms = 1000 + round(played_frames * 1000 / RATE)
        audible = n.read(ring + (played_frames % RING) * 4)
        n.call(0x41d140)
        n.call(0x41d3a0, obj=clock)
        audio_ms = u.reg_read(UC_X86_REG_EAX)
        # Execute the original mainloop block with its saved initial GetTime.
        u.reg_write(UC_X86_REG_EBX, previous)
        u.reg_write(UC_X86_REG_ESP, n.stack)
        u.reg_write(UC_X86_REG_EBP, 0)
        u.emu_start(0x40d129, 0x40d146)
        previous = u.reg_read(UC_X86_REG_EBX)
        if played_frames in (512, 4096, 16384, 32768, 33280, 49152, 65536):
            samples.append(dict(playFrame=played_frames, audioClockMs=audio_ms, sequencerTicks=ticks,
                                audibleDecodedFrame=None if audible == 0xffffffff else audible,
                                lastLock=calls[-1]))
    return dict(startupElapsedMs=startup_ms, initialMainloopClockMs=baseline, samples=samples)


def decoder(executable, soundtrack, compare):
    n = Native(executable)
    data = soundtrack.read_bytes()
    obj, source, output = 0x1000000, 0x1010000, 0x1600000
    n.u.mem_write(source, data)
    n.call(0x404fe0, [source, len(data)], obj)
    consumed_bits = n.read(obj + 0x24)
    parts = []
    for _ in range(200 if compare else 4):
        n.call(0x405090, [output], obj)
        parts.append(bytes(n.u.mem_read(output, n.u.reg_read(UC_X86_REG_EAX))))
    result = dict(initializerConsumedBits=consumed_bits, firstMp3FrameBytes=consumed_bits // 8,
                  pcmBytesPerFrame=len(parts[0]), stereoSamplesPerFrame=len(parts[0]) // 4,
                  firstFourOutputFramesSha256=hashlib.sha256(b''.join(parts[:4])).hexdigest())
    if compare:
        modern = subprocess.check_output([compare, '-v', 'error', '-i', str(soundtrack), '-t', '6',
                                          '-f', 's16le', '-acodec', 'pcm_s16le', '-'])
        a, b = array('h', b''.join(parts)), array('h', modern)
        comparisons = []
        for shift in (0, 576, 1152, 1728, 2304):
            aa = bb = ab = 0
            for index in range(150000, 200000):
                x, y = a[index * 2], b[(index + shift) * 2]
                aa += x * x
                bb += y * y
                ab += x * y
            comparisons.append(dict(modernSampleShift=shift, correlation=ab / (aa * bb) ** .5))
        result['modernDecoderComparison'] = comparisons
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--mp3', type=Path, default=ROOT / 'assets/medium.mp3')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-audio-clock.json')
    parser.add_argument('--compare-decoder', metavar='FFMPEG', help='Optional ffmpeg binary for PCM alignment proof')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    actual = dict(sampleRate=RATE, ringFrames=RING, ringBytes=RING * 4,
                  decoder=decoder(args.exe, args.mp3, args.compare_decoder),
                  startupCases=[ring_clock(args.exe, elapsed) for elapsed in (0, 2, 7)],
                  decodedPcmLeadSeconds=RING / RATE,
                  fullMp3LeadSeconds=(RING - 1152) / RATE)
    if args.write:
        args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    else:
        expected = json.loads(args.fixture.read_text())
        if not args.compare_decoder:
            expected['decoder'].pop('modernDecoderComparison', None)
        assert actual == expected, 'Native audio-clock result differs from fixture'
    for case in actual['startupCases']:
        for sample in case['samples']:
            if sample['audibleDecodedFrame'] is not None:
                assert sample['playFrame'] - sample['audibleDecodedFrame'] == RING
            assert sample['sequencerTicks'] == sample['audioClockMs'] - case['initialMainloopClockMs']
    print('Native refill/mainloop verified: decoded PCM lead 32768/44100 s; full MP3 lead 31616/44100 s, minus startup baseline milliseconds')


if __name__ == '__main__':
    main()
