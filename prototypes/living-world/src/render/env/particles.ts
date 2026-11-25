import * as THREE from 'three';
import type { Season, Weather } from '../../sim/ids';
import type { Terrain } from '../../sim/terrain';
import type { LookUniforms } from './look';

export interface ParticleField {
  readonly objects: THREE.Object3D[];
  sync(state: ParticleSync): void;
  dispose(): void;
}

export interface ParticleSync {
  weather: Weather;
  season: Season;
  hour: number;
  temperatureC: number;
  scale: number;
  camera: THREE.Camera;
}

const RAIN_MAX = 1400;
const SNOW_MAX = 1000;
const PETAL_MAX = 240;
const STEAM_MAX = 320;
const FLY_MAX = 150;

export function createParticles(terrain: Terrain, look: LookUniforms): ParticleField {
  const objects: THREE.Object3D[] = [];
  const rain = makePoints(RAIN_MAX, rainMaterial(look), 'rain', (i, pos, seed) => {
    pos[i * 3] = hash(i, 1) * 2 - 1;
    pos[i * 3 + 1] = hash(i, 2);
    pos[i * 3 + 2] = hash(i, 3) * 2 - 1;
    seed[i] = hash(i, 4);
  });
  const snow = makePoints(SNOW_MAX, snowMaterial(look), 'snow', (i, pos, seed) => {
    pos[i * 3] = hash(i, 5) * 2 - 1;
    pos[i * 3 + 1] = hash(i, 6);
    pos[i * 3 + 2] = hash(i, 7) * 2 - 1;
    seed[i] = hash(i, 8);
  });
  const petalOrigins = scatterPetals(terrain, PETAL_MAX);
  const petals = makePoints(PETAL_MAX, petalMaterial(look), 'petals', (i, pos, seed) => {
    const p = petalOrigins[i] ?? petalOrigins[0];
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
    seed[i] = hash(i, 9);
  });
  const steamOrigins = scatterSteam(terrain, STEAM_MAX);
  const steam = makePoints(STEAM_MAX, steamMaterial(look), 'steam', (i, pos, seed) => {
    const p = steamOrigins[i] ?? steamOrigins[0];
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
    seed[i] = hash(i, 11);
  });
  const flyOrigins = scatterFireflies(terrain, FLY_MAX);
  const flies = makePoints(FLY_MAX, fireflyMaterial(look), 'fireflies', (i, pos, seed) => {
    const p = flyOrigins[i] ?? flyOrigins[0];
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
    seed[i] = hash(i, 13);
  });
  const mist = createMist(terrain, look);
  for (const pts of [rain, snow, petals, steam, flies]) objects.push(pts);
  objects.push(...mist.sprites);

  const view = new THREE.Vector3();
  return {
    objects,
    sync(state) {
      state.camera.getWorldDirection(view);
      const cam = state.camera.position;
      setCam(rain.material as THREE.ShaderMaterial, cam, view);
      setCam(snow.material as THREE.ShaderMaterial, cam, view);
      const scale = state.scale;
      const raining = state.weather === 'rain' || state.weather === 'storm';
      const snowing = state.weather === 'snow' || (state.weather === 'storm' && state.season === 'winter');
      const petalsOn = look.petalRate.value > 0 && !raining && !snowing;
      const cold = THREE.MathUtils.clamp((14 - state.temperatureC) / 18, 0, 1);
      const night = state.hour < 4.8 || state.hour > 19.5;
      const fliesOn = state.season === 'summer' && night && !raining && state.weather !== 'storm' && state.weather !== 'snow';
      draw(rain, raining ? Math.round(RAIN_MAX * scale) : 0);
      draw(snow, snowing ? Math.round(SNOW_MAX * scale) : 0);
      draw(petals, petalsOn ? Math.round(PETAL_MAX * Math.min(1, look.petalRate.value) * scale) : 0);
      draw(steam, Math.round(STEAM_MAX * (0.35 + cold * 0.85) * look.steamOpacity.value * scale));
      draw(flies, fliesOn ? Math.round(FLY_MAX * scale) : 0);
      mist.material.opacity = 0.025 + look.mist.value * 0.06;
      mist.material.color.copy(look.fogColor.value);
    },
    dispose() {
      for (const obj of objects) {
        const mesh = obj as THREE.Points;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
      mist.texture.dispose();
    },
  };
}

function draw(points: THREE.Points, count: number): void {
  points.geometry.setDrawRange(0, count);
  points.visible = count > 0;
}

function setCam(mat: THREE.ShaderMaterial, cam: THREE.Vector3, view: THREE.Vector3): void {
  (mat.uniforms.uCam.value as THREE.Vector3).copy(cam);
  (mat.uniforms.uView.value as THREE.Vector3).copy(view);
}

function makePoints(
  count: number,
  material: THREE.ShaderMaterial,
  name: string,
  fill: (i: number, pos: Float32Array, seed: Float32Array) => void,
): THREE.Points {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) fill(i, pos, seed);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const pts = new THREE.Points(geo, material);
  pts.name = name;
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  pts.visible = false;
  return pts;
}

