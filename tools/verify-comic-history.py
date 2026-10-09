#!/usr/bin/env python3
"""Run the original sequencer with native Comic commands, resets, and ticks.

All three effects' command/reset handlers execute, preserving the shared RNG.
Non-Comic per-tick effects and geometry-only resets are omitted. Comic state,
including its geometry ages, is read from original x86 memory after each tick.
"""
import argparse,pathlib,struct,json,pefile,time
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
root=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('executable',type=pathlib.Path)
parser.add_argument('--output',type=pathlib.Path,default=root/'tests/fixtures/comic-history.json')
args=parser.parse_args()
u=Uc(UC_ARCH_X86,UC_MODE_32)
u.mem_map(0x400000,0x300000);u.mem_write(0x400000,pefile.PE(str(args.executable)).get_memory_mapped_image());u.mem_map(0x700000,0x300000)
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
count=361745;code=b'\xbb'+struct.pack('<I',count)+b'\xe8'+struct.pack('<i',0x40c160-(0x810000+10))+b'\x4b\x75\xf8\xf4';u.mem_write(0x810000,code)
tick=0;snapshots=[];events=[]
wanted={1,1000,10000,20000,40000,95000,100000,140320,160320,175320,195320,225320,247627,280000,320000,350000,361745}
def enter(uc,a,size,d):
 global tick;tick+=1

def command(uc,a,size,d):
 sp=uc.reg_read(UC_X86_REG_ESP)
 events.append({'tick':tick,'return':r(sp),'command':r(sp+4)})
def snapshot(uc,a,size,d):
 if tick in wanted:
  names={'row':0x460178,'row32':0x46017c,'row64':0x460180,'row128':0x460184,'songRow':0x45e968,'spring':0x45ea4c,'springVelocity':0x45e96c,'cosine':0x45ea04}
  state={'tick':tick,**{k:rf(v)for k,v in names.items()},'randomA':si(0x44fd5c),'randomB':si(0x44fd60),'layers':[r(0x4601d8),r(0x4601dc)]}
  effect={k:si(comic+v)for k,v in {'mode':0x70,'phase':0x6c,'scale':0xc8,'drift':0xcc,'driftVelocity':0xd0,'beatFlags':8}.items()}
  effect.update({k:rf(comic+v)for k,v in {'rowX':0xe8,'rowY':0xec,'rowZ':0xf0}.items()})
  effect.update({k:bool(u.mem_read(comic+v,1)[0])for k,v in {'alternateTextures':0x11c,'flag11d':0x11d,'flag11e':0x11e,'flag11f':0x11f,'flag120':0x120,'flag121':0x121,'flag122':0x122,'fog':0x123,'flag124':0x124,'autoCamera':0x125}.items()})
  effect['elapsedMs']=si(0x782004);effect['beats']=[si(comic+12+i*4)for i in range(8)]
  snapshots.append({'state':state,'comic':effect})
for a,fn in [(0x40c160,enter),(0x40bac0,command),(0x40ca7c,snapshot)]:u.hook_add(UC_HOOK_CODE,fn,begin=a,end=a)
u.reg_write(UC_X86_REG_ESP,0x8f0000)
t=time.time()
try:u.emu_start(0x810000,0x81000d)
except Exception as e:
 print('FAIL',e,'at',hex(u.reg_read(UC_X86_REG_EIP)),'tick',tick);raise
print('native ticks',tick,'events',len(events),'seconds',time.time()-t)
args.output.write_text(json.dumps(snapshots,indent=2)+'\n')
print(f'Wrote {len(snapshots)} original Comic state snapshots to {args.output}')
