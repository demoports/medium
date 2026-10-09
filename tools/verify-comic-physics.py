#!/usr/bin/env python3
"""Execute the native sequencer, reset, and radial spring simulation together.

The original clock supplies every visible render's age and flags, including
photo freezes. At the port's documented canonical 60 Hz cadence, run the
original 0x408940 initialization and 0x408b30 physics on 25 selected vertices
from each blob. Independent point physics permits packing these samples into
one 5x5 grid; no force, position, velocity, or direction arithmetic is stubbed.
Only renderer preparation, allocation and projection are omitted.
"""
import argparse,json,struct
from pathlib import Path
import pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX,UC_X86_REG_ECX,UC_X86_REG_EIP,UC_X86_REG_ESP,UC_X86_REG_FPCW
ROOT=Path(__file__).resolve().parent.parent

def render_history(executable):
    u=Uc(UC_ARCH_X86,UC_MODE_32)
    u.mem_map(0x400000,0x300000);u.mem_write(0x400000,pefile.PE(str(executable)).get_memory_mapped_image());u.mem_map(0x700000,0x300000)
    def w(a,v):u.mem_write(a,struct.pack('<I',v&0xffffffff))
    def r(a):return struct.unpack('<I',u.mem_read(a,4))[0]
    def si(a):return struct.unpack('<i',u.mem_read(a,4))[0]
    def f(a,v):u.mem_write(a,struct.pack('<f',v))
    def rf(a):return struct.unpack('<f',u.mem_read(a,4))[0]
    u.mem_write(0x800000,b'\xc3\xc2\x04\x00')
    for i in range(7):
     obj=0x710000+i*0x10000;vt=0x700000+i*0x100
     w(0x45e9a4+i*4,obj);w(obj,vt)
     for j in range(7):w(vt+j*4,0x800001 if j in (2,3) else 0x800000)
    for i,vt in [(1,0x434658),(4,0x434414),(5,0x4345d4)]:
     for j in range(7):w(0x700000+i*0x100+j*4,r(vt+j*4))
     if i!=4:w(0x700000+i*0x100+0x10,0x800000)
    comic=0x750000;tunnel=0x720000;makina=0x760000
    for off,p in [(0xbc,0x780000),(0xc0,0x781000),(0xc4,0x782000)]:w(comic+off,p);w(p,comic)
    w(tunnel+0xd278,0x783000);w(makina+0xb0,0x784000)
    def ret(uc,n):
     sp=uc.reg_read(UC_X86_REG_ESP);ra=r(sp);uc.reg_write(UC_X86_REG_ESP,sp+4+n);uc.reg_write(UC_X86_REG_EIP,ra)
    def stub(uc,a,size,d):ret(uc,4 if a in (0x408940,0x407cc0) else 0)
    for a in (0x408940,0x407cc0,0x40eba0,0x41f8a0):u.hook_add(UC_HOOK_CODE,stub,begin=a,end=a)
    def call(a,obj=0):
     w(0x8f0000,0x800010);u.reg_write(UC_X86_REG_ESP,0x8f0000);u.reg_write(UC_X86_REG_ECX,obj);u.emu_start(a,0x800010)
    u.reg_write(UC_X86_REG_FPCW,0x37f);call(0x41baa0)
    call(0x40f2d0,tunnel);call(0x409fa0,comic);call(0x40d650,makina);call(0x40f2d0,tunnel)
    w(0x4601d8,1);w(0x4601dc,4);f(0x46018c,134.6)
    for a in (0x460178,0x46017c,0x460180,0x460184,0x45e968):f(a,10)
    u.mem_write(0x45e974,b'\x01');w(0x45eed8,0x43e544);w(0x45f4b0,0x44d788);w(0x45ea48,0xffffffff)
    w(0x45f3e4,2048);w(0x45e99c,0x4000)
    count=225320;code=b'\xbb'+struct.pack('<I',count)+b'\xe8'+struct.pack('<i',0x40c160-(0x810000+10))+b'\x4b\x75\xf8\xf4';u.mem_write(0x810000,code)

    clock={'tick':0,'accumulator':0};history=[[0,0,0]]
    wanted={140320,175320,195320,225320}
    def enter(uc,a,size,d):clock['tick']+=1
    def reset_hook(uc,a,size,d):
     clock['accumulator']=0;history.append([clock['tick'],0,0])
    def snapshot(uc,a,size,d):
     if 4 in [r(0x4601d8),r(0x4601dc)]:
      clock['accumulator']+=60
      if clock['accumulator']>=1000:
       clock['accumulator']-=1000
       for kind in (0,1):
        if u.mem_read(comic+0x120+kind,1)[0]:history.append([clock['tick'],kind+1,si(0x782004)])
     if clock['tick'] in wanted:history.append([clock['tick'],3,0])
    for a,fn in [(0x40c160,enter),(0x409fa0,reset_hook),(0x40ca7c,snapshot)]:u.hook_add(UC_HOOK_CODE,fn,begin=a,end=a)
    u.reg_write(UC_X86_REG_ESP,0x8f0000);u.emu_start(0x810000,0x81000d)
    return history


