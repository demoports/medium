import * as THREE from 'three';
import { sin, cos, mul, div, Random, basis, setCamera, lookingAt, setProjection, CAMERA_NEAR, CAMERA_FAR, NativeCamera } from '../core/Math.js';
import { fogUniforms, updateFog, fogVertex, fogFragment } from '../core/Fog.js';
import { loadNativeMipTexture } from '../core/Texture.js';

// The point-field accumulation at 0x410e91 is overwritten at 0x410fc9.
// The released executable colors every lit patch vertex from beat channel 1.
export function tunnelLightColor(effect) {
 const packed = effect.pulseLighting ? Math.min(effect.beats[1] * 300, 0xffffff) : 0;
 return ((packed & 0xff0000) >>> 16) / 255;
}

const tr = Math.trunc;
const sections = [8,7,6,5,4,3,3,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,3,3,4,5,6,7,8];
const ROOT = new URL('../../assets/textures/', import.meta.url);

// 0x410c2f–0x410d7d: signed shifts are significant at negative radii.
export function tunnelPatchVertex(index, x, y, angle, bend, z, radius) {
 const ring=(index&7)*192,offset=(index&7)*4096;
 const sx=(mul(sin(angle+bend)+65536,radius)>>4)+ring+448;
 const sy=(mul(cos(angle+bend)+65536,radius)>>4)+ring+448;
 const ax=angle+div(tr(sin(index*512+y*512)/32)+x*512,12288);
 const ay=angle+div(tr(sin(index*512+x*512)/32)+x*512,12288);
 return [mul(sin(ax)+offset,sx),mul(cos(ay)+offset,sy),z-4096+y*1024];
}

function tunnelLookingAt(position,target) {
 const axes=lookingAt(position,target);
 // 0x410399 uses right × forward for up. Its reflected view is intentional.
 for(let i=3;i<6;i++)axes[i]=-axes[i];
 return axes;
}

// 0x40edf6–0x40f0e8. Keep the signed integer overflow: the outer layer
// offsets are +117 and -118, not the ±138 suggested by the floating formula.
export function tunnelBarData() {
 const positions=[],fade=[],layers=[],corners=[],indices=[];
 let center=-sections.slice(0,16).reduce((a,b)=>a+b,0)*416;
 for(let section=0;section<32;section++){
  const length=sections[section]*208;
  // 0x44e0e0 holds a final 8 used by the last segment's fade calculation.
  const nextCenter=center+(sections[section]+(sections[section+1]??8))*208;
  for(let layer=0;layer<5;layer++){
   const offset=(tr((layer-2)*65536/3)*13<<12)>>24;
   const width=sin(tr(tr((layer*2+1)*65536/10)/2))*384>>16;
   for(let side=0;side<4;side++){
    const base=positions.length/3;
    for(let k=0;k<4;k++){
     const x=((k+1)>>1&1)*width,z=((k&2)-1)*length;
     const xy=side<2?[side?-x:x,offset]:[offset,side===3?-x:x];
     positions.push(xy[0],xy[1],center+z);
     // Native color uses the following segment's center for its distance.
     fade.push((255-Math.min(255,Math.max(0,tr(Math.abs(nextCenter+z)/64)-96)))/255);
     layers.push(layer);corners.push(k);
    }
    indices.push(base,base+1,base+2,base,base+2,base+3);
   }
  }
  center=nextCenter;
 }
 return {positions,fade,layers,corners,indices};
}

export function tunnelBarUV(layer,corner,time,amplitude,inner90) {
 const f=Math.fround,a=f(Math.abs((layer-2)/3)),b=f(Math.abs((layer-2)/6));
 const amount=Math.min(1,f(f(amplitude)*f(inner90)/65536));
 const u=((corner-1)>>1)&1,v=(corner>>1)&1;
 return [f(u*amount*(1+a*.5)-f(a*amount)),f(v+f(time/((1-a)*1000+450))),
  f(u*amount*(1+b)-b),f(v+f(time/((1-b)*1000+2000)))];
}

/** The 96 eight-by-eight tunnel patches and crossed equalizer strips.
 * Geometry: 0x410c04–0x410d83; patch motion: 0x40fb1f–0x40fd5b.
 * Camera paths: 0x40fdf3–0x410859. Strip geometry: 0x40ecd0–0x40f16f.
 * D3D7 texture stages and per-frame damping are adapted to WebGL and 60 Hz.
 */
