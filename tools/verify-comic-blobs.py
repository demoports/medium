#!/usr/bin/env python3
"""Execute native blob normals, lighting and texture coordinates on port surfaces.

Unlike a transform-only check, 0x4093ee–0x409bce computes forward normals,
8-bit diffuse, both UV sets and face-edge copies. The input geometry comes
from the current canonical replay; this validates shading, not blob physics.
"""
import argparse,json,struct,subprocess
from pathlib import Path
import pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ECX,UC_X86_REG_EBX,UC_X86_REG_EBP,UC_X86_REG_ESP,UC_X86_REG_FPCW
ROOT=Path(__file__).resolve().parent.parent

def samples(executable):
    source=json.loads(subprocess.check_output(['node','--import',str(ROOT/'tools/register-three.mjs'),str(ROOT/'tools/sample-comic-blobs.mjs')],text=True))
    u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,0x400000)
    u.mem_write(0x400000,pefile.PE(str(executable)).get_memory_mapped_image());u.mem_map(0x1000000,0x200000)
    u.reg_write(UC_X86_REG_FPCW,0x3f)
    parent,blob,points,output,matrix,frame,stack,stop=0x1000000,0x1001000,0x1010000,0x1030000,0x1080000,0x11e0000,0x11f0000,0x11ff000
    def wi(a,v):u.mem_write(a,struct.pack('<I',int(v)&0xffffffff))
    def ri(a,n=1):return list(struct.unpack('<'+'i'*n,u.mem_read(a,n*4)))
    wi(stack,stop);u.reg_write(UC_X86_REG_ESP,stack);u.emu_start(0x41baa0,stop)
    normals=[]
    def normal_hook(emu,pc,size,data):normals.append(ri(frame-0x38,3))
    u.hook_add(UC_HOOK_CODE,normal_hook,begin=0x409612,end=0x409612)
    results=[]
    for case in source:
        normals.clear();u.mem_write(points,struct.pack('<'+'i'*len(case['positions']),*case['positions']))
        for off,v in [(0,parent),(8,6),(12,28),(16,29),(0x1c,points)]:wi(blob+off,v)
        for i,v in enumerate([65536,0,0,0,65536,0,0,0,65536]):wi(parent+0xf4+i*4,v)
        for i,v in enumerate(case['camera']):wi(0x45f420+i*4,v)
        for i,v in enumerate(case['matrix']):wi(matrix+i*4,v)
        wi(parent+0x10,case['effect']['beats'][1]);u.mem_write(parent+0x11e,bytes([case['effect']['flag11e']]))
        wi(frame+12,matrix);wi(frame-0x48,output)
        u.reg_write(UC_X86_REG_EBP,frame);u.reg_write(UC_X86_REG_EBX,blob);u.reg_write(UC_X86_REG_ESP,stack)
        u.emu_start(0x4093ee,0x409bce)
        vertices=[]
        for face in range(6):
            for row,column in [(0,0),(3,8),(14,14),(25,20),(27,27)]:
                index=face*841+row*29+column;raw=u.mem_read(output+index*40,40)
                vertices.append(dict(index=index,normal=normals[face*784+row*28+column],diffuse=hex(struct.unpack_from('<I',raw,16)[0]),uv=list(struct.unpack_from('<4f',raw,24))))
        results.append(dict(time=case['time'],kind=case['kind'],scale=case['scale'],camera=case['camera'],matrix=case['matrix'],vertices=vertices))
    return results

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--exe',type=Path,default=ROOT/'original/medium.exe')
    p.add_argument('--fixture',type=Path,default=ROOT/'tests/fixtures/native-comic-blobs.json')
    p.add_argument('--write',action='store_true');a=p.parse_args();actual=samples(a.exe)
    if a.write:a.fixture.write_text(json.dumps(actual,indent=2)+'\n')
    elif actual!=json.loads(a.fixture.read_text()):raise SystemExit('Native blob shading differs from fixture; geometry may have changed')
    print(f'Native blob shading: {len(actual)} surfaces, {sum(len(c["vertices"]) for c in actual)} vertices verified')
if __name__=='__main__':main()