def samples(executable,history):
    u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,0x400000);u.mem_write(0x400000,pefile.PE(str(executable)).get_memory_mapped_image());u.mem_map(0x1000000,0x300000)
    u.reg_write(UC_X86_REG_FPCW,0x3f)
    stack,stop,zero,matrix=0x12f0000,0x12ff000,0x12e0000,0x12e1000
    wi=lambda a,v:u.mem_write(a,struct.pack('<I',int(v)&0xffffffff))
    ri=lambda a,n=1:list(struct.unpack('<'+'i'*n,u.mem_read(a,n*4)))
    def call(pc,this=0,args=(),end=stop):
     wi(stack,stop)
     for i,v in enumerate(args):wi(stack+4+4*i,v)
     u.reg_write(UC_X86_REG_ESP,stack);u.reg_write(UC_X86_REG_ECX,this);u.emu_start(pc,end)
    call(0x41baa0)
    for i,v in enumerate([65536,0,0,0,65536,0,0,0,65536]):wi(matrix+4*i,v)
    indices=[((x-2)//6+(y-2)//6)%6*841+y*29+x for y in (2,8,14,20,26) for x in (2,8,14,20,26)]
    objects=[]
    for kind,radius in enumerate((512,24576)):
     obj=0x1000000+kind*0x60000;pos=obj+0x1000;dire=obj+0x11000;vel=obj+0x21000;buf=obj+0x31000
     for off,val in [(8,6),(12,28),(16,29),(20,5046),(24,kind),(28,pos),(32,dire),(36,vel)]:wi(obj+off,val)
     call(0x408940,obj,[radius])
     vectors={name:[ri(ptr+i*12,3)for i in indices]for name,ptr in [('positions',pos),('directions',dire),('velocities',vel)]}
     for name,ptr in [('positions',pos),('directions',dire),('velocities',vel)]:
      for i,v in enumerate(vectors[name]):u.mem_write(ptr+i*12,struct.pack('<3i',*v))
     for off,val in [(8,1),(12,4),(16,5),(20,25)]:wi(obj+off,val)
     objects.append((obj,pos,vel,buf))
    def stub(uc,a,size,d):
     sp=uc.reg_read(UC_X86_REG_ESP);ra=ri(sp)[0]
     if a==0x41a270:uc.reg_write(UC_X86_REG_EAX,0x1200000)
     uc.reg_write(UC_X86_REG_ESP,sp+4+(12 if a==0x418260 else 4));uc.reg_write(UC_X86_REG_EIP,ra)
    for pc in (0x41a980,0x41a270,0x418260):u.hook_add(UC_HOOK_CODE,stub,begin=pc,end=pc)

    result=[];count=[0,0]
    for tick,kind,age in history:
     if kind in (1,2):
      obj,pos,vel,buf=objects[kind-1];wi(obj+4,age);call(0x408b30,obj,[zero,matrix,65536],end=0x4093ee);count[kind-1]+=1
     elif kind==3:
      for k,(obj,pos,vel,buf) in enumerate(objects):
       if tick==140320 and k==1:continue
       result.append(dict(tick=tick,kind=k,frames=count[k],vertices=[dict(index=index,position=ri(pos+j*12,3)) for j,index in enumerate(indices)]))
    return dict(cadenceHz=60,resetTicks=[v[0] for v in history if v[1]==0],samples=result)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--exe',type=Path,default=ROOT/'original/medium.exe')
    p.add_argument('--fixture',type=Path,default=ROOT/'tests/fixtures/native-comic-physics.json')
    p.add_argument('--write',action='store_true');a=p.parse_args()
    actual=samples(a.exe,render_history(a.exe))
    if a.write:a.fixture.write_text(json.dumps(actual,indent=2)+'\n')
    elif actual!=json.loads(a.fixture.read_text()):raise SystemExit('Native blob physics differs from fixture')
    print(f'Native blob physics: {len(actual["samples"])} snapshots of25vertices, reset ticks{actual["resetTicks"]}, canonical{actual["cadenceHz"]}Hz verified')
if __name__=='__main__':main()
