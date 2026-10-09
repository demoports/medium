#!/usr/bin/env python3
"""Audit native Tick-camera -> secondary Comic -> primary Tunnel ordering.

Runs the original 0x40cc90 callback dispatcher at representative 95/140-second
states. Comic's child geometry callbacks and final GPU allocation/submission
are substituted; all effect camera code, Tunnel geometry, object preparation,
visibility and projection execute. A memory-write hook observes the actual
shared camera so indirect mutations cannot be mistaken for callback snapshots.
"""
import argparse
import json
import runpy
import struct
import subprocess
from pathlib import Path

from unicorn import UC_HOOK_MEM_WRITE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parent.parent
Probe = runpy.run_path(str(ROOT / 'tools/verify-render-cache.py'))['Probe']
FIELDS = runpy.run_path(str(ROOT / 'tools/verify-tunnel-camera.py'))['FIELDS']


def inputs():
    code = """
import {readFileSync} from 'node:fs';
import {Timeline} from './src/core/Timeline.js';
import {Tunnel} from './src/effects/Tunnel.js';
const data=JSON.parse(readFileSync('./assets/timeline.json')),tunnel=new Tunnel(),samples=[];
const wanted=new Set([95000,95334,140000,140334]);
const timeline=new Timeline(data,{
 onReset:s=>tunnel.reset(s),
 onTick:s=>{if(s.layers.includes('tunnel'))tunnel.onTick(s)},
 onRenderTick:s=>{
  if(!s.layers.includes('tunnel'))return;
  if(wanted.has(s.tick))samples.push(structuredClone(s));
  tunnel.onRenderTick(s);
 },
 onCommand:(e,c)=>{if(e.name==='tunnel')tunnel.onCommand(e,c)},
 onSelect:(name,ch,s)=>{if(name==='tunnel')tunnel.reset(s)}
});
timeline.stateAt(140.334);
console.log(JSON.stringify(samples));
"""
    return json.loads(subprocess.check_output(['node', '--import', './tools/register-three.mjs',
                                              '--input-type=module', '-e', code], cwd=ROOT, text=True))


