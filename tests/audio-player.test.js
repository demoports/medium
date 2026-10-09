import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AudioPlayer,audibleContextTime,sourceSchedule,timelineTimeFromMP3,MP3_SKIP,RING_DURATION,NATIVE_LEAD} from '../src/core/AudioPlayer.js';
const native=JSON.parse(readFileSync(new URL('fixtures/native-audio-clock.json',import.meta.url)));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
class Source{
 constructor(){this.starts=[];this.stops=[];this.disconnected=false;}
 connect(destination){this.destination=destination;}
 disconnect(){this.disconnected=true;}
 start(...args){this.starts.push(args);}
 stop(...args){this.stops.push(args);}
 finish(){this.onended?.();}
}
class Context{
 currentTime=10;state='suspended';baseLatency=.02;outputLatency=.08;destination={};sources=[];resumes=[];deferResume=false;
 stamp={contextTime:9.9,performanceTime:100000};
 async decodeAudioData(data){this.decodedData=data;return{duration:361.195};}
 resume(){
  if(this.deferResume)return new Promise((resolve,reject)=>this.resumes.push({resolve:()=>{this.state='running';resolve();},reject}));
  this.state='running';return Promise.resolve();
 }
 getOutputTimestamp(){return this.stamp;}
 createBufferSource(){const source=new Source();this.sources.push(source);return source;}
 close(){this.state='closed';return Promise.resolve();}
}
async function harness(options={}){
 let now=100000;
 const context=new Context();
 const player=new AudioPlayer({context,now:()=>now,fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(16)}),...options});
 await player.load('medium.mp3');
 return{player,context,
  output(time,advance=0){now+=advance;context.currentTime=time+context.baseLatency+context.outputLatency;context.stamp={contextTime:time,performanceTime:now};},
  advance(ms){now+=ms;},get now(){return now;}
 };
}

test('native ring preroll and skipped MP3 frame map decoded samples to visual time',()=>{
 near(RING_DURATION,native.ringFrames/native.sampleRate);
 near(MP3_SKIP,native.decoder.stereoSamplesPerFrame/native.sampleRate);
 near(NATIVE_LEAD,native.fullMp3LeadSeconds);
 for(const sample of native.startupCases[0].samples){
  if(sample.audibleDecodedFrame===null)continue;
  const mp3Time=(sample.audibleDecodedFrame+native.decoder.stereoSamplesPerFrame)/native.sampleRate;
  near(timelineTimeFromMP3(mp3Time),sample.playFrame/native.sampleRate);
 }
 assert.deepEqual(sourceSchedule(0),{delay:RING_DURATION,offset:MP3_SKIP});
 near(sourceSchedule(.5).delay,RING_DURATION-.5);
 near(sourceSchedule(100).offset,100-NATIVE_LEAD);
});

test('device timestamps include latency, while missing timestamps use the latency fallback',()=>{
 const context=new Context();context.state='running';
 near(audibleContextTime(context,100050),9.95);
 context.baseLatency=.12;context.outputLatency=.3;
 near(audibleContextTime(context,100050),9.95,'Do not subtract device latency twice');
 context.stamp={contextTime:0,performanceTime:0};
 near(audibleContextTime(context,100050),9.58);
 context.getOutputTimestamp=undefined;
 near(audibleContextTime(context,100050),9.58);
 context.state='suspended';context.currentTime=0;
 near(audibleContextTime(context,100050),0);
});

test('play preserves native silent preroll and cuts the MP3 at the sequencer end',async()=>{
 const {player,context,output}=await harness();
 await player.play();
 const source=context.sources[0];
 near(source.starts[0][0],10+RING_DURATION);near(source.starts[0][1],MP3_SKIP);
 near(source.stops[0][0],10+361.745);
 near(player.currentTime,0);
 output(10.5);near(player.currentTime,.5);assert.equal(player.paused,false);
 output(10+RING_DURATION);near(player.currentTime,RING_DURATION);
 near(361.745-NATIVE_LEAD,361.02808390022675);
 player.dispose();
});

