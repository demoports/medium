#!/usr/bin/env python3
"""Run native camera/object preparation, projection and fog together.

Unlike verify-projection.py's projector-in-isolation fixture, this includes
0x41a980, which multiplies the camera basis by 0x4000 before transforming points.
"""
import argparse
import json
import struct
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ECX, UC_X86_REG_ESP, UC_X86_REG_FPCW
ROOT = Path(__file__).resolve().parent.parent

def samples(executable):
    u = Uc(UC_ARCH_X86, UC_MODE_32)
    u.mem_map(0x400000, 0x300000)
    u.mem_write(0x400000, pefile.PE(str(executable)).get_memory_mapped_image())
    u.mem_map(0x700000, 0x200000)
    u.reg_write(UC_X86_REG_FPCW, 0x3f)
    camera, engine, obj, point, vertex, stack, stop = 0x720000,0x730000,0x740000,0x750000,0x760000,0x8eff00,0x800010
    def wi(a,v): u.mem_write(a, struct.pack('<I', int(v) & 0xffffffff))
    def ri(a,n): return list(struct.unpack('<'+'i'*n,u.mem_read(a,n*4)))
    def call(pc,this,args=()):
        wi(stack,stop)
        for i,v in enumerate(args): wi(stack+4+i*4,v)
        u.reg_write(UC_X86_REG_ESP,stack);u.reg_write(UC_X86_REG_ECX,this);u.emu_start(pc,stop)
    wi(0x44db44,640);wi(0x44db48,480)
    cases = [
        ('identity', [1,0,0,0,1,0,0,0,1], [0,0,0], [0,0,0]),
        ('translated', [1,0,0,0,1,0,0,0,1], [512,-256,-1024], [128,64,2048]),
        ('quarter-turn', [0,0,-1,0,1,0,1,0,0], [0,0,0], [16384,0,0]),
        ('reflected', [1,0,0,0,-1,0,0,0,1], [0,0,0], [0,0,0])
    ]
    result=[]
    for name,axes,position,translation in cases:
        call(0x418190,camera);call(0x417f80,obj)
        u.mem_write(obj+0x86,b'\1')
        for i,x in enumerate(axes): wi(camera+i*4,x*65536)
        for i,x in enumerate(position): wi(camera+0x28+i*4,x*65536)
        for i,x in enumerate(translation): wi(obj+4+i*4,x*65536)
        for off,x in [(0x64,2048*65536),(0x68,7168*65536),(0x6c,255),(0x70,255)]:wi(camera+off,x)
        u.mem_write(camera+0x5b,b'\1')
        call(0x41ac90,engine,[camera]);call(0x41a980,engine,[obj])
        values=[]
        for xyz in ([0,0,31],[0,0,32],[0,0,33],[0,0,8192],[0,0,16384],[0,0,32767],[0,0,40959],[0,0,40960],[0,0,40961],[1024,512,4096],[-1024,-512,4096]):
            for i,x in enumerate(xyz):wi(point+i*4,x)
            call(0x418260,engine,[point,vertex,obj]);raw=u.mem_read(vertex,40)
            values.append(dict(point=xyz,flags=raw[20],fog=raw[23],output=list(struct.unpack_from('<4f',raw))))
        result.append(dict(name=name,axes=axes,position=position,translation=translation,preparedBasis=ri(obj+0xc0,9),preparedTranslation=ri(obj+0xb4,3),vertices=values))
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--exe',type=Path,default=ROOT/'original/medium.exe')
    p.add_argument('--fixture',type=Path,default=ROOT/'tests/fixtures/native-view-transform.json')
    p.add_argument('--write',action='store_true');a=p.parse_args();actual=samples(a.exe)
    if a.write:a.fixture.write_text(json.dumps(actual,indent=2)+'\n')
    elif actual!=json.loads(a.fixture.read_text()):raise SystemExit('Native view transform differs from fixture')
    print(f'Native full view preparation: {len(actual)} camera configurations, {sum(len(c["vertices"]) for c in actual)} projected/fogged vertices verified')
if __name__=='__main__':main()