def samples(executable):
    n = Probe(executable)
    tunnel, comic, tube, bars, vtable = 0x1000000, 0x1010000, 0x1011000, 0x1012000, 0x1013000
    output = 0x1100000
    stage, writes, calls = '', [], []

    def camera_state():
        return dict(axes=n.signed(n.camera, 9), position=n.signed(n.camera + 0x28, 3))

    def memory_write(u, access, address, size, value, context):
        if stage:
            writes.append(dict(stage=stage, pc=f'0x{u.reg_read(UC_X86_REG_EIP):x}',
                               offset=address - n.camera, size=size, value=value))
    n.u.hook_add(UC_HOOK_MEM_WRITE, memory_write, begin=n.camera, end=n.camera + 0x8f)

    def entering(u, address, size, context):
        nonlocal stage
        stage = 'comic' if address == 0x40a850 else 'tunnel'
        calls.append(dict(effect=stage, camera=camera_state()))
    for address in (0x40a850, 0x4108c0):
        n.hook(address, entering)
    for address, cleanup in [(0x408b30, 12), (0x407ed0, 0), (0x41a4b0, 16)]:
        n.hook(address, lambda *args, cleanup=cleanup: n.return_call(cleanup))

    def allocate(u, address, size, context):
        u.reg_write(UC_X86_REG_EAX, output)
        n.return_call(4)
    n.hook(0x41a270, allocate)
    results = []
    for state in inputs():
        e, c = state['effects']['tunnel'], state['effects']['comic']
        n.u.mem_write(tunnel, bytes(0xd300))
        n.u.mem_write(comic, bytes(0x2000))
        n.call(0x418190, obj=n.camera)
        n.set_fog(state['fog'])
        n.integer(n.camera + 0x34, int(state['projection']['zoom'] * 65536))
        n.integer(tunnel, vtable)
        n.integer(vtable + 0x14, 0x4108c0)
        n.integer(comic, vtable + 0x40)
        n.integer(vtable + 0x54, 0x40a850)
        for address, value in [(0x4601d8, 1), (0x4601dc, 4), (0x45e9a8, tunnel), (0x45e9b4, comic), (comic + 0xc4, tube), (tube, comic), (tunnel + 0xd278, bars)]:
            n.integer(address, value)
        for key, offset in FIELDS.items():
            n.integer(tunnel + offset, e[key] - int(key in ('phase', 'counter78', 'counter7c', 'counter80')))
        for key, offset in [('cameraVX', 0xd24c), ('cameraVY', 0xd250), ('radiusX', 0xd254), ('radiusY', 0xd258), ('radiusVX', 0xd25c), ('radiusVY', 0xd260)]:
            n.integer(tunnel + offset, e[key])
        for key, offset in [('visible', 0xd270), ('deformation', 0xd26f), ('pulseLighting', 0xd26c)]:
            n.u.mem_write(tunnel + offset, bytes([e[key]]))
        n.u.mem_write(tunnel + 0xc88, b'\1' * 96)
        for key, offset in [('mode', 0x70), ('phase', 0x6c), ('scale', 0xc8), ('drift', 0xcc)]:
            n.integer(comic + offset, c[key])
        for key, offset in [('rowY', 0xec), ('rowZ', 0xf0)]:
            n.u.mem_write(comic + offset, struct.pack('<f', c[key]))
        for key, offset in [('flag11d', 0x11d), ('flag120', 0x120), ('flag121', 0x121), ('flag122', 0x122), ('fog', 0x123), ('autoCamera', 0x125)]:
            n.u.mem_write(comic + offset, bytes([c[key]]))
        n.integer(tube + 4, c['elapsedMs'])
        n.call(0x40eba0, obj=bars)
        for key, address in [('spring', 0x45ea4c), ('row32', 0x46017c), ('row64', 0x460180), ('row128', 0x460184)]:
            n.u.mem_write(address, struct.pack('<f', state[key]))
        for flag, address, vector, base in [('cameraShakeA', 0x45e9a0, 'cameraOffsetA', 0x45e9f8), ('cameraShakeB', 0x45f3c0, 'cameraOffsetB', 0x45f3c8)]:
            n.u.mem_write(address, bytes([state[flag]]))
            n.u.mem_write(base, struct.pack('<3i', *state[vector]))
        stage = 'tick'
        writes.clear()
        calls.clear()
        for register, value in [(UC_X86_REG_EBP, 0x1fd0000), (UC_X86_REG_EBX, tunnel), (UC_X86_REG_ESI, e['phase'] - 1), (UC_X86_REG_ESP, 0x1fc0000)]:
            n.u.reg_write(register, value)
        n.u.emu_start(0x40fdf3, 0x410859)
        after_tick = camera_state()
        n.begin()
        n.run_until(0x40cc90, 0x40ccbb, 0)
        after_render = camera_state()
        stage = ''
        result = dict(tick=state['tick'], autoCamera=c['autoCamera'],
                      visibleComic=[c['flag120'], c['flag121'], c['flag11d']],
                      shakeA=state['cameraOffsetA'], shakeB=state['cameraOffsetB'],
                      afterTick=after_tick, callbacks=calls.copy(), afterRender=after_render,
                      renderCameraWrites=[w for w in writes if w['stage'] != 'tick'])
        # Native photos skip effect Tick but keep both Render callbacks. With
        # no intervening Tick, another callback pair accumulates Comic shake.
        writes.clear()
        n.begin()
        n.run_until(0x40cc90, 0x40ccbb, 0)
        result['afterRenderWithoutTick'] = camera_state()
        result['cameraWritesWithoutTick'] = writes.copy()
        stage = ''
        results.append(result)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, default=ROOT / 'original/medium.exe')
    parser.add_argument('--fixture', type=Path, default=ROOT / 'tests/fixtures/native-shared-camera.json')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    actual = samples(args.exe)
    if args.write:
        args.fixture.write_text(json.dumps(actual, indent=2) + '\n')
    else:
        assert actual == json.loads(args.fixture.read_text()), 'Native shared-camera fixture differs'
    for sample in actual:
        assert [call['effect'] for call in sample['callbacks']] == ['comic', 'tunnel']
        assert sample['callbacks'][0]['camera'] == sample['afterTick']
        assert sample['callbacks'][1]['camera'] == sample['afterRender']
        assert all(write['stage'] == 'comic' for write in sample['renderCameraWrites'])
        delta = [a + b for a, b in zip(sample['shakeA'], sample['shakeB'])]
        assert sample['afterRenderWithoutTick']['position'] == [a + b for a, b in zip(sample['afterRender']['position'], delta)]
        assert all(write['stage'] == 'comic' for write in sample['cameraWritesWithoutTick'])
    print(f'Native shared camera: {len(actual)} Tick/Comic/Tunnel callback traces verified; Tunnel.Render never overwrites Comic shake')


if __name__ == '__main__':
    main()
