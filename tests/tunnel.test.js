import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timeline } from '../src/core/Timeline.js';
import { Tunnel } from '../src/effects/Tunnel.js';
import { sin, cos, Random, basis } from '../src/core/Math.js';
const data=JSON.parse(readFileSync(new URL('../assets/timeline.json',import.meta.url)));
function simulation(){const tunnel=new Tunnel();const timeline=new Timeline(data,{onReset:s=>tunnel.reset(s),onTick:s=>{if(s.layers.includes('tunnel'))tunnel.onTick(s);},onRenderTick:s=>{if(s.layers.includes('tunnel'))tunnel.onRenderTick(s);},onCommand:(e,c)=>{if(e.name==='tunnel')tunnel.onCommand(e,c);},onSelect:(name,channel,s)=>{if(name==='tunnel')tunnel.reset(s);}});return{tunnel,timeline};}
test('fixed trigonometry preserves cardinal angles and wraparound',()=>{
 assert.equal(sin(0),0);assert.equal(sin(16384),65536);assert.equal(sin(32768),-0);assert.equal(cos(0),65536);
 for(let i=-65536;i<65536;i+=137)assert.equal(sin(i),sin(i+65536));
 assert.deepEqual(basis(0,0,0).map(v=>v||0),[1,0,0,0,1,0,0,0,1]);
});
test('original random generator repeats from its two-word seed',()=>{const a=new Random(),b=new Random();for(let i=0;i<1024;i++)assert.equal(a.next(),b.next());});
test('tunnel particle state is independent of playback sampling and backward seeking',()=>{
 const a=simulation(),b=simulation();
 for(let t=0;t<=145;t+=1)a.timeline.stateAt(t);b.timeline.stateAt(145);
 assert.deepEqual(a.tunnel.particles,b.tunnel.particles);assert.deepEqual(a.tunnel.enabled,b.tunnel.enabled);
 assert.deepEqual(a.timeline.state.effects.tunnel,b.timeline.state.effects.tunnel);
 b.timeline.stateAt(12);b.timeline.stateAt(145);
 assert.deepEqual(a.tunnel.particles,b.tunnel.particles);
 for(let i=2;i<a.tunnel.particles.length;i+=6)assert.ok(Math.abs(a.tunnel.particles[i])<=22528);
});
test('photo overlays freeze Tunnel ticks but continue render-time damping',()=>{
 const {tunnel,timeline}=simulation(),photo=data.events.find(e=>e.command===0xd6);
 const state=timeline.stateAt((photo.tick-1)/1000),e=state.effects.tunnel;
 e.cameraVX=1000;e.cameraX=0;
 const age=e.elapsedMs,particles=Array.from(tunnel.particles),barTick=tunnel.barTick;
 timeline.stateAt((photo.tick+100)/1000);
 assert.equal(e.elapsedMs,age);assert.deepEqual(Array.from(tunnel.particles),particles);
 assert.equal(tunnel.barTick,barTick);
 assert.ok(e.cameraVX<1000);assert.ok(e.cameraX>0);
});
