import * as THREE from 'three';
import { NOISE_GLSL } from './glsl';
import type { LookUniforms } from './look';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunElev;
uniform float uStars;
uniform float uCloud;
uniform float uMoonPhase;
uniform float uTime;
uniform float uWindX;
uniform float uWindZ;
uniform float uGodRays;
uniform float uNight;
uniform vec3 uFogColor;
${NOISE_GLSL}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.34, up));
  col = mix(uFogColor, col, smoothstep(-0.18, 0.06, h));

  float cover = clamp(uCloud, 0.0, 1.0);
  float sunVis = smoothstep(-0.12, 0.08, uSunElev) * (1.0 - cover * 0.82);
  float sunDot = dot(dir, normalize(uSunDir));
  float glow = pow(max(sunDot, 0.0), 5.0) * sunVis;
  col = mix(col, uGlow, glow * 0.72);
  col += uGlow * pow(max(sunDot, 0.0), 28.0) * 0.55 * sunVis * (0.35 + uGodRays);
  float disc = smoothstep(0.99945, 0.99978, sunDot) * sunVis;
  col = mix(col, uSunColor * 3.2, disc);

  vec2 cuv = dir.xz / max(dir.y + 0.22, 0.08);
  cuv += vec2(uWindX, uWindZ) * uTime * 0.012;
  float n = laFbm(cuv * 1.15);
  float wisps = laFbm(cuv * 2.4 + 4.0);
  float threshold = mix(0.78, 0.18, cover);
  float clouds = smoothstep(threshold, threshold + 0.22, n);
  clouds *= smoothstep(0.0, 0.12, h);
  clouds *= mix(0.35, 1.0, cover + 0.08);
  vec3 cloudCol = mix(uHorizon, uGlow, 0.22 * sunVis);
  cloudCol = mix(cloudCol, cloudCol * vec3(0.62, 0.66, 0.7), cover * (1.0 - wisps));
  col = mix(col, cloudCol, clamp(clouds, 0.0, 0.94));

  vec3 moon = normalize(uMoonDir);
  float mDot = dot(dir, moon);
  float moonDisc = smoothstep(0.99935, 0.99962, mDot) * (1.0 - clouds * 0.85);
  vec3 moonRight = normalize(cross(moon, vec3(0.0, 1.0, 0.15)));
  float across = dot(dir - moon * mDot, moonRight) * 90.0;
  float illum = smoothstep(-0.15, 0.55, across * (uMoonPhase < 0.5 ? 1.0 : -1.0) + (uMoonPhase - 0.5) * 3.2);
  vec3 moonCol = mix(uHorizon, uSunColor, 0.55) * 1.8;
  col = mix(col, moonCol, clamp(moonDisc * (0.1 + illum * (0.55 + 0.45 * uNight)), 0.0, 1.0));

  vec2 starUv = vec2(atan(dir.x, dir.z) * 67.0, asin(clamp(dir.y, -1.0, 1.0)) * 67.0);
  float star = pow(laHash(floor(starUv)), 48.0);
  star *= uStars * smoothstep(0.02, 0.22, h) * (1.0 - clouds);
  col += vec3(0.85, 0.9, 1.0) * star * 1.7;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SkyDome {
  readonly mesh: THREE.Mesh;
  follow(camera: THREE.Camera): void;
  dispose(): void;
}

export function createSky(look: LookUniforms): SkyDome {
  const geo = new THREE.SphereGeometry(2200, 32, 18);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: look.zenith,
      uHorizon: look.horizon,
      uGlow: look.glow,
      uSunColor: look.sunColor,
      uSunDir: look.sunDir,
      uMoonDir: look.moonDir,
      uSunElev: look.sunElev,
      uStars: look.stars,
      uCloud: look.cloud,
      uMoonPhase: look.moonPhase,
      uTime: look.time,
      uWindX: look.windX,
      uWindZ: look.windZ,
      uGodRays: look.godRays,
      uNight: look.night,
      uFogColor: look.fogColor,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -20;
  mesh.matrixAutoUpdate = true;
  return {
    mesh,
    follow(camera) {
      mesh.position.copy(camera.position);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
