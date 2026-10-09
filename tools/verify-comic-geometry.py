#!/usr/bin/env python3
"""Capture original tube geometry and full native model-view projection.

Runs Comic.Render and Tube.Render, including their real matrix preparation
and point projector. Only the renderer's vertex allocator is stubbed.
"""
import argparse, hashlib, json, pathlib, struct
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP, UC_X86_REG_FPCW
root=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('executable',type=pathlib.Path)
parser.add_argument('--output',type=pathlib.Path,default=root/'tests/fixtures/comic-geometry.json')
args=parser.parse_args()
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,0x400000)
u.mem_write(0x400000,pefile.PE(str(args.executable)).get_memory_mapped_image());u.mem_map(0x1000000,0x200000)
u.reg_write(UC_X86_REG_FPCW,0x3f)
obj,tube,stack,stop,positions,weights,output=0x1000000,0x1001000,0x11f0000,0x11ff000,0x1010000,0x1020000,0x1030000

def wi(a,v):u.mem_write(a,struct.pack('<I',int(v)&0xffffffff))
def ri(a,n=1):return list(struct.unpack('<'+'i'*n,u.mem_read(a,n*4)))
def wf(a,v):u.mem_write(a,struct.pack('<f',v))
def call(a,this=0,arguments=(),end=stop):
 wi(stack,stop)
 for i,v in enumerate(arguments):wi(stack+4+i*4,v)
 u.reg_write(UC_X86_REG_ESP,stack);u.reg_write(UC_X86_REG_ECX,this);u.emu_start(a,end)
def allocate(emu,pc,size,data):
 sp=u.reg_read(UC_X86_REG_ESP);address=ri(sp)[0]
 u.reg_write(UC_X86_REG_EAX,output);u.reg_write(UC_X86_REG_ESP,sp+8);u.reg_write(UC_X86_REG_EIP,address)
u.hook_add(UC_HOOK_CODE,allocate,begin=0x41a270,end=0x41a270)
call(0x41baa0);wi(0x44db44,640);wi(0x44db48,480)
results=[]
for sample in json.loads((root/'tests/fixtures/comic-history.json').read_text()):
 if sample['state']['tick'] not in (140320,175320,195320,225320):continue
 case=sample['comic']
 u.mem_write(obj,b'\0'*0x200);u.mem_write(tube,b'\0'*0x200)
 call(0x418190,0x45f420)
 wi(obj+0xc4,tube);wi(tube,obj)
 for key,off in [('mode',0x70),('phase',0x6c),('scale',0xc8),('drift',0xcc)]:wi(obj+off,case[key])
 wi(tube+4,case['elapsedMs']);u.mem_write(obj+0x125,bytes([case['autoCamera']]))
 for key,off in [('rowY',0xec),('rowZ',0xf0)]:wf(obj+off,case[key])
 call(0x40a850,obj,end=0x40afc0)
 call(0x41ac90,0x460210,[0x45f420])
 for off,value in [(8,32),(12,33),(16,64),(20,65),(24,2145),(0x98,positions),(0x9c,weights)]:wi(tube+off,value)
 call(0x407ed0,tube,end=0x40881c)
 vertices=[]
 if case['autoCamera']:
  for index in range(0,2145,17):
   raw=u.mem_read(output+index*40,40);screen=list(struct.unpack_from('<4f',raw))
   if raw[20]==0:
    vertices.append({'index':index,'screen':screen[:2],'viewDepth':8/screen[3]})
 results.append({'time':sample['state']['tick']/1000,'effect':case,'sha256':hashlib.sha256(u.mem_read(positions,2145*12)).hexdigest(),'projections':vertices})
args.output.write_text(json.dumps(results,indent=2)+'\n')
print(f'Wrote {len(results)} complete native tube meshes and {sum(len(s["projections"])for s in results)} projected samples to {args.output}')