function hash(i: number, k: number): number {
  let x = Math.imul(i + k * 131, 374761393);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function scatterPetals(terrain: Terrain, count: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const tree of terrain.trees) {
    if (tree.kind !== 'sakura' && tree.kind !== 'maple') continue;
    out.push([tree.x, tree.y + tree.height * 0.7, tree.z]);
    if (out.length >= count) return out;
  }
  const half = terrain.half;
  let n = 0;
  for (let z = -half; z < half && out.length < count; z += 8) {
    for (let x = -half; x < half && out.length < count; x += 8) {
      n++;
      const px = x + (hash(n, 2) - 0.5) * 6;
      const pz = z + (hash(n, 3) - 0.5) * 6;
      if (!terrain.inBounds(px, pz, 2)) continue;
      const surface = terrain.surfaceAt(px, pz);
      if (surface !== 'sakura_grove' && surface !== 'maple_wood') continue;
      out.push([px, terrain.heightAt(px, pz) + 4 + hash(n, 4) * 6, pz]);
    }
  }
  if (!out.length) out.push([0, terrain.heightAt(0, 0) + 4, 0]);
  while (out.length < count) out.push(out[out.length % Math.max(1, out.length)]);
  return out;
}

function scatterSteam(terrain: Terrain, count: number): Array<[number, number, number]> {
  const springs = terrain.pools.filter((p) => p.kind === 'hot_spring');
  const out: Array<[number, number, number]> = [];
  if (!springs.length) {
    out.push([0, 16, 0]);
    return out;
  }
  for (let i = 0; i < count; i++) {
    const pool = springs[i % springs.length];
    const ang = hash(i, 21) * Math.PI * 2;
    const rad = Math.sqrt(hash(i, 22)) * pool.radius * 0.75;
    out.push([pool.x + Math.cos(ang) * rad, pool.surfaceY + 0.4, pool.z + Math.sin(ang) * rad]);
  }
  return out;
}

function scatterFireflies(terrain: Terrain, count: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const half = terrain.half;
  let n = 0;
  for (let z = -half; z < half && out.length < count; z += 14) {
    for (let x = -half; x < half && out.length < count; x += 14) {
      n++;
      const px = x + (hash(n, 31) - 0.5) * 10;
      const pz = z + (hash(n, 32) - 0.5) * 10;
      if (!terrain.inBounds(px, pz, 2)) continue;
      const surface = terrain.surfaceAt(px, pz);
      if (surface !== 'meadow' && surface !== 'flower_field' && surface !== 'reed_marsh') continue;
      out.push([px, terrain.heightAt(px, pz) + 0.5 + hash(n, 33) * 1.8, pz]);
    }
  }
  if (!out.length) out.push([0, terrain.heightAt(0, 0) + 1, 0]);
  while (out.length < count) out.push(out[out.length % out.length]);
  return out;
}