test('playback tracks audible output independently of changing hardware latency',async()=>{
 const {player,context,output,advance}=await harness();
 player.currentTime=100;await player.play();
 near(context.sources[0].starts[0][0],10);near(context.sources[0].starts[0][1],100-NATIVE_LEAD);
 output(10.25);near(player.currentTime,100.25);
 context.outputLatency=.32;output(10.5);near(player.currentTime,100.5);
 advance(12);near(player.currentTime,100.512);
 context.stamp.contextTime-=.04;near(player.currentTime,100.512,'Clock estimates never cause backward visual replay');
 player.dispose();
});

test('pause and seek store audible position and schedule a new source only on play',async()=>{
 const {player,context,output}=await harness();
 player.currentTime=100;await player.play();output(10.5);player.pause();
 near(player.currentTime,100.5);assert.equal(player.paused,true);assert.equal(context.sources[0].disconnected,true);
 output(20);near(player.currentTime,100.5);
 player.currentTime=12;near(player.currentTime,12);assert.equal(context.sources.length,1);
 await player.play();const source=context.sources[1];
 near(source.starts[0][0],20.1);near(source.starts[0][1],12-NATIVE_LEAD);
 output(20.3);near(player.currentTime,12.2);
 player.currentTime=.2;assert.equal(player.paused,true);near(player.currentTime,.2);
 await player.play();near(context.sources[2].starts[0][0],context.currentTime+RING_DURATION-.2);
 player.dispose();
});

test('pause and seek cancel pending resume without resurrecting playback',async()=>{
 const {player,context}=await harness();context.deferResume=true;
 const pending=player.play();assert.equal(context.resumes.length,1);
 player.pause();context.resumes[0].resolve();await pending;
 assert.equal(player.paused,true);assert.equal(context.sources.length,0);
 const pendingSeek=player.play();player.currentTime=140;context.resumes[1].resolve();await pendingSeek;
 assert.equal(player.paused,true);near(player.currentTime,140);assert.equal(context.sources.length,0);
 const old=player.play();player.pause();const current=player.play();
 context.resumes[2].resolve();await old;assert.equal(context.sources.length,0);
 context.resumes[3].resolve();await current;assert.equal(context.sources.length,1);
 near(context.sources[0].starts[0][1],140-NATIVE_LEAD);
 player.dispose();
});

test('dispose invalidates a pending resume, including a rejected close/resume race',async()=>{
 const {player,context}=await harness();context.deferResume=true;
 const pending=player.play();player.dispose();context.resumes[0].reject(new Error('Context closed'));
 await pending;assert.equal(context.sources.length,0);assert.equal(player.paused,true);
 await assert.rejects(player.play(),/disposed/);
 player.dispose();
});

test('source processing end does not stop visuals before the last sample is audible',async()=>{
 const {player,context,output}=await harness();player.currentTime=361.5;await player.play();
 const source=context.sources[0];near(source.stops[0][0],10+.245);
 output(10.2);source.finish();near(player.currentTime,361.7);assert.equal(player.paused,false);
 output(10.245);near(player.currentTime,361.745);assert.equal(player.paused,true);
 output(20);near(player.currentTime,361.745);
 await player.play();assert.equal(context.sources.length,1,'Main transport chooses whether to restart at zero');
 player.currentTime=0;await player.play();assert.equal(context.sources.length,2);
 player.dispose();
});

test('authoritative timeline duration can be set independently of MP3 duration',async()=>{
 const {player,context,output}=await harness();player.duration=350;
 player.currentTime=349;await player.play();near(context.sources[0].stops[0][0],11);
 output(10.5);player.duration=349.25;near(player.currentTime,349.25);assert.equal(player.paused,true);
 assert.throws(()=>{player.duration=NaN;},/duration/);
 player.dispose();
});

test('audio load failure and active resume failure remain actionable',async()=>{
 const player=new AudioPlayer({context:new Context(),fetch:async()=>({ok:false,status:404})});
 await assert.rejects(player.load('missing'),/404/);player.dispose();
 const {player:other,context}=await harness();context.deferResume=true;
 const pending=other.play();context.resumes[0].reject(new Error('Playback denied'));
 await assert.rejects(pending,/Playback denied/);assert.equal(other.paused,true);other.dispose();
});
