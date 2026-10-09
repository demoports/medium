import * as THREE from 'three';

// 0x41ac90 caches only the slope; 0x418563 reads the current camera's fog
// bounds and byte endpoints. GPU fog enable/color were set at frame begin.
export function fogUniforms() {
 return {
  fogEnabled:{value:0},fogNear:{value:0},fogFar:{value:10240},fogSlope:{value:255/10240},
  fogRange:{value:new THREE.Vector2(255,255)},fogColor:{value:new THREE.Color(0,0,0)}
 };
}

export function updateFog(material, fog) {
 if(!fog)return;
 const u=material.uniforms;
 u.fogEnabled.value=fog.enabled&&fog.gpuEnabled!==false?1:0;
 u.fogNear.value=fog.near;u.fogFar.value=fog.far;
 u.fogSlope.value=fog.slope??Math.fround(fog.min/(fog.far-fog.near));
 u.fogRange.value.set(fog.min,fog.max);
 u.fogColor.value.setRGB(...fog.color.map(c=>c/255));
}

export const fogVertex = `
 uniform float fogEnabled, fogNear, fogFar, fogSlope;
 uniform vec2 fogRange;
 varying float fogRetained;
 float nativeRoundEven(float value) {
  float low = floor(value), fraction = value - low;
  return fraction == 0.5 ? low + mod(low, 2.0) : floor(value + 0.5);
 }
 float nativeFog(float depth) {
  float amount = depth < fogNear ? 0.0 : depth > fogFar ? fogRange.x : nativeRoundEven((depth - fogNear) * fogSlope);
  return mix(1.0, mod(fogRange.y - amount, 256.0) / 255.0, fogEnabled);
 }`;

export const fogFragment = `uniform vec3 fogColor; varying float fogRetained;`;

export function fogRetained(fog,depth) {
 if(!fog.enabled||fog.gpuEnabled===false)return 1;
 const slope=fog.slope??Math.fround(fog.min/(fog.far-fog.near));
 const value=depth<fog.near?0:depth>fog.far?fog.min:Math.fround((depth-fog.near)*slope),low=Math.floor(value);
 const rounded=value-low===.5?low+(low%2):Math.round(value);
 return ((fog.max-rounded)&255)/255;
}
