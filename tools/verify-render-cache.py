#!/usr/bin/env python3
"""Execute frame-begin camera caching followed by native Comic rendering.

The three frames straddle the 225339 ms mode change. The original Tube.Render,
vertex allocator, projector, CPU clipper and index submission execute without
stubs. State inputs come from the independently verified 1 ms JS sequencer.
Separate synthetic fog cases distinguish cached slope/GPU state from live
vertex-fog bounds. Only D3D COM state-setting endpoints are substituted.
"""
import argparse
import hashlib
import json
import runpy
import struct
import subprocess
import sys
from pathlib import Path

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ECX, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
Native = runpy.run_path(str(ROOT / 'tools/verify-effect-vertices.py'))['Native']


class Probe(Native):
    camera, engine = 0x45f420, 0x460210

    def __init__(self, executable):
        super().__init__(executable)
        self.integer(0x44db44, 640)
        self.integer(0x44db48, 480)
        self.call(0x418190, obj=self.camera)
        self.gpu = {}
        device, vtable = 0x1f00000, 0x1f00100
        self.integer(0x614cd0, device)
        self.integer(device, vtable)
        for offset, address, argc in [(0x50, 0x1f01000, 3), (0x94, 0x1f01100, 4)]:
            self.integer(vtable + offset, address)
            self.u.mem_write(address, b'\x31\xc0\xc2' + struct.pack('<H', argc * 4))

        def render_state(u, address, size, context):
            stack = u.reg_read(UC_X86_REG_ESP)
            self.gpu[self.read(stack + 8)] = self.read(stack + 12)
        self.u.hook_add(UC_HOOK_CODE, render_state, begin=0x1f01000, end=0x1f01000)

    def run_until(self, address, end, obj):
        self.u.reg_write(UC_X86_REG_ESP, self.stack)
        self.u.reg_write(UC_X86_REG_ECX, obj)
        self.integer(self.stack, self.stop)
        self.u.emu_start(address, end)

    def float(self, address):
        return struct.unpack('<f', self.u.mem_read(address, 4))[0]

    def signed(self, address, count=1):
        return list(struct.unpack('<' + 'i' * count, self.u.mem_read(address, count * 4)))

    def set_fog(self, fog):
        self.u.mem_write(self.camera + 0x5b, bytes([fog['enabled']]))
        for offset, value in [(0x64, fog['near'] * 65536), (0x68, fog['far'] * 65536),
                              (0x6c, fog['min']), (0x70, fog['max'])]:
            self.integer(self.camera + offset, value)
        color = fog['color']
        self.integer(self.camera + 0x74, (color[0] << 16) | (color[1] << 8) | color[2])

    def begin(self):
        self.call(0x41ac90, [self.camera], self.engine)
        # Stop before clear/BeginScene, after every frame-begin D3D state write.
        self.run_until(0x4153e0, 0x4155ef, self.engine)
        focal = self.float(self.engine + 0x94)
        return dict(focalPerFixedUnit=focal, zoom=focal * 65536 * 8 / 640,
                    fogSlope=self.float(self.engine + 0xbc) * 65536,
                    gpuFogEnabled=bool(self.gpu[28]), gpuFogColor=self.gpu[34],
                    near=self.signed(self.engine + 0xb0)[0] / 65536,
                    far=self.signed(self.engine + 0xb4)[0] / 65536)


def timeline_inputs():
    code = """
import {readFileSync} from 'node:fs';
import {Timeline} from './src/core/Timeline.js';
const data=JSON.parse(readFileSync('./assets/timeline.json'));
const timeline=new Timeline(data), result=[];
for(const tick of [225317,225334,225350,225367]){
 const s=timeline.stateAt((tick+.0001)/1000);
 result.push({tick,effect:structuredClone(s.effects.comic),fog:structuredClone(s.fog)});
}
console.log(JSON.stringify(result));
"""
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))


