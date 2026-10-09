#!/usr/bin/env python3
"""Capture native Comic object, tube and camera transforms with Unicorn.

Executes actual 0x40a850 and 0x407d20, stopping before mesh rendering.
Matrix/position values in the fixture are the original signed 16.16 integers.
"""
import argparse
import pefile,struct,json,pathlib
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('executable',type=pathlib.Path)
parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent.parent/'tests/fixtures/comic-transforms.json')
args=parser.parse_args()
from unicorn import *
from unicorn.x86_const import *
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,0x400000);u.mem_write(0x400000,pefile.PE(str(args.executable)).get_memory_mapped_image());u.mem_map(0x1000000,0x30000)
stack=0x1020000;stop=0x1028000;obj=0x1000000;tube=0x1001000
wi=lambda a,v:u.mem_write(a,struct.pack('<I',v&0xffffffff))
ri=lambda a,n=1:list(struct.unpack('<'+'i'*n,u.mem_read(a,n*4)))
def call(addr,end=stop):
 wi(stack,stop);u.reg_write(UC_X86_REG_ESP,stack);u.reg_write(UC_X86_REG_ECX,obj);u.emu_start(addr,end)
call(0x41baa0)
cases=[{'mode':mode,'autoCamera':True,'phase':12345,'elapsedMs':20000,'rowY':23.5,'rowZ':-43.75} for mode in range(5)]
cases += [{'time':160.32,'mode':1,'autoCamera':False,'phase':9510,'elapsedMs':156141,'rowY':-1403.49267578125,'rowZ':-1403.49267578125},{'time':175.32,'mode':4,'autoCamera':True,'phase':10910095,'elapsedMs':166962,'rowY':-1501.240966796875,'rowZ':-1501.240966796875},{'time':225.32,'mode':3,'autoCamera':True,'phase':2579454,'elapsedMs':212783,'rowY':-1915.1513671875,'rowZ':-1915.1513671875}]
for c in cases:
 u.mem_write(obj,b'\0'*0x200);u.mem_write(tube,b'\0'*0x200)
 wi(obj+0xc4,tube);wi(obj+0x70,c['mode']);wi(obj+0x6c,c['phase']);wi(tube+4,c['elapsedMs']);u.mem_write(obj+0x125,bytes([c['autoCamera']]))
 for key,off in [('rowY',0xec),('rowZ',0xf0)]:u.mem_write(obj+off,struct.pack('<f',c[key]))
 wi(0x45ea50,0);wi(0x45ea54,0)
 call(0x40a850,0x40afc0)
 bp=u.reg_read(UC_X86_REG_EBP)
 c.update({'tube':ri(tube+0xb8,9),'center':ri(tube+0xe0,3),'blob':ri(bp-0x8c,9),'camera':ri(0x45f420,9),'position':ri(0x45f448,3)})

args.output.write_text(json.dumps(cases,indent=2)+'\n')
print(f'Captured {len(cases)} native transform samples in {args.output}')