const SOFT_FRAG = /* glsl */ `
precision highp float;
varying float vLife;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec2 pc = gl_PointCoord - vec2(0.5);
  float d = length(pc);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.08, d) * uAlpha;
  gl_FragColor = vec4(uColor, a * vLife);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function pointMat(look: LookUniforms, vert: string, frag: string, blending: THREE.Blending, extra: Record<string, { value: unknown }> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: look.time,
      uCam: { value: new THREE.Vector3() },
      uView: { value: new THREE.Vector3(0, 0, -1) },
      uWindX: look.windX,
      uWindZ: look.windZ,
      uColor: look.fogColor,
      uAlpha: { value: 0.5 },
      ...extra,
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending,
    toneMapped: true,
  });
}

const FOLLOW_VERT = /* glsl */ `
attribute float aSeed;
varying float vLife;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uView;
uniform float uWindX;
uniform float uWindZ;
uniform float uSpeed;
uniform float uSpan;
uniform float uFall;
uniform float uDrift;
uniform float uSize;
void main() {
  vec3 origin = uCam + uView * 16.0 + vec3(0.0, -4.0, 0.0);
  float t = fract(aSeed + uTime * uSpeed);
  vec3 p = origin + position * vec3(uSpan, 1.0, uSpan);
  p.y = origin.y + uFall * 0.45 - t * uFall;
  p.x += (uWindX * uDrift + sin(aSeed * 20.0) * 0.35) * t;
  p.z += (uWindZ * uDrift + cos(aSeed * 17.0) * 0.35) * t;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * 90.0 / max(1.0, -mv.z), 1.2, 36.0);
  vLife = 1.0;
}
`;

function rainMaterial(look: LookUniforms): THREE.ShaderMaterial {
  const mat = pointMat(look, FOLLOW_VERT, RAIN_FRAG, THREE.NormalBlending, {
    uSpeed: { value: 1.15 },
    uSpan: { value: 46 },
    uFall: { value: 52 },
    uDrift: { value: 14 },
    uSize: { value: 9 },
  });
  mat.uniforms.uColor = look.shallow;
  mat.uniforms.uAlpha = { value: 0.42 };
  return mat;
}

function snowMaterial(look: LookUniforms): THREE.ShaderMaterial {
  const mat = pointMat(look, FOLLOW_VERT, SOFT_FRAG, THREE.NormalBlending, {
    uSpeed: { value: 0.18 },
    uSpan: { value: 52 },
    uFall: { value: 40 },
    uDrift: { value: 8 },
    uSize: { value: 16 },
  });
  mat.uniforms.uColor = look.snowCol;
  mat.uniforms.uAlpha = { value: 0.85 };
  return mat;
}

const RAIN_FRAG = /* glsl */ `
precision highp float;
varying float vLife;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec2 pc = gl_PointCoord - vec2(0.5);
  float a = smoothstep(0.5, 0.02, abs(pc.x) * 4.2) * smoothstep(0.5, 0.0, abs(pc.y));
  if (a < 0.04) discard;
  gl_FragColor = vec4(uColor, a * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const WORLD_VERT = /* glsl */ `
attribute float aSeed;
varying float vLife;
uniform float uTime;
uniform float uWindX;
uniform float uWindZ;
uniform float uSpeed;
uniform float uRise;
uniform float uSize;
uniform float uSpread;
void main() {
  float life = fract(aSeed + uTime * uSpeed);
  vec3 p = position;
  p.y += life * uRise;
  p.x += uWindX * life * uSpread + sin(uTime * 0.8 + aSeed * 12.0) * life * 1.4;
  p.z += uWindZ * life * uSpread + cos(uTime * 0.7 + aSeed * 9.0) * life * 1.4;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * 120.0 / max(1.0, -mv.z), 1.5, 64.0);
  vLife = sin(life * 3.14159);
}
`;

function petalMaterial(look: LookUniforms): THREE.ShaderMaterial {
  const mat = pointMat(look, WORLD_VERT, SOFT_FRAG, THREE.NormalBlending, {
    uSpeed: { value: 0.12 },
    uRise: { value: -8 },
    uSize: { value: 8 },
    uSpread: { value: 6 },
  });
  mat.uniforms.uColor = look.petal;
  mat.uniforms.uAlpha = { value: 0.82 };
  return mat;
}

function steamMaterial(look: LookUniforms): THREE.ShaderMaterial {
  const mat = pointMat(look, WORLD_VERT, SOFT_FRAG, THREE.NormalBlending, {
    uSpeed: { value: 0.06 },
    uRise: { value: 14 },
    uSize: { value: 26 },
    uSpread: { value: 5.5 },
  });
  mat.uniforms.uColor = look.steam;
  mat.uniforms.uAlpha = { value: 0.28 };
  return mat;
}

const FLY_VERT = /* glsl */ `
attribute float aSeed;
varying float vLife;
uniform float uTime;
uniform float uSize;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.6 + aSeed * 14.0) * 0.35;
  p.y += cos(uTime * 0.8 + aSeed * 9.0) * 0.22;
  p.z += sin(uTime * 0.5 + aSeed * 6.0) * 0.35;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * 160.0 / max(1.0, -mv.z), 2.0, 28.0);
  vLife = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 2.4 + aSeed * 40.0));
}
`;

const FLY_FRAG = /* glsl */ `
precision highp float;
varying float vLife;
uniform vec3 uColor;
void main() {
  vec2 pc = gl_PointCoord - vec2(0.5);
  float d = length(pc);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * vLife;
  gl_FragColor = vec4(uColor * (1.4 + vLife), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function fireflyMaterial(look: LookUniforms): THREE.ShaderMaterial {
  const mat = pointMat(look, FLY_VERT, FLY_FRAG, THREE.AdditiveBlending, { uSize: { value: 14 } });
  mat.uniforms.uColor = look.firefly;
  return mat;
}

function createMist(terrain: Terrain, look: LookUniforms): { sprites: THREE.Sprite[]; material: THREE.SpriteMaterial; texture: THREE.Texture } {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not shade mist sprite');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.08,
    fog: false,
  });
  material.color = look.fogColor.value;
  const sprites: THREE.Sprite[] = [];
  const spots: Array<[number, number, number, number]> = [];
  const step = Math.max(1, Math.floor(terrain.riverSamples.length / 4));
  for (let i = step; i < terrain.riverSamples.length - step; i += step) {
    const s = terrain.riverSamples[i];
    spots.push([s.x + 18, s.surfaceY + 7, s.z - 10, 46]);
  }
  for (const [x, y, z, size] of spots) {
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size * 0.42, 1);
    sprite.renderOrder = 3;
    sprite.name = 'basin-mist';
    sprites.push(sprite);
  }
  return { sprites, material, texture };
}