def comic_frames(executable):
    n = Probe(executable)
    obj, tube, positions, weights, vertices, indices = 0x1000000, 0x1001000, 0x1010000, 0x1020000, 0x1100000, 0x1500000
    n.integer(obj + 0xc4, tube)
    n.integer(tube, obj)
    for offset, value in [(8, 32), (12, 33), (16, 64), (20, 65), (24, 2145), (0x98, positions), (0x9c, weights)]:
        n.integer(tube + offset, value)

    def render_camera(sample):
        effect = sample['effect']
        for key, offset in [('mode', 0x70), ('phase', 0x6c), ('scale', 0xc8), ('drift', 0xcc)]:
            n.integer(obj + offset, effect[key])
        for key, offset in [('rowY', 0xec), ('rowZ', 0xf0)]:
            n.u.mem_write(obj + offset, struct.pack('<f', effect[key]))
        n.integer(tube + 4, effect['elapsedMs'])
        n.u.mem_write(obj + 0x125, bytes([effect['autoCamera']]))
        n.u.mem_write(obj + 0x123, bytes([effect['fog']]))
        n.run_until(0x40a850, 0x40afc0, obj)

    inputs = timeline_inputs()
    n.set_fog(inputs[0]['fog'])
    render_camera(inputs[0])
    result = []
    for sample in inputs[1:]:
        cache = n.begin()
        render_camera(sample)
        n.integer(0x460244, 10092)  # Two preceding 5046-vertex Blob objects.
        n.integer(0x460248, vertices)
        for offset, value in [(0, 0x40070304), (0x10, indices), (0x14, indices), (0x18, 131072)]:
            n.integer(0x461b7c + offset, value)
        n.call(0x407ed0, obj=tube)
        index_count = (n.read(0x461b7c + 0x14) - indices) // 2
        native_indices = struct.unpack('<' + 'H' * index_count, n.u.mem_read(indices, index_count * 2))
        projected = []
        for index in range(0, 2145, 43):
            raw = n.u.mem_read(vertices + (10092 + index) * 40, 40)
            if not raw[20] & 0x30:
                x, y, z, rhw = struct.unpack_from('<4f', raw)
                projected.append(dict(index=index, screen=[x, y], depth=8 / rhw, fog=raw[23]))
        result.append(dict(**sample, cache=cache,
                           liveZoom=n.signed(n.camera + 0x34)[0] / 65536,
                           camera=n.signed(n.camera, 9), cameraPosition=n.signed(n.camera + 0x28, 3),
                           geometrySha256=hashlib.sha256(n.u.mem_read(positions, 2145 * 12)).hexdigest(),
                           projected=projected, vertexCount=n.read(0x460244), indexCount=index_count,
                           indexRange=[min(native_indices), max(native_indices)]))
    return result


def fog_cases(executable):
    n = Probe(executable)
    obj, point, vertex = 0x1000000, 0x1001000, 0x1002000
    n.call(0x417f80, obj=obj)
    n.u.mem_write(obj + 0x86, b'\1')
    base = dict(enabled=True, color=[16, 22, 32], near=2048, far=7168, min=255, max=255)
    cases = [('unchanged', base, base),
             ('changed bounds', base, {**base, 'near':1024, 'far':5120, 'min':128, 'max':192}),
             ('slope wraps byte', {**base, 'near':0, 'far':1024}, {**base, 'near':0, 'far':8192}),
             ('GPU disabled before live enable', {**base, 'enabled':False}, base),
             ('GPU enabled before live disable', base, {**base, 'enabled':False}),
             ('live color changes after GPU color', base, {**base, 'color':[240, 48, 16]})]
    results = []
    for name, old, live in cases:
        n.set_fog(old)
        cache = n.begin()
        n.set_fog(live)
        n.call(0x41a980, [obj], n.engine)
        samples = []
        for depth in [32, 1024, 2048, 2560, 3072, 4096, 5120, 7168, 8192]:
            for i, value in enumerate([0, 0, depth * 4]):
                n.integer(point + i * 4, value)
            n.call(0x418260, [point, vertex, obj], n.engine)
            samples.append(dict(depth=depth, byte=n.u.mem_read(vertex + 23, 1)[0]))
        results.append(dict(name=name, before=old, live=live, cache=cache, samples=samples))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-render-cache.json')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    actual = dict(frames=comic_frames(args.exe), fogCases=fog_cases(args.exe))
    if args.write:
        args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    elif actual != json.loads(args.fixture.read_text()):
        raise SystemExit('Native frame-cache execution differs from fixture')
    print(f'Native frame cache verified: {len(actual["frames"])} complete Tube renders across mode cut, '
          f'{sum(len(c["samples"]) for c in actual["fogCases"])} split-fog vertices')


if __name__ == '__main__':
    main()
