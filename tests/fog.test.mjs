import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fogRetained} from '../src/core/Fog.js';
import {Timeline} from '../src/core/Timeline.js';
import {tunnelLightColor} from '../src/effects/Tunnel.js';

const fixture=name=>JSON.parse(readFileSync(new URL(`fixtures/${name}.json`,import.meta.url)));
const data=JSON.parse(readFileSync(new URL('../assets/timeline.json',import.meta.url)));

test('shared vertex fog matches the native x86 color byte',()=>{
 for(const sample of fixture('native-fog')){
  assert.equal(Math.round(fogRetained({...sample,enabled:true},sample.depth)*255),sample.retained,JSON.stringify(sample));
 }
});

test('Comic fog presets persist across layer selection and camera release',()=>{
 const t=new Timeline(data);
 assert.deepEqual(t.state.fog,{enabled:true,color:[0,0,0],near:2048,far:7168,min:255,max:255});
 t.command(1,9);t.renderState();
 assert.deepEqual(t.state.fog,{enabled:true,color:[48,86,213],near:0,far:3072,min:184,max:207});
 assert.equal(t.state.projection.zoom,.5);
 t.command(1,20);t.renderState();
 assert.equal(t.state.fog.enabled,true);assert.equal(t.state.projection.zoom,.5);
 t.command(1,17);t.renderState();
 assert.equal(t.state.fog.min,0);assert.equal(t.state.fog.enabled,false);
 t.select(0,5);t.renderState();
 assert.deepEqual(t.state.fog.color,[0,0,63]);
 assert.equal(t.state.fog.min,0);assert.equal(t.state.projection.zoom,.75);
});

test('tunnel lighting uses the surviving native beat color write',()=>{
 for(const {beat,color} of fixture('native-tunnel-lighting')){
  assert.equal(Math.round(tunnelLightColor({pulseLighting:true,beats:[0,beat]})*255),color&255);
 }
 assert.equal(tunnelLightColor({pulseLighting:false,beats:[0,65536]}),0);
});
