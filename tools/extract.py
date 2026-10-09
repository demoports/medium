#!/usr/bin/env python3
"""Extract einklang's Medium (2001) packfile; format recovered from medium.exe.

Directory records: <4I64s>, ending at the first empty filename.
Fields: compressed size, offset in 2048-byte sectors, allocation size, file size.
The bytecode decoder is a direct translation of x86 VA 0x41b4e0–0x41b614.
Data access / format interpretation is at VA 0x41b890–0x41b967.
No asset is synthesized. Compressed stream's initial eight bytes are skipped,
matching the original decoder. Streams end with four zero bytes (literal len 0).
"""
import argparse, hashlib, json, struct
from pathlib import Path


def decompress(data):
    out = bytearray()
    p = 8
    def u16(pos): return struct.unpack_from('<H', data, pos)[0]
    while p < len(data):
        token = data[p]; p += 1
        if token >= 0x80:
            if token & 0x40:
                out.extend(data[p:p+2]); p += 2
            distance = (token & 0x3f) * 2 + 2
            source = len(out) - distance
            assert source >= 0
            out.append(out[source]); out.append(out[source+1])
        elif token >= 0x40:
            count = (token & 15) + 2
            if count == 2:
                count = u16(p); p += 2
            distance = u16(p); p += 2
            literals = (token & 0x30) >> 4
            out.extend(data[p:p+literals]); p += literals
            source = len(out) - count - distance + 1
            assert source >= 0
            for i in range(count): out.append(out[source+i])
        elif token >= 0x20:
            count = token - 0x20
            if count == 0:
                count = data[p] + 0x20; p += 1
            out.extend(b'\0' * count)
        else:
            count = token
            if count == 0:
                count = data[p]; p += 1
                if count:
                    count += 0x1f
                else:
                    count = u16(p); p += 2
                    if count == 0:
                        return bytes(out)
            out.extend(data[p:p+count]); p += count
    raise ValueError('Missing decompression terminator')


