#!/usr/bin/env python3
"""Check Comic camera/projection after sequential native Render callbacks.

Runs 225320 original sequencer ticks and Comic.Render every 20 ms. Geometry is
omitted between samples. At samples both Blob.Render callbacks execute before
Tube.Render, with current port surfaces supplied as input and zero velocity.
This validates camera/cache/submission order, not the supplied blob physics.
Only vertex allocation and final hardware quad submission are substituted.
"""
import argparse,pathlib,struct,json,pefile,time,subprocess
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
root=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('executable',type=pathlib.Path,nargs='?',default=root/'original/medium.exe')
parser.add_argument('--output',type=pathlib.Path)
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

# Preserve real Render camera, orbit and light state. Stub final hardware submission.
for addr,n in [(0x41a4b0,16)]:
 u.hook_add(UC_HOOK_CODE,lambda uc,a,size,n:ret(uc,n),n,begin=addr,end=addr)
w(0x44db44,640);w(0x44db48,480);call(0x418190,0x45f420)
w(0x4602dc,0x45f420)
for bo,kind,pp,dp,vp,radius in [(0x780000,0,0x920000,0x930000,0x940000,512),(0x781000,1,0x950000,0x960000,0x970000,24576)]:
 for off,value in [(8,6),(12,28),(16,29),(20,5046),(24,kind),(0x1c,pp),(0x20,dp),(0x24,vp)]:w(bo+off,value)
 # The history harness skips native geometry resets. Initialize safely now.
 for i in range(5046):
  for j,d in enumerate([0,0,65536]):w(dp+i*12+j*4,d);w(pp+i*12+j*4,d*radius)

count=225320;code=bytearray();base=0x810000
labels={};fixes=[]
def put(b):code.extend(b)
def label(n):labels[n]=len(code)
def branch(op,n):put(op);fixes.append((len(code),n));put(b'\0'*4)
def ca(a):put(b'\xe8'+struct.pack('<i',a-(base+len(code)+5)))
put(b'\xbb'+struct.pack('<I',count)+b'\x31\xf6');label('tick');ca(0x40c160)
put(b'\x46\x83\xfe\x14');branch(b'\x0f\x8c','skip')
put(b'\x31\xf6\x83\x3d'+struct.pack('<I',0x4601d8)+b'\x04');branch(b'\x0f\x84','render')
put(b'\x83\x3d'+struct.pack('<I',0x4601dc)+b'\x04');branch(b'\x0f\x85','skip')
label('render');put(b'\x68'+struct.pack('<I',0x45f420)+b'\xb9'+struct.pack('<I',0x460210));ca(0x41ac90)
put(b'\xb9'+struct.pack('<I',comic));ca(0x40a850)
label('skip');put(b'\x4b');branch(b'\x0f\x85','tick');put(b'\xf4')
for off,name in fixes:code[off:off+4]=struct.pack('<i',labels[name]-(off+4))
u.mem_write(base,bytes(code))
tick=0;wanted={140320,175320,195320,225320};snapshots=[]
def enter(uc,a,size,d):
 global tick;tick+=1
blobInputs=json.loads(subprocess.check_output(['node','--import',str(root/'tools/register-three.mjs'),str(root/'tools/sample-comic-blobs.mjs')],text=True))
def blobRender(uc,a,size,d):
 if tick not in wanted:ret(uc,12);return
 bo=uc.reg_read(UC_X86_REG_ECX);kind=0 if bo==0x780000 else 1
 case=next(c for c in blobInputs if round(c['time']*1000)==tick and c['kind']==kind)
 vals=case['positions'];u.mem_write(r(bo+0x1c),struct.pack('<'+'i'*len(vals),*vals));u.mem_write(r(bo+0x24),bytes(len(vals)*4))
def tubeRender(uc,a,size,d):
 if tick not in wanted:ret(uc,0);return
 for off,value in [(8,32),(12,33),(16,64),(20,65),(24,2145),(0x98,0x900000),(0x9c,0x907000)]:w(0x782000+off,value)
def allocate(uc,a,size,d):
 uc.reg_write(UC_X86_REG_EAX,0x980000);ret(uc,4)
def snapshot(uc,a,size,d):
 if tick not in wanted:return
 s={k:si(comic+v)for k,v in {'mode':0x70,'phase':0x6c}.items()};s['elapsedMs']=si(0x782004)
 s.update({k:rf(comic+v)for k,v in {'rowY':0xec,'rowZ':0xf0}.items()})
 read=lambda a,n:list(struct.unpack('<'+'i'*n,u.mem_read(a,4*n)))
 s.update({'tick':tick,'camera':read(0x45f420,9),'position':read(0x45f448,3),'tube':read(0x7820b8,9),'center':read(0x7820e0,3),'zoom':si(0x45f454),'cachedProjection':rf(0x4602a4)})
 s['projections']=[]
 for index in range(0,2145,17):
  raw=u.mem_read(0x980000+index*40,40);screen=list(struct.unpack_from('<4f',raw))
  if raw[20]==0:s['projections'].append({'index':index,'screen':screen[:2]})
 snapshots.append(s)
u.hook_add(UC_HOOK_CODE,enter,begin=0x40c160,end=0x40c160)
u.hook_add(UC_HOOK_CODE,snapshot,begin=0x40b05c,end=0x40b05c)
u.hook_add(UC_HOOK_CODE,blobRender,begin=0x408b30,end=0x408b30)
u.hook_add(UC_HOOK_CODE,tubeRender,begin=0x407ed0,end=0x407ed0)
u.hook_add(UC_HOOK_CODE,allocate,begin=0x41a270,end=0x41a270)
u.reg_write(UC_X86_REG_ESP,0x8f0000)
u.emu_start(base,base+len(code))
if args.output:args.output.write_text(json.dumps(snapshots,indent=2)+'\n')
fixtures=json.loads((root/'tests/fixtures/comic-geometry.json').read_text())
count=0;maximum=0
for sample in snapshots:
 expected=next(c for c in fixtures if round(c['time']*1000)==sample['tick'])
 if not expected['effect']['autoCamera']:continue
 vertices={v['index']:v for v in expected['projections']}
 for vertex in sample['projections']:
  if vertex['index']not in vertices:continue
  error=max(abs(a-b)for a,b in zip(vertex['screen'],vertices[vertex['index']]['screen']))
  maximum=max(maximum,error);count+=1
  if error>.001:raise SystemExit(f"Projection mismatch at {sample['tick']} ms vertex {vertex['index']}: {error} px")
if count!=271:raise SystemExit(f'Expected 271 matching projected vertices, got {count}')
print(f'Sequential native Comic rendering: {count} projected vertices agree within {maximum:.8f}px')