export class Tunnel {
 constructor() {
  this.group = new THREE.Group();
  this.camera = new NativeCamera(THREE.MathUtils.radToDeg(2*Math.atan(.375)), 4/3, CAMERA_NEAR, CAMERA_FAR);
  this.particles = new Int32Array(96*6); this.enabled = new Uint8Array(96);
  this.reset();
 }
 async init() {
  const paths=['pet_t2_04','pet_t1_03','011029_alpha_02','mid_tex07','mid_tex08'];
  this.textures=await Promise.all(paths.map(n=>loadNativeMipTexture(new URL(`medium_stunnel/${n}.mips.bin`,ROOT))));
  for(const t of this.textures){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.NoColorSpace;t.flipY=false;t.minFilter=THREE.LinearMipmapNearestFilter;}
  for(const t of this.textures.slice(3))t.wrapS=THREE.ClampToEdgeWrapping;
  const positions=new Float32Array(96*64*3), uv=new Float32Array(96*64*2), colors=new Float32Array(96*64*3), indices=[];
  for(let p=0;p<96;p++)for(let y=0;y<8;y++)for(let x=0;x<8;x++){
   let i=p*64+y*8+x;uv[i*2]=x/8;uv[i*2+1]=y/8;
   if(x<7&&y<7)indices.push(i,i+1,i+9,i,i+9,i+8);
  }
  this.geometry=new THREE.BufferGeometry();
  this.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  this.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  this.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));
  this.geometry.setIndex(indices);
  this.material=new THREE.ShaderMaterial({
   uniforms:{map0:{value:this.textures[0]},map1:{value:this.textures[1]},scroll:{value:new THREE.Vector2()},...fogUniforms()},
   vertexShader:`${fogVertex} varying vec2 vUv; varying vec3 vColor; attribute vec3 color;
    void main(){vUv=uv;vColor=color;vec4 p=modelViewMatrix*vec4(position,1.0);fogRetained=nativeFog(-p.z);gl_Position=projectionMatrix*p;}`,
   fragmentShader:`${fogFragment} uniform sampler2D map0;uniform sampler2D map1;uniform vec2 scroll;
    varying vec2 vUv;varying vec3 vColor;
    void main(){vec4 a=texture2D(map0,vUv);vec4 b=texture2D(map1,vUv+scroll);
     vec3 rgb=clamp(clamp(a.rgb*vColor*2.0,0.0,1.0)+b.rgb,0.0,1.0);float alpha=a.a*b.a;
     if(alpha<=6.0/255.0)discard;
     rgb=mix(fogColor,rgb,fogRetained);gl_FragColor=vec4(rgb,alpha);}`,
   side:THREE.DoubleSide,transparent:true,depthWrite:false
  });
  this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;this.group.add(this.mesh);
  this.createBars();
 }
 reset(state){
  let initial=state?.effects.tunnel.initialParticles;
  if(!initial){
   // Standalone construction uses the same canonical second startup reset.
   const rng=new Random();for(let i=0;i<192;i++)rng.next();
   initial=new Array(96*3);
   for(let i=0;i<96;i++){
    const z=rng.next()%0xb000-0x5800,angle=rng.next();
    initial[i*3]=angle;initial[i*3+1]=0;initial[i*3+2]=z;
   }
  }
  for(let i=0;i<96;i++){
   const angle=initial[i*3],z=initial[i*3+2],p=i*6;
   this.particles.set([angle,0,z,angle,0,z],p);this.enabled[i]=z>0x2c00?1:0;
  }
  this.barTick=0;this.barAmplitude=0;this.smoothFrame=0;this.cameraTickState=null;
 }
 onTick(s){
  const e=s.effects.tunnel;
  e.counter70=((e.counter70||0)+e.beats[0])|0;e.counter74=((e.counter74||0)+e.beats[1])|0;
  const phase=e.phase|0;
  if(e.visible)for(let i=0;i<96;i++){
   const p=i*6;
   const a=sin(i*0x147-phase*9),b=sin(i*0xf067+tr(phase/23)),c=sin(i*0x3f7-tr(phase/21)),d=sin(i*0x1347-tr(phase/3));
   const da=tr((b*13-a*5+c*2+d)/48),dz=tr((c*7-a*5+d+b*3)/192);
   let z=this.particles[p+2]+(e.zVelocity||0)-3;
   if(z>0x5800){z-=0xb000;this.enabled[i]=1;}else if(z< -0x5800){z+=0xb000;this.enabled[i]=1;}
   this.particles[p+2]=z;this.particles[p+3]=this.particles[p]+da;this.particles[p+4]=this.particles[p+1];
   z+=dz;if(z>0x5800){z-=0xb000;this.enabled[i]=1;}else if(z< -0x5800){z+=0xb000;this.enabled[i]=1;}this.particles[p+5]=z;
  }
  if(e.secondaryVisible)e.radiusX=tr((s.spring+1.65)*16384);
  if(e.flagD23c){if(e.countD234<32768){e.countD234+=24;e.countD238+=24;}else e.flagD23c=false;}
  if(e.deformation){
   if(e.inner98){if(e.inner90<.65)e.inner90=Math.fround(e.inner90+.003);else e.inner98=false;}
   if(e.inner99){if(e.inner90<.85)e.inner90=Math.fround(e.inner90+.003);else e.inner99=false;}
   if(e.inner9a){if(e.inner90>0)e.inner90=Math.fround(e.inner90-.003);else e.inner9a=false;}
   this.barAmplitude=Math.fround(this.barAmplitude*.99+(e.beats[1]+e.beats[2])*.01);this.barTick++;
  }
  e.phase=(phase+1)|0;
  for(const k of ['counter78','counter7c','counter80'])e[k]=((e[k]||0)+1)|0;
  // The native camera is computed in Tick, before Render's damping. Preserve
  // its inputs while photo overlays hold Tick and the global clocks continue.
  const cameraEffect={};
  for(const key of ['phase','counter70','counter74','counter78','counter7c','counter80','mode','overlayMode','innerMode','countD238','cameraX','cameraY'])cameraEffect[key]=e[key];
  this.cameraTickState={effect:cameraEffect,state:{spring:s.spring,row32:s.row32,row64:s.row64,row128:s.row128}};
 }
 onRenderTick(s){
  const e=s.effects.tunnel;
  // Render continues during photo freezes. Keep its damping on a separate
  // fixed 60 Hz clock, while particles and bar envelopes use effect ticks.
  this.smoothFrame+=60;
  if(this.smoothFrame>=1000){this.smoothFrame-=1000;
   e.cameraVX=tr(e.cameraVX*255/256);e.cameraVY=tr(e.cameraVY*255/256);
   e.cameraX+=tr(e.cameraVX/4);e.cameraY+=tr(e.cameraVY/4);
   e.radiusVX=tr(e.radiusVX*255/256);e.radiusVY=tr(e.radiusVY*255/256);
   e.radiusX+=tr(e.radiusVX/4);e.radiusY+=tr(e.radiusVY/4);
  }
 }
 onCommand(e,c){if(c===0x10010002){this.enabled.fill(0);e.zVelocity=-2;}}
 update(time,e,s){
  updateFog(this.material,s.fog);updateFog(this.barMaterial,s.fog);
  this.mesh.visible=e.visible;this.bars.visible=e.deformation;
  const phase=(e.phase-1)|0;
  if(e.visible){
   const pos=this.geometry.attributes.position.array,col=this.geometry.attributes.color.array;
   for(let i=0;i<96;i++){
    const p=i*6,a=this.particles[p+3],b=this.particles[p+4],z=this.particles[p+5];
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){
     const n=(i*64+y*8+x)*3;
     pos.set(this.enabled[i]?tunnelPatchVertex(i,x,y,a,b,z,e.radiusX):[0,0,-48000],n);
     const pulse=tunnelLightColor(e);
     col[n]=col[n+1]=col[n+2]=pulse;
    }
   }
   this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.color.needsUpdate=true;
   this.material.uniforms.map1.value=this.textures[e.textureSet?2:1];
   this.material.uniforms.scroll.value.set(((phase*5)&65535)/65536,-((phase*3)&65535)/65536*5);
  }
  if(e.deformation)this.updateBars(e);
  this.updateCamera(this.cameraTickState?.effect??e,{...(this.cameraTickState?.state??s),projection:s.projection});
 }
 updateCamera(e,s){
  const zoom=s.projection?.zoom??1;
  setProjection(this.camera, zoom);
  const p=(e.phase-1)|0,counter78=(e.counter78-1)|0,counter7c=(e.counter7c-1)|0,counter80=(e.counter80-1)|0;
  const a=sin(mul(p+0x21000,0x31700))+sin(mul(p+0x73000,0x20400))+sin(mul(p+0x41000,0x14561))+sin(mul(p+0x31000,0x19f00));
  const b=sin(mul(p+0x11000,0x30111))+sin(mul(p+0x21000,0x26310))+sin(mul(p+0x31000,0x11561))+sin(mul(p+0x41000,0x29cd0));
  const mid=tr((a+b)/6),mode=e.mode;
  let axes=basis(0,0,0),position=[a*224/65536,b*224/65536,0];
  if(mode<2){
   if(e.overlayMode===0)axes=basis(tr(a/64)-e.cameraX+(mode?tr(cos(counter78)/2):0),e.cameraY+tr(mul(a,b)/64),tr(b/64));
   else {
    let amp=128,scale=1,camX=cos(mid)*768,camY=sin(mid)*768,targetZ=(cos(e.countD238)*2+sin(tr(s.row64*1024))*2+cos(tr(s.row32*2048)))*128,camZ=0;
    if(e.innerMode===2){amp=512;scale=(s.spring+8)/12;targetZ=(cos(e.countD238)*96-a+b)*16;camX=sin(tr(s.row32*2048+32768))*1024;camY=(cos(mid)-2097152)*48;camZ=-67108864;}
    if(e.overlayMode===1){position=[camX/65536,(mode?-camY:camY)/65536,0];axes=tunnelLookingAt(position,[a*amp/65536,(mode?-b:b)*amp/65536,mode?-1536:1536]);}
    else {position=mode?[-camX*scale/65536,-camY*scale/65536,-camZ/65536]:[camX*2/3*scale/65536,camY*2/3*scale/65536,camZ*2/3/65536];
     axes=tunnelLookingAt(position,[a*amp*scale*(mode?.75:1)/65536,b*amp*scale*(mode?.75:1)/65536,(mode?-targetZ:targetZ)*scale/65536]);}
   }
  }else if(mode===2){axes=basis(0,tr(cos(counter80*2)/4)+49152,0);for(let i=0;i<3;i++)position[i]+=axes[i+6]*-2048;}
  else if(mode===3){axes=basis(e.counter70>>8,e.counter74>>9,0);position=axes.slice(6).map(v=>v*-2048);}
  else if(mode===4){axes=basis(tr(cos(tr(s.row32*512))/4),tr(cos(tr(s.row64*1024))/4),tr(cos(tr(s.row128*512))/4));position=axes.slice(6).map(v=>v*-2304);}
  else {axes=basis(tr(cos(counter7c*2)/4),tr(cos(counter7c*3)/4),tr(cos(counter7c*4)/4));const m=basis(tr(cos(p)/4),tr(cos(p*2)/4),tr(cos(p*3)/4));position=axes.slice(6).map((v,i)=>v*-896+m[i]*512);}
  setCamera(this.camera,position,axes);
 }
 createBars(){
  const data=this.barData=tunnelBarData(),uv=new Float32Array(data.layers.length*4);
  this.barGeometry=new THREE.BufferGeometry();this.barGeometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
  this.barGeometry.setAttribute('barUV',new THREE.BufferAttribute(uv,4).setUsage(THREE.DynamicDrawUsage));
  this.barGeometry.setAttribute('fade',new THREE.Float32BufferAttribute(data.fade,1));this.barGeometry.setIndex(data.indices);
  this.barMaterial=new THREE.ShaderMaterial({uniforms:{map0:{value:this.textures[3]},map1:{value:this.textures[4]},...fogUniforms()},
   vertexShader:`${fogVertex} attribute vec4 barUV;attribute float fade;varying vec4 vUv;varying float vFade;
    void main(){vUv=barUV;vFade=fade;vec4 p=modelViewMatrix*vec4(position,1.);fogRetained=nativeFog(-p.z);gl_Position=projectionMatrix*p;}`,
   fragmentShader:`${fogFragment} uniform sampler2D map0;uniform sampler2D map1;varying vec4 vUv;varying float vFade;
    void main(){vec4 first=texture2D(map0,vUv.xy);vec3 second=texture2D(map1,vUv.zw).rgb;
     vec3 color=clamp(first.rgb*vFade+second,0.,1.);
     gl_FragColor=vec4(mix(fogColor,color,fogRetained),first.a*vFade);}`,
   side:THREE.DoubleSide,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
  this.bars=new THREE.Mesh(this.barGeometry,this.barMaterial);this.bars.frustumCulled=false;this.group.add(this.bars);
 }
 updateBars(e){
  const uv=this.barGeometry.attributes.barUV,data=this.barData;
  const values=Array.from({length:20},(_,i)=>tunnelBarUV(tr(i/4),i%4,this.barTick,this.barAmplitude,e.inner90));
  for(let i=0;i<data.layers.length;i++)uv.array.set(values[data.layers[i]*4+data.corners[i]],i*4);
  uv.needsUpdate=true;
 }
 dispose(){this.geometry.dispose();this.material.dispose();this.barGeometry.dispose();this.barMaterial.dispose();this.textures.forEach(t=>t.dispose());}
}
