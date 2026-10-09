import * as THREE from 'three';
import { Timeline } from './core/Timeline.js';
import { Tunnel } from './effects/Tunnel.js';
import { Comic } from './effects/Comic.js';
import { Makina } from './effects/Makina.js';
import { Overlays } from './core/Overlays.js';
import { setProjection } from './core/Math.js';

export class Demo {
 constructor(options={}){
  this.duration=361.745;
  this.comicRotationProfile=options.comicRotationProfile??'frozen';
  this.effects={tunnel:new Tunnel(),comic:new Comic(),makina:new Makina()};
 }
 async init(canvas){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,preserveDrawingBuffer:true});
  this.renderer.setPixelRatio(1);this.renderer.setSize(640,480,false);
  this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
  this.renderer.toneMapping=THREE.NoToneMapping;this.renderer.autoClear=false;
  const response=await fetch(new URL('../assets/timeline.json',import.meta.url));
  if(!response.ok)throw new Error(`Timeline: HTTP ${response.status}`);
  const data=await response.json(),loader=new THREE.TextureLoader();
  this.duration=data.duration;
  await Promise.all(Object.values(this.effects).map(effect=>effect.init(loader)));
  this.scenes={};for(const [name,effect]of Object.entries(this.effects)){
   const scene=new THREE.Scene();scene.add(effect.group);this.scenes[name]=scene;
  }
  this.overlays=new Overlays();await this.overlays.init(loader,data.overlayTextures);
  this.timeline=new Timeline(data,{
   onReset:s=>{for(const e of Object.values(this.effects))e.reset?.(s);},
   onTick:s=>{for(const name of new Set(s.layers))this.effects[name].onTick?.(s);},
   onRenderTick:s=>{for(const name of new Set(s.layers))this.effects[name].onRenderTick?.(s);},
   onCommand:(e,c,s)=>this.effects[e.name].onCommand?.(e,c,s),
   onSelect:(name,channel,s)=>this.effects[name].reset?.(s)
  },{comicRotationProfile:this.comicRotationProfile});
 }
 render(time){
  const s=this.timeline.frameAt(time);this.state=s;
  const cache=s.renderCache;
  const fog={...s.fog,gpuEnabled:cache.fog.enabled,slope:cache.fogSlope,color:cache.fog.color};
  const frame={...s,fog};
  this.renderer.setClearColor(new THREE.Color().setRGB(...cache.clearColor.map(byte=>byte/255)),1);this.renderer.clear();
  // 0x40cc96: secondary then primary callbacks determine the camera used
  // to transform each effect's vertices. They enqueue material buckets.
  for(const name of new Set(s.layers)){
   const effect=this.effects[name];
   if(name!=='makina')effect.update(s.time,s.effects[name],frame);
   if(name==='tunnel'&&s.inheritedCameraOffset){
    effect.camera.position.add(new THREE.Vector3(...s.inheritedCameraOffset).multiplyScalar(1/65536));
    effect.camera.updateMatrixWorld();
   }
  }
  let camera=this.effects[s.layers[0]].camera;
  if(s.layers.includes('makina'))this.effects.makina.update(s.time,frame,{camera,fog});
  const cameras=new Map();
  for(const name of [...s.layers].reverse()){
   const effect=this.effects[name];
   if((name==='comic'||name==='makina')&&effect.useOwnCamera)camera=effect.camera;
   cameras.set(name,camera);
  }
  // Camera transforms stay current, while every effect projects through the
  // focal length captured before this frame's Render callbacks (0x41ac90).
  for(const camera of new Set(cameras.values()))setProjection(camera,cache.projection.zoom);
  // 0x415850 flushes first-pass buckets in material registration order:
  // Tunnel patches (no depth writes), Comic, Makina. Bars are low-byte 2,
  // so native draws them in its second pass, after the foreground geometry.
  const tunnel=this.effects.tunnel;
  for(const name of ['tunnel','comic','makina']){
   if(!cameras.has(name))continue;
   if(name==='tunnel'){
    const visible=tunnel.bars.visible;tunnel.bars.visible=false;
    this.renderer.render(this.scenes.tunnel,cameras.get(name));
    tunnel.bars.visible=visible;
   }else this.renderer.render(this.scenes[name],cameras.get(name));
  }
  if(cameras.has('tunnel')&&tunnel.bars.visible){
   const visible=tunnel.mesh.visible;tunnel.mesh.visible=false;
   this.renderer.render(this.scenes.tunnel,cameras.get('tunnel'));
   tunnel.mesh.visible=visible;
  }
  this.overlays.render(this.renderer,s);
 }
 dispose(){for(const e of Object.values(this.effects))e.dispose?.();this.overlays?.dispose();this.renderer?.dispose();}
}
