import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timeline } from '../src/core/Timeline.js';

const data=JSON.parse(readFileSync(new URL('../assets/timeline.json',import.meta.url)));
// Golden floats captured from real x86 0x40c160 by tools/verify-timeline.py.
const native=JSON.parse(readFileSync(new URL('fixtures/native-timeline.json',import.meta.url)));
const atTick=(timeline,tick)=>timeline.stateAt((tick+.0001)/1000);

test('global clocks and pulse envelopes agree with native x86 samples',()=>{
 const timeline=new Timeline(data);
 for(const sample of native){
  const actual=atTick(timeline,sample.tick);
  for(const [key,value] of Object.entries(sample)){
   assert.ok(Math.abs(actual[key]-value)<1e-6,`tick ${sample.tick} ${key}: ${actual[key]} != ${value}`);
  }
 }
});

test('native two-layer selection and initialization boundaries',()=>{
 const t=new Timeline(data);
 assert.deepEqual(atTick(t,247626).layers,['tunnel','comic']);
 assert.deepEqual(atTick(t,247627).layers,['makina','comic']);
 assert.deepEqual(atTick(t,354612).layers,['makina','comic']);
 assert.deepEqual(atTick(t,354613).layers,['tunnel','makina']);
 assert.equal(atTick(t,354613).effects.makina.autoCamera,false);
 assert.deepEqual(atTick(t,359962).layers,['tunnel','comic']);
});

test('0xff skips eight rows and executes the next command one tick later',()=>{
 const events=[];const t=new Timeline(data,{onCommand(e,c,s){events.push([s.tick,c]);}});
 const before=atTick(t,182543).songRow;
 assert.ok(before>15.98);
 const jump=atTick(t,182544);
 assert.ok(jump.songRow>=8&&jump.songRow<8.02);
 assert.ok(events.some(([tick,command])=>tick===182544&&command===255));
 atTick(t,182545);assert.ok(events.some(([tick,command])=>tick===182545&&command===0xe2));
});

test('photo overlays freeze effect ticks for exactly 597 ms',()=>{
 const photo=data.events.find(e=>e.command===0xd6);
 const t=new Timeline(data);
 const age=atTick(t,photo.tick-1).effects.comic.elapsedMs;
 assert.equal(atTick(t,photo.tick+596).effects.comic.elapsedMs,age);
 assert.equal(atTick(t,photo.tick+597).effects.comic.elapsedMs,age+1);
});

test('backward seek replays a reproducible effect and RNG state',()=>{
 const t=new Timeline(data);
 const expected=JSON.stringify(t.stateAt(300));
 t.stateAt(20);
 assert.equal(JSON.stringify(t.stateAt(300)),expected);
});

test('the full sequencer dispatches 423 events and ends at 361745 ms',()=>{
 let count=0;const t=new Timeline(data,{onCommand(){count++;}});
 const s=atTick(t,361745);
 assert.equal(count,423);assert.equal(s.ended,true);assert.equal(s.pattern,204);
});
