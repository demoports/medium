// Medium (Einklang, 2001): executable sequencer translated from 0x40c160.
// Original commands are retained; numeric flags named by struct offset are
// deliberately explicit where the author's source names did not survive.
const f = Math.fround;
const ORIGINAL_PI = 3.141592654;
const effectNames = [ null, 'tunnel', null, null, 'comic', 'makina', null ];
const common = name => ({ name, mode: 0, phase: 0, elapsedMs: 0, beats: Array(8).fill(0), beatFlags: 0, lastCommand: 0 });
function initialEffect(name) {
 if (name === 'tunnel') return Object.assign(common(name), { counter70:0,counter74:0,counter78:0,counter7c:0,counter80:0,visible:false, textureSet:0, pulseLighting:false, flagD26d:false, deformation:false, overlayMode:0, innerMode:1, inner98:false, inner99:false, inner9a:false, inner90:0, secondaryVisible:false, flagD23c:false, countD234:0, countD238:0, cameraX:0, cameraY:0xb300, cameraVX:0, cameraVY:0, radiusX:-0x1c00, radiusY:0, radiusVX:0, radiusVY:0 });
 if (name === 'comic') return Object.assign(common(name), { alternateTextures:false, textureSet:'pet', scale:65536, drift:0, driftVelocity:0, flag11d:false, flag11e:false, flag11f:false, flag120:false, flag121:false, flag122:true, fog:false, flag124:true, autoCamera:false, rowX:0, rowY:0, rowZ:0 });
 return Object.assign(common(name), { phase:0x4245, angles:[4,4,4],phase16:4,phase8:0, flag75:false, flagA8:false, flagA9:false, flagAA:false, flagAB:false, autoCamera:true, rowX:4, rowY:4, rowZ:4 });
}
export class Timeline {
 constructor(data, hooks = {}, options = {}) {
  this.data=data;this.hooks=hooks;this.comicRotationProfile=options.comicRotationProfile??'zero';
  if(!['zero','frozen'].includes(this.comicRotationProfile))throw new RangeError('Unknown Comic rotation profile');
  this.deltaRow=f(data.bpm/15*.001);this.reset();
 }
 reset() {
  this.eventIndex=0; this.lastBeatRow=-1;this.renderFrameIndex=0;
  this.state={ tick:0, time:0, bpm:this.data.bpm, row:10, row32:10, row64:10, row128:10, songRow:10, pattern:0, beatPattern:0, deltaRow:this.deltaRow,
   layers:['tunnel','comic'], effects:{ tunnel:initialEffect('tunnel'), comic:initialEffect('comic'), makina:initialEffect('makina') },
   beatMask:Array(8).fill(false), beatTargets:Array(8).fill(0), beatDecay:96, spring:0, springVelocity:0, cosine:0, envelopeA:0, envelopeB:0, envelopeC:0,
   cameraShakeA:false, cameraShakeB:false, shakeFast:false, overlay:null, ended:false, randomA:1118820455,randomB:1922350462,
   fog:{enabled:true,color:[0,0,0],near:2048,far:7168,min:255,max:255},projection:{zoom:1,near:8,far:10240},clearColor:[16,22,32],inheritedCameraOffset:[0,0,0] };
  // 0x40b8b1 and 0x40b9f1 call Tunnel.Reset before playback. Each draws
  // 96 position/angle pairs from the same stream used by camera commands.
  // Canonical startup: no system-clock seed skips and no 16-bit dithering.
  this.resetTunnelParticles();this.resetTunnelParticles();
  this.renderFrame();
  this.hooks.onReset?.(this.state); return this.state;
 }
 randomWord() { // Original shared two-word RNG, 0x41bc00.
  const s=this.state, a=(s.randomA>>>12)|(s.randomA<<20);
  s.randomA=((s.randomB>>>5)|(s.randomB<<27))^a;
  s.randomB=(s.randomA-a)|0; return s.randomB&65535;
 }
 randomPhase() { return this.randomWord()<<8; }
 resetTunnelParticles() {
  const particles=new Array(96*3);
  for(let i=0;i<96;i++){
   const z=this.randomWord()%0xb000-0x5800,angle=this.randomWord();
   particles[i*3]=angle;particles[i*3+1]=0;particles[i*3+2]=z;
  }
  this.state.effects.tunnel.initialParticles=particles;
 }
 stateAt(seconds) {
  const target=Math.max(0,Math.min(Math.floor(seconds*1000),Math.round(this.data.duration*1000)));
  if(target<this.state.tick)this.reset();
  while(this.state.tick<target)this.tick();
  return this.state;
 }
 frameAt(seconds) {
  const end=Math.round(this.data.duration*1000);
  const target=Math.max(0,Math.min(Math.floor(seconds*1000),end));
  // Tick remains the native 1 ms clock. Display the last completed 60 Hz
  // frame so a seek and uninterrupted playback share the same cache history.
  // The final sequencer tick is also displayed, even between frame boundaries.
  const tick=target===end?end:Math.ceil(Math.floor(target*60/1000)*1000/60);
  return this.stateAt((tick+.0001)/1000);
 }
 tick() {
  const s=this.state; s.tick++; s.time=s.tick/1000;
  s.row=f(s.row+this.deltaRow);
  if(s.row>=16){ s.row=f(s.row-16); s.beatPattern=(s.beatPattern+1)%4; }
  s.songRow=f(s.songRow+this.deltaRow);
  if(s.songRow>=16){s.songRow=f(s.songRow-16);s.pattern++;}
  s.ended=s.pattern>=this.data.sequence.length;
  const row=Math.trunc(s.row), b=this.data.beatPatterns[s.beatPattern][row];
  if(row!==this.lastBeatRow){
   for(let i=0;i<8;i++)if(b[i+1]===1&&s.beatMask[i])s.beatTargets[i]=65536;
   if(b[0])s.effects[s.layers[0]].beatFlags=b[0];
   this.lastBeatRow=row;
  }
  // The executable smooths both effect layers twice in each 1 ms update.
  for(let pass=0;pass<2;pass++)for(let i=0;i<8;i++){
   s.beatTargets[i]=Math.max(0,s.beatTargets[i]-s.beatDecay);
   for(const layer of s.layers){const e=s.effects[layer];e.beats[i]=((e.beats[i]*7+s.beatTargets[i])<<9)>>12;}
  }
  while(this.eventIndex<this.data.events.length&&this.data.events[this.eventIndex].tick===s.tick){
   const e=this.data.events[this.eventIndex++]; this.command(e.channel,e.command);
  }
  let p=(s.row+5)%16;
  let angle=p>=1&&p<4?(p-1)*ORIGINAL_PI/3:p>=4&&p<5?ORIGINAL_PI:p>=5&&p<12?(p-5)*ORIGINAL_PI/7+ORIGINAL_PI:0;
  const c=Math.cos(angle);s.cosine=f(c);
  s.springVelocity=f((c-s.spring)*.00001+s.springVelocity*.9995);
  s.spring=f((s.spring+s.springVelocity)*.999+c*.001);
  const envelope=p=>Math.cos(p>=2.3&&p<4?(p-2.3)*ORIGINAL_PI/(2*1.7):p>=4&&p<6?ORIGINAL_PI/2:p>=6&&p<15?(p-6)*ORIGINAL_PI/18+ORIGINAL_PI*1.5:0);
  s.envelopeA=f(envelope(s.row));s.envelopeB=f(envelope((s.row+8)%16));
  p=(s.row+8)%16;s.envelopeC=f(Math.cos(p>=1&&p<4?(p-1)*ORIGINAL_PI/6:ORIGINAL_PI/2));
  s.row32=f(s.row32+this.deltaRow);if(s.row32>=32)s.row32=f(s.row32-32);
  s.row64=f(s.row64+this.deltaRow);if(s.row64>=64)s.row64=f(s.row64-64);
  s.row128=f(s.row128+this.deltaRow);if(s.row128>=128)s.row128=f(s.row128-128);
  s.cameraOffsetA=this.cameraOffset(s.row,s.cameraShakeA);
  s.cameraOffsetB=this.cameraOffset((s.row+8)%16,s.cameraShakeB);
  // Photo montages deliberately freeze both native effects for the first 2/3.
  const frozen=s.overlay?.kind==='photo'&&(s.tick-s.overlay.startTick)<Math.trunc(s.overlay.durationMs*2/3);
  s.effectsFrozen=!!frozen;
  if(!frozen){
   // Tunnel.Tick rebuilds the shared camera before either Render callback.
   // During photo freezes that rebuild stops, while Comic's shake additions
   // continue once per frame and therefore accumulate on the held camera.
   if(s.layers.includes('tunnel'))s.inheritedCameraOffset.fill(0);
   for(const name of s.layers){
    const e=s.effects[name];e.elapsedMs++;
    if(name==='comic'){
     const d=(e.beatFlags&1)?this.deltaRow:-this.deltaRow;
     // Constructor/Reset leave these three heap floats uninitialized. The
     // reference capture fits the native invalid/unadvanceable-float case,
     // whose x87 angle conversion produces the identity trig lookup. Keep
     // that output symbolically at zero instead of leaking NaNs into state.
     if(this.comicRotationProfile!=='frozen'){
      e.rowX=f(e.rowX+d);e.rowY=f(e.rowY+d);e.rowZ=f(e.rowZ+d);
     }
     if(e.flag11f){e.driftVelocity=Math.trunc((e.driftVelocity*31-e.beats[5]+e.beats[7])/32);e.drift+=Math.trunc(e.driftVelocity/64);}
     else e.drift=e.driftVelocity=0;
     e.phase++;
    }else if(name==='makina'){
     if(!e.flag75){
      const d=(e.beatFlags&1)?this.deltaRow:-this.deltaRow;
      for(let i=0;i<3;i++)e.angles[i]=f(e.angles[i]+d);
      e.phase16=f(e.phase16+this.deltaRow);if(e.phase16>16)e.phase16=f(e.phase16-16);
      e.phase8=f(e.phase8+this.deltaRow);if(e.phase8>8)e.phase8=f(e.phase8-8);
     }
     e.rowX=e.angles[0];e.rowY=e.angles[1];e.rowZ=e.angles[2];e.phase++;
    }
   }
   this.hooks.onTick?.(s);
  }
  if(s.overlay&&s.tick-s.overlay.startTick>=s.overlay.durationMs)s.overlay=null;
  // 0x40cc90 always renders both effects, even while photos freeze Tick.
  // Render-time simulations use this wall-clock cadence with frozen ages.
  this.hooks.onRenderTick?.(s);
  const frame=Math.floor(s.tick*60/1000);
  if(frame!==this.renderFrameIndex||s.tick===Math.round(this.data.duration*1000)){
   this.renderFrameIndex=frame;this.renderFrame();
  }
 }
 renderFrame() {
  const s=this.state;
  // 0x4153e0 / 0x41ac90 run BEFORE effect Render callbacks. Lens and fog
  // slope are copied, but the camera pointer (basis, position and vertex fog
  // bounds) stays live. A mode cut therefore uses the previous frame's lens.
  s.renderCache={tick:s.tick,projection:{...s.projection},
   fog:{...s.fog,color:[...s.fog.color]},
   fogSlope:s.fog.enabled?f(s.fog.min/(s.fog.far-s.fog.near)):0,
   clearColor:[...s.clearColor]};
  this.renderState();
 }
 renderState() {
  // Native Render calls the secondary layer first. Camera parameters persist
  // when an effect disables its own camera, including during photo freezes.
  // These writes become the next frame's cached projection and GPU state.
  const s=this.state;
  for(const name of [...s.layers].reverse()){
   const e=s.effects[name];
   if(name==='comic'&&!e.autoCamera&&s.layers.includes('tunnel')){
    // 0x40af38–0x40afba also moves inherited views, even with no Comic mesh.
    for(const offset of [s.cameraOffsetA,s.cameraOffsetB])if(offset){
     for(let i=0;i<3;i++)s.inheritedCameraOffset[i]=(s.inheritedCameraOffset[i]+offset[i])|0;
    }
   }
   if(name==='makina')s.clearColor=[0,0,Math.trunc(Math.min(255,48+Math.trunc(e.beats[1]*96/65536))/2)];
   if(!e.autoCamera)continue;
   if(name==='comic'){
    s.fog.enabled=e.fog;
    s.projection.zoom=[.25,.5,.625,1,.625][e.mode];
   }else if(name==='makina')s.projection.zoom=e.mode===3?.375:e.mode>=4?(e.flagA9?1.625:.625):.75;
  }
 }
 cameraOffset(row, enabled) {
  if(!enabled)return [0,0,0]; const end=this.state.shakeFast?7:8;
  if(row<4||row>=end)return [0,0,0];
  const q=row-4, window=Math.cos(q/(end-4)*ORIGINAL_PI/2);
  const fs=this.state.shakeFast?[17,11,13]:[7,3,5], amp=this.state.shakeFast?4194304:5242880;
  return fs.map(n=>Math.trunc(Math.sin(q*n)*window*amp));
 }
 command(channel, command) {
  const s=this.state;
  if(command===255){for(const k of ['row','songRow','row32','row64','row128'])s[k]=f(s[k]+8);}
  if(command>=0x10001&&command<=0x10007)this.select(0,command-0x10001);
  if(command>=0x10010001&&command<=0x10010007)this.select(1,command-0x10010001);
  if(command>=0xd0&&command<=0xed){
   const index=command-0xd0;
   s.overlay={index,texture:this.data.overlayTextures[index],startTick:s.tick,durationMs:index===5?16384:index<5?2048:896,kind:index===5?'logo':index<5?'credit':'photo'};
   if(index>5){s.overlay.offsetX=-(this.randomWord()%128);s.overlay.offsetY=-(this.randomWord()%96);}
  }
  if(command===0x30)s.beatMask[0]=!s.beatMask[0];
  if(command===0x39)s.beatMask[1]=!s.beatMask[1];
  if(command===0x38)s.beatMask[2]=!s.beatMask[2];
  if(command===0x37)s.beatMask[3]=!s.beatMask[3];
  if(command===0x36)for(let i=4;i<8;i++)s.beatMask[i]=!s.beatMask[i];
  const effect=s.effects[s.layers[channel]]; effect.lastCommand=command;
  if(effect.name==='tunnel')this.tunnel(effect,command);
  else if(effect.name==='comic')this.comic(effect,command);
  else this.makina(effect,command);
  this.hooks.onCommand?.(effect,command,s);
 }
 select(channel,id){
  const name=effectNames[id];if(!name)return;
  this.state.layers[channel]=name;
  const old=this.state.effects[name],next=initialEffect(name);
  // Native Reset methods retain the base-class beat channels. Comic also
  // retains its running geometry ages and angle clocks (0x409fa0).
  next.beats=old.beats;next.beatFlags=old.beatFlags;
  if(name==='comic')for(const key of ['phase','elapsedMs','rowX','rowY','rowZ','driftVelocity'])next[key]=old[key];
  this.state.effects[name]=next;
  const fog=this.state.fog;
  if(name==='tunnel'){
   this.resetTunnelParticles();
   Object.assign(fog,{enabled:true,color:[0,0,0],near:2048,far:7168});
   this.state.projection.zoom=1;
   this.state.clearColor=[16,22,32];
  }else if(name==='comic'){
   Object.assign(fog,{enabled:false,color:[0x18,0x2b,0x47],near:0,far:6400});
   this.state.clearColor=[0,0,0];
  }
  else Object.assign(fog,{enabled:true,color:[0,0,0x3f],near:0,far:2048});
  this.hooks.onSelect?.(name,channel,this.state);
 }
 tunnel(e,c){
  const s=this.state, set=o=>Object.assign(e,o), mask=()=>{s.beatMask[1]=s.beatMask[2]=true;};
  switch(c){
   case 1:set({mode:4,counter78:0,textureSet:0,radiusVX:0x1600,radiusVY:0x1600});break;
   case 2:e.mode=4;e.textureSet^=1;e.radiusVX=e.radiusVY=-0x1600;break;
   case 3:s.beatDecay=0x2c0;break;
   case 4:e.cameraX=e.cameraY=0;break;
   case 5:e.cameraVX+=0x100;break;
   case 6:e.cameraVX+=0x300;break;
   case 7:e.counter7c=0;break;
   case 8:e.phase=this.randomPhase();break;
   case 9:e.overlayMode=1;break;
   case 10:set({visible:true,overlayMode:2,radiusX:0x4000,phase:this.randomPhase(),deformation:true,pulseLighting:true,inner90:0,inner98:false,inner99:false});mask();break;
   case 11:e.inner98=true;break;
   case 12:e.inner99=true;break;
   case 13:e.inner9a=true;break;
   case 14:e.flagD23c=true;e.countD234=0;break;
   case 15:set({visible:true,mode:0,counter78:0,innerMode:2,deformation:true,inner99:true,inner90:.85,pulseLighting:true,secondaryVisible:true,countD238:0,phase:this.randomPhase(),overlayMode:2});mask();break;
   case 16:set({visible:true,mode:1,counter78:0,innerMode:1,deformation:true,inner99:true,inner90:.85,pulseLighting:true,secondaryVisible:true,phase:this.randomPhase(),overlayMode:2});s.cameraShakeA=true;mask();break;
   case 17:set({visible:false,mode:0,counter78:0,innerMode:1,deformation:false,inner99:false,pulseLighting:false,secondaryVisible:false,phase:0,overlayMode:0});s.cameraShakeA=s.cameraShakeB=s.shakeFast=false;mask();break;
   case 18:e.mode=1;e.phase=this.randomPhase();break;
   case 19:set({radiusX:-0x2000,radiusY:-0x2000,deformation:false,secondaryVisible:false,mode:5,counter78:0,radiusVX:0x1400,radiusVY:0x1400,phase:this.randomPhase()});s.cameraShakeA=false;break;
   case 20:e.visible=e.deformation=false;break;
   case 33:s.cameraShakeA=true;break;case 34:s.cameraShakeA=false;break;
   case 35:s.cameraShakeB=true;break;case 36:s.cameraShakeB=false;break;
   case 37:e.visible=true;e.phase=0;break;
   case 44:e.mode=2;e.counter78=0;break;case 45:e.mode=0;e.counter78=0;break;case 46:e.mode=1;e.counter78=0;break;
   case 98:e.mode=5;break;
   case 102:e.deformation=!e.deformation;break;
   case 103:e.textureSet^=1;break;
   case 104:e.mouseRadius=true;break;case 106:e.mouseCamera=true;break;
   case 107:e.flagD26d=!e.flagD26d;break;case 108:e.pulseLighting=!e.pulseLighting;break;
   case 109:e.mode=3;e.counter78=e.counter74=e.counter70=0;break;case 110:e.mode=4;break;
   case 0x10010002:set({radiusX:0x60000,radiusY:0x60000,radiusVX:-0x2000,radiusVY:-0x2000});break;
  }
 }
 comic(e,c){
  const s=this.state,set=o=>Object.assign(e,o),mask=()=>{s.beatMask[1]=s.beatMask[2]=true;};
  switch(c){
   case 1:e.flag11d=!e.flag11d;e.mode=3;break;case 2:e.mode=2;e.flag121=!e.flag121;break;
   case 3:s.beatDecay=0x3c0;break;case 4:s.beatDecay=0x380;break;
   case 5:set({flag11d:false,flag120:true,flag121:false,flag11e:true,flag122:false,fog:false,flag124:false,scale:0x2c00});s.cameraShakeA=false;break;
   case 6:set({flag122:true,flag11d:false,flag120:false,flag121:false,flag11e:false,fog:false,flag124:false,scale:0x2c00});break;
   case 7:set({autoCamera:true,mode:0,flag11d:true,flag120:true,flag121:true,flag11e:true,flag122:true,fog:false,flag124:true,scale:65536,phase:this.randomPhase()});mask();break;
   case 8:e.flag122=true;break;
   case 9:set({autoCamera:true,mode:1,flag11d:true,flag120:true,flag121:true,flag11e:false,flag122:false,fog:true,flag124:true,scale:65536,textureSet:'comic'});s.cameraShakeA=false;Object.assign(s.fog,{color:[0x30,0x56,0xd5],near:0,far:3072,min:184,max:207});break;
   case 16:set({autoCamera:true,mode:0,flag11d:true,flag120:true,flag121:true,flag122:true,fog:true,flag124:true,flag11e:false,scale:65536});s.cameraShakeA=false;Object.assign(s.fog,{color:[0x30,0x56,0xd5],near:0,far:5120,min:216,max:239});break;
   case 17:set({autoCamera:true,mode:4,flag11d:true,flag120:true,flag121:true,flag11e:true,flag122:true,fog:false,flag124:true,scale:65536,textureSet:'pet'});s.cameraShakeA=false;Object.assign(s.fog,{color:[0,0,0],near:0,far:10240,min:0,max:255});break;
   case 18:set({autoCamera:true,mode:0,flag11d:false,flag120:false,flag121:true,flag11e:true,flag122:false,fog:false,flag124:true,scale:65536});s.cameraShakeA=true;mask();break;
   case 19:set({autoCamera:true,mode:3,flag11d:true,flag120:false,flag121:true,flag11e:true,flag122:false,fog:false});break;
   case 20:set({autoCamera:false,mode:0,flag11e:true,flag11d:false,flag120:false,flag121:false,flag122:false,fog:false});break;
   case 21:set({autoCamera:false,mode:1,flag11d:true,flag120:false,flag121:false,flag11e:true,flag122:false,fog:false,flag124:false,scale:0x2c00,phase:0x1000});break;
   case 44:e.mode=2;break;case 45:e.mode=0;break;case 46:e.mode=1;break;
   case 102:e.alternateTextures=!e.alternateTextures;e.textureSet=e.alternateTextures?'comic':'pet';break;case 103:e.flag121=!e.flag121;break;
   case 104:e.flag120=!e.flag120;break;case 106:e.flag11d=!e.flag11d;break;
   case 107:e.flag11f=!e.flag11f;break;case 108:e.flag11e=!e.flag11e;break;
   case 109:e.mode=3;break;case 110:e.mode=4;break;
  }
 }
 makina(e,c){
  const s=this.state,set=o=>Object.assign(e,o),shake=on=>{s.cameraShakeA=s.cameraShakeB=on;},mask=on=>{s.beatMask[1]=s.beatMask[2]=on;};
  switch(c){
   case 1:e.flag75=true;break;
   case 2:set({mode:0,flagA9:false,flagAA:true,flagAB:true});shake(true);s.shakeFast=true;mask(true);break;
   case 3:set({mode:4,flagA8:true,flagA9:false,flagAA:true,flagAB:true});shake(true);mask(true);break;
   case 4:set({mode:5,flagA8:true,flagA9:false,flagAB:true,phase:this.randomPhase()});shake(true);break;
   case 5:set({mode:4,flagA9:true,flagA8:true,phase:this.randomPhase()});shake(true);break;
   case 6:set({mode:0,flagA9:false,flagA8:true,phase:this.randomPhase()});shake(true);break;
   case 7:case 8:case 9:set({mode:1,flagA9:false,flagA8:true,flagAA:false,flagAB:c!==9,phase:this.randomPhase()});shake(c===7);mask(false);break;
   case 44:e.mode=2;shake(e.flagAA);break;case 45:e.mode=0;shake(e.flagAA);break;
   case 46:e.mode=1;shake(false);break;case 98:e.mode=5;shake(e.flagAA);e.flagA8=true;break;
   case 104:e.flagAB=!e.flagAB;break;case 106:e.flagAA=!e.flagAA;break;case 107:e.flagA9=!e.flagA9;break;
   case 109:e.mode=3;shake(false);break;case 110:e.mode=4;shake(e.flagAA);e.flagA8=true;break;
   case 0x10010006:e.autoCamera=false;break;
  }
 }
}
export default Timeline;