def extract(packfile, directory):
    data = packfile.read_bytes()
    inventory = []
    for index in range(1024):
        packed, sector, allocated, size, name = struct.unpack_from('<4I64s',data,index*80)
        name = name.split(b'\0')[0].decode('ascii')
        if not name: break
        path = Path(name.lower().replace('\\','/'))
        assert not path.is_absolute() and '..' not in path.parts
        payload = data[sector*2048:sector*2048+packed]
        assert len(payload) == packed
        raw = payload if packed == size else decompress(payload)
        assert len(raw) == size, (name, len(raw), size)
        output = directory / path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(raw)
        inventory.append(dict(index=index,path=path.as_posix(),packed_size=packed,sector=sector,
            allocation_size=allocated,size=size,sha256=hashlib.sha256(raw).hexdigest()))
        print(f'{size:9d} {path}')
    directory.mkdir(parents=True,exist_ok=True)
    (directory/'inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
    return inventory


from PIL import Image
import shutil
from native_mips import prepare_mips

class Reader:
    def __init__(self,data):self.data=data;self.p=0
    def read(self,n):
        b=self.data[self.p:self.p+n];self.p+=n
        assert len(b)==n
        return b
    def unpack(self,fmt):return struct.unpack('<'+fmt,self.read(struct.calcsize('<'+fmt)))
    def tag(self,tag):assert self.read(4)==tag,(self.p,tag)
    def u32(self):return self.unpack('I')[0]


def signed32(n):return n if n<0x80000000 else n-0x100000000

def unpack_frame(data,count):
    assert len(data)==count*12
    pos=[];norm=[]
    for p in range(0,len(data),12):
        x,unused,y,z,nx,ny,nz,unused2=struct.unpack_from('<hHhhbbbB',data,p)
        pos.extend((x,y,z));norm.extend((nx/64,ny/64,nz/64))
    return dict(positions=pos,normals=norm)


def decode(path,models,textures):
    r=Reader(path.read_bytes());r.tag(b'ES  ')
    version,nt,nm,*reserved=r.unpack('7I');assert version==1
    result=dict(format='medium-es-v1',source=path.name,version=version,positionUnits='original signed 16-bit integer units',textures=[],meshes=[])
    for index in range(nt):
        r.tag(b'EST ');flags,fmt,w,h,*reserved=r.unpack('8I')
        r.tag(b'BMAP');v,zero,width,height,stride,pixel_format,zero2=r.unpack('7I')
        assert (v,zero,pixel_format,zero2)==(1,0,5,0)
        im=Image.frombytes('RGBA',(width,height),r.read(stride*height),'raw','BGRA',stride)
        name=f'medium_makina/{path.stem}_texture_{index}.png';out=textures/name;out.parent.mkdir(parents=True,exist_ok=True);im.save(out)
        r.tag(b'bmap');r.tag(b'est ')
        result['textures'].append(dict(path=name,width=width,height=height,flags=flags,pixelFormat=fmt))
    for index in range(nm):
        r.tag(b'ESM ')
        hdr=r.unpack('12I')
        flags,vertex_flags,bx,by,bz,radius,unknown,material_count,frame_count,frame_bytes,vertex_bytes,index_bytes=hdr
        vertices=Reader(r.read(vertex_bytes)); index_stream=Reader(r.read(index_bytes))
        positions=[];normals=[];colors=[];uvs=[];vertex_tokens=[]
        current_position=None;current_normal=None
        while True:
            token=vertices.u32();kind=(token>>24)&127
            if not kind:break
            assert kind==16,hex(token)
            vertex_tokens.append(token)
            if not token&0x80000000:
                if frame_count<2:
                    x=struct.unpack('<h',struct.pack('<H',token&65535))[0]
                    y,z=vertices.unpack('hh');current_position=(x,y,z)
                    if vertex_flags&65536:
                        nx,ny,nz,_=vertices.unpack('bbbB');current_normal=(nx/64,ny/64,nz/64)
                    color=vertices.u32()
                else:color=token
            else:color=token
            if frame_count<2:
                assert current_position is not None
                positions.extend(current_position);normals.extend(current_normal or (0,0,1))
            colors.extend(((color>>16&255)/255,(color>>8&255)/255,(color&255)/255))
            uvs.extend(vertices.unpack('2f'))
        assert vertices.p==vertex_bytes
        count=len(colors)//3
        frames=[]
        if frame_count>1:
            for frame_index in range(frame_count):frames.append(unpack_frame(r.read(frame_bytes),count))
            positions=frames[0]['positions'];normals=frames[0]['normals']
        materials=[]
        for material in range(material_count):
            mode,tex0,tex1,reserved=r.unpack('4I')
            materials.append(dict(flags=mode,texture0=signed32(tex0),texture1=signed32(tex1),reserved=reserved))
        indices=[];groups=[]
        while True:
            material,triangles=index_stream.unpack('2H')
            if not triangles:break
            start=len(indices);batch=index_stream.unpack(f'{triangles*3}H')
            assert max(batch)<count
            indices.extend(batch);groups.append(dict(start=start,count=triangles*3,materialIndex=material))
        assert index_stream.p==index_bytes
        r.tag(b'esm ')
        result['meshes'].append(dict(id=index,flags=flags,vertexFlags=vertex_flags,boundingSphere=dict(center=[signed32(bx),signed32(by),signed32(bz)],radius=radius),positions=positions,normals=normals,colors=colors,uvs=uvs,indices=indices,groups=groups,materials=materials,frames=frames,sourceHeader=list(hdr)))
    r.tag(b'es  ');assert r.p==len(r.data)
    models.mkdir(parents=True,exist_ok=True)
    out=models/(path.stem+'.json');out.write_text(json.dumps(result,separators=(',',':'))+'\n')
    print(out,[(len(m['positions'])//3,len(m['indices'])//3,len(m['frames'])) for m in result['meshes']])
    return result


def prepare_assets(packfile, output, extracted):
    inventory=extract(packfile,extracted)
    textures=output/'textures'
    textures.mkdir(parents=True,exist_ok=True)
    for record in inventory:
        source=extracted/record['path']
        if source.suffix=='.bmp':
            target=textures/Path(record['path']).with_suffix('.png')
            target.parent.mkdir(parents=True,exist_ok=True)
            Image.open(source).convert('RGBA').save(target)
        elif source.suffix=='.bmc':
            target=textures/Path(record['path']).with_suffix('.png')
            target.parent.mkdir(parents=True,exist_ok=True)
            color=Image.open(source).convert('RGBA')
            alpha=Image.open(source.with_suffix('.bma')).convert('L')
            assert color.size==alpha.size
            color.putalpha(alpha);color.save(target)
    for path in sorted((extracted/'medium_makina').glob('*.es')):
        decode(path,output/'models',textures)
    prepare_mips(textures)
    shutil.copyfile(extracted/'medium_sound/med_11.mp3',output/'medium.mp3')
    shutil.copyfile(extracted/'inventory.json',output/'inventory.json')
    print(f'Prepared assets in {output}')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description='Extract Medium original packfile and convert its assets for the browser. Requires Pillow.')
    parser.add_argument('packfile',type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'assets')
    parser.add_argument('--extracted',type=Path,default=Path('work/extracted'))
    args=parser.parse_args()
    prepare_assets(args.packfile,args.output,args.extracted)
