import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timeline } from '../src/core/Timeline.js';
import { Tunnel } from '../src/effects/Tunnel.js';

const data=JSON.parse(readFileSync(new URL('../assets/timeline.json',import.meta.url)));
// Captured by running real x86 Tunnel.Reset / RandomWord with Unicorn.
const native=JSON.parse(readFileSync(new URL('fixtures/startup-rng.json',import.meta.url)));
const rngState=s=>[s.randomA>>>0,s.randomB>>>0];
function assertParticles(tunnel,expected){
 for(let i=0;i<96;i++){
  const position=expected.particles.slice(i*3,i*3+3);
  assert.deepEqual(Array.from(tunnel.particles.slice(i*6,i*6+6)),[...position,...position]);
 }
 assert.deepEqual(Array.from(tunnel.enabled),expected.enabled);
}

test('canonical startup executes both native tunnel resets on one RNG stream',()=>{
 const tunnel=new Tunnel(),timeline=new Timeline(data,{onReset:s=>tunnel.reset(s)});
 assert.deepEqual(rngState(timeline.state),native.startup.rngState);
 assert.deepEqual(timeline.state.effects.tunnel.initialParticles,native.startup.particles);
 assertParticles(tunnel,native.startup);
 assertParticles(new Tunnel(),native.startup);
});

test('camera phases, photo offsets and tunnel reselection share the native RNG',()=>{
 const tunnel=new Tunnel();
 const timeline=new Timeline(data,{
  onReset:s=>tunnel.reset(s),
  onSelect:(name,channel,s)=>{if(name==='tunnel')tunnel.reset(s);}
 });
 timeline.command(0,8);
 assert.equal(timeline.state.effects.tunnel.phase,native.subsequentWords[0]<<8);
 timeline.command(0,0xd6);
 assert.equal(timeline.state.overlay.offsetX,-(native.subsequentWords[1]%128));
 assert.equal(timeline.state.overlay.offsetY,-(native.subsequentWords[2]%96));
 timeline.select(0,1);
 assert.deepEqual(rngState(timeline.state),native.subsequentReset.rngState);
 assert.deepEqual(timeline.state.effects.tunnel.initialParticles,native.subsequentReset.particles);
 assertParticles(tunnel,native.subsequentReset);
 timeline.reset();
 assert.deepEqual(rngState(timeline.state),native.startup.rngState);
 assertParticles(tunnel,native.startup);
});
