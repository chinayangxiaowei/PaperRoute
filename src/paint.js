import * as THREE from 'three';

/**
 * 水粉罩染着色器注入 —— 复刻原作的 "pigment wash" 思路：
 * 在世界空间叠加宏观颜料漂移 + 笔触噪声，让纯色材质呈现手绘质感。
 * - applyGouache：用于带 _paint_mask 顶点属性的 GLB 材质（mask.b 控制罩染强度，
 *   mask.g 控制凹槽处间接光压暗，mask.a 作为噪声种子）
 * - applyWash：用于无 mask 的普通材质，恒定强度
 */

const NOISE_GLSL = /* glsl */`
  float pigmentHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float pigmentNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(pigmentHash(i), pigmentHash(i + vec3(1,1,1)), f.x);
    float b = mix(pigmentHash(i + vec3(0,1,0)), pigmentHash(i + vec3(1,0,1)), f.x);
    float c = mix(pigmentHash(i + vec3(0,0,1)), pigmentHash(i + vec3(1,1,0)), f.x);
    float d = mix(pigmentHash(i + vec3(0,1,1)), pigmentHash(i + vec3(1,0,1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
  }
`;

export function applyGouache(mat, { drift = 0.14, brush = 0.08 } = {}) {
  if (mat.userData.gouache) return mat;
  mat.userData.gouache = true;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 paintMask;
        varying vec4 vPaintMask;
        varying vec3 vWashWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPaintMask = paintMask;
        vWashWorld = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vPaintMask;
        varying vec3 vWashWorld;
        ${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float macroWash = 2.0 * pigmentNoise(vWashWorld * 0.35 + vPaintMask.a * 7.3) - 1.0;
        float brushWash = 2.0 * pigmentNoise(vWashWorld * 2.6 + vPaintMask.a * 3.0) - 1.0;
        diffuseColor.rgb *= 1.0 + (macroWash * ${drift.toFixed(3)} + brushWash * ${brush.toFixed(3)}) * max(vPaintMask.b, 0.2);
        diffuseColor.rgb *= mix(vec3(0.97, 0.99, 1.03), vec3(1.03, 1.01, 0.97), macroWash * 0.5 + 0.5);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= mix(0.58, 1.0, clamp(vPaintMask.g, 0.0, 1.0));`);
  };
  mat.customProgramCacheKey = () => `gouache:${drift}:${brush}`;
  mat.needsUpdate = true;
  return mat;
}

export function applyWash(mat, strength = 0.09) {
  if (mat.userData.washed) return mat;
  mat.userData.washed = true;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWashWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWashWorld = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWashWorld;
        ${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float macroWash = 2.0 * pigmentNoise(vWashWorld * 0.4) - 1.0;
        float brushWash = 2.0 * pigmentNoise(vWashWorld * 2.2) - 1.0;
        diffuseColor.rgb *= 1.0 + (macroWash * 0.7 + brushWash * 0.3) * ${strength.toFixed(3)};`);
  };
  mat.customProgramCacheKey = () => `wash:${strength}`;
  mat.needsUpdate = true;
  return mat;
}

/** 把 GLB 的 _paint_mask 属性别名为 shader 可读的 paintMask（幂等） */
export function aliasPaintMask(geometry) {
  if (geometry.attributes._paint_mask && !geometry.attributes.paintMask) {
    geometry.setAttribute('paintMask', geometry.attributes._paint_mask);
  }
}
