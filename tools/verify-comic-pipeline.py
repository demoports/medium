#!/usr/bin/env python3
"""Execute Comic tube geometry, forward normals, diffuse, UVs, projection and fog.

The full released 0x407ed0 render routine runs through its seam-copy loop.
Only vertex-buffer allocation is stubbed. The inputs use the recorded 160.32 s
Comic state and a fixed external camera from the 159 s Tunnel fixture. These
are intentional independent pipeline inputs, not a full playback capture.
"""
import argparse
import json
import struct
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_FPCW
ROOT = Path(__file__).resolve().parent.parent

def samples(executable):
    u=Uc(UC_ARCH_X86, UC_MODE_32)
    u.mem_map(0x400000,0x400000)
    u.mem_write(0x400000,pefile.PE(str(executable)).get_memory_mapped_image())
    u.mem_map(0x1000000,0x200000)
    u.reg_write(UC_X86_REG_FPCW,0x3f)
    obj,tube,stack,stop,positions,weights,output=0x1000000,0x1001000,0x11f0000,0x11ff000,0x1010000,0x1020000,0x1030000
    def wi(a,v):u.mem_write(a,struct.pack('<I',int(v)&0xffffffff))
    def ri(a,n=1):return list(struct.unpack('<'+'i'*n,u.mem_read(a,n*4)))
    def wf(a,v):u.mem_write(a,struct.pack('<f',v))
    def call(a,this=0,args=(),end=stop):
        wi(stack,stop)
        for i,v in enumerate(args):wi(stack+4+i*4,v)
        u.reg_write(UC_X86_REG_ESP,stack);u.reg_write(UC_X86_REG_ECX,this);u.emu_start(a,end)
    normals=[]
    def hook(emu,pc,size,data):
        if pc==0x41a270:
            sp=u.reg_read(UC_X86_REG_ESP)
            u.reg_write(UC_X86_REG_EAX,output)
            u.reg_write(UC_X86_REG_ESP,sp+8)
            u.reg_write(UC_X86_REG_EIP,ri(sp)[0])
        elif pc==0x4085e6:normals.append(ri(u.reg_read(UC_X86_REG_EBP)-0x34,3))
    for pc in [0x41a270,0x4085e6]:u.hook_add(UC_HOOK_CODE,hook,begin=pc,end=pc)
    call(0x41baa0)
    wi(0x44db44,640);wi(0x44db48,480)
    case=json.loads((ROOT/'tests/fixtures/comic-lighting.json').read_text())[5]
    camera=min(json.loads((ROOT/'tests/fixtures/native-tunnel-camera.json').read_text()),key=lambda x:abs(x['time']-160.32))
    call(0x418190,0x45f420)
    for i,x in enumerate(camera['axes']):wi(0x45f420+i*4,x*65536*(-1 if i<3 or i>=6 else 1))
    for i,x in enumerate(camera['position']):wi(0x45f448+i*4,x*65536)
    wi(0x45f454,65536)
    for off,x in [(0x64,2048*65536),(0x68,7168*65536),(0x6c,255),(0x70,255)]:wi(0x45f420+off,x)
    u.mem_write(0x45f47b,b'\1')
    call(0x41ac90,0x460210,[0x45f420])
    wi(obj+0xc4,tube);wi(tube,obj);wi(obj+0x70,case['mode']);wi(obj+0x6c,case['phase']);wi(tube+4,case['elapsedMs'])
    u.mem_write(obj+0x125,bytes([case['autoCamera']]))
    u.mem_write(obj+0x11e,b'\1')
    for k,off in [('rowY',0xec),('rowZ',0xf0)]:wf(obj+off,case[k])
    call(0x40a850,obj,end=0x40afc0)
    for off,v in [(8,32),(12,33),(16,64),(20,65),(24,2145),(0x98,positions),(0x9c,weights)]:wi(tube+off,v)
    call(0x407ed0,tube,end=0x40886a)
    vertices=[]
    for j in (0,1,16,32,48,62,63):
        for i in (0,1,7,15,23,31,32):
            index=j*33+i;raw=u.mem_read(output+index*40,40)
            vertices.append(dict(index=index,position=ri(positions+index*12,3),normal=normals[j*32+(0 if i==32 else i)],screen=list(struct.unpack_from('<4f',raw)),diffuse=hex(struct.unpack_from('<I',raw,16)[0]),fog=raw[23],uv=list(struct.unpack_from('<4f',raw,24))))
    # Trace exact blob lighting seam copies by filling color with its vertex ID.
    frame=0x11e0000;count=6*29*29
    wi(obj+8,6);wi(obj+12,28);wi(obj+16,29);wi(frame-0x48,output)
    for i in range(count):wi(output+i*40+16,i)
    u.reg_write(UC_X86_REG_EBP,frame);u.reg_write(UC_X86_REG_EBX,obj);u.reg_write(UC_X86_REG_ESP,stack)
    u.emu_start(0x409899,0x409bce)
    seams=[[i,ri(output+i*40+16)[0]] for i in range(count) if ri(output+i*40+16)[0]!=i]
    # Exercise the same native quad emitter called by all three Comic meshes.
    engine,buffer,indices=0x1100000,0x1101000,0x1102000
    wi(engine+0x5c,output);wi(engine+0x58,buffer)
    wi(buffer+0x10,indices);wi(buffer+0x18,1024)
    u.mem_write(output,b'\0'*(40*100))
    quads=[]
    for name,arguments in [('tube',[0,33,34,1]),('smallBlob',[0,29,30,1]),('outerBlob',[0,1,30,29])]:
        wi(buffer+0x14,indices)
        call(0x41a4b0,engine,arguments)
        quads.append(dict(name=name,arguments=arguments,indices=list(struct.unpack('<6H',u.mem_read(indices,12)))))
    return dict(case=case,camera=camera,vertices=vertices,blobSeams=seams,quads=quads)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--exe',type=Path,default=ROOT/'original/medium.exe')
    p.add_argument('--fixture',type=Path,default=ROOT/'tests/fixtures/native-comic-pipeline.json')
    p.add_argument('--write',action='store_true');a=p.parse_args();actual=samples(a.exe)
    if a.write:a.fixture.write_text(json.dumps(actual,indent=2)+'\n')
    elif actual!=json.loads(a.fixture.read_text()):raise SystemExit('Native Comic pipeline differs from fixture')
    print(f'Native Comic pipeline: {len(actual["vertices"])} complete vertices and {len(actual["blobSeams"])} cross-face lighting copies verified')
if __name__=='__main__':main()
