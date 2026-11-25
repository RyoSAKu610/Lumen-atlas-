import * as THREE from 'three';
import type { Terrain } from '../../sim/terrain';
import { NOISE_GLSL } from './glsl';
import type { LookUniforms } from './look';

const VERT = /* glsl */ `
uniform float uTime;
attribute float aAcross;
attribute float aAlong;
attribute float aDepth;
attribute float aFoam;
varying float vAcross;
varying float vAlong;
varying float vDepth;
varying float vFoam;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 p = position;
  float ripple = sin(aAlong * 0.55 + uTime * 1.4) * cos(aAcross * 3.0 + uTime * 0.8);
  p.y += ripple * 0.025 * (1.0 - aFoam);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vAcross = aAcross;
  vAlong = aAlong;
  vDepth = aDepth;
  vFoam = aFoam;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying float vAcross;
varying float vAlong;
varying float vDepth;
varying float vFoam;
varying vec3 vWorld;
varying vec3 vNormal;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uHotShallow;
uniform vec3 uHotDeep;
uniform vec3 uFoamCol;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uHorizon;
uniform float uTime;
uniform float uHot;
uniform float uNight;
uniform float uWet;
${NOISE_GLSL}
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFloorY;
uniform float uMist;

void main() {
  vec3 n = normalize(vNormal);
  float flow = laNoise(vec2(vAlong * 0.08 - uTime * 0.35, vAcross * 1.4));
  n.x += (flow - 0.5) * 0.18;
  n.z += (laNoise(vec2(vAcross * 2.0, vAlong * 0.05 + uTime * 0.2)) - 0.5) * 0.18;
  n = normalize(n);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, viewDir), 0.0);
  float fres = pow(1.0 - ndv, 4.0);
  float depth = clamp(vDepth, 0.0, 1.0);
  vec3 shallow = mix(uShallow, uHotShallow, uHot);
  vec3 deep = mix(uDeep, uHotDeep, uHot);
  vec3 col = mix(shallow, deep, 0.62 + 0.38 * depth);
  col = mix(col, uHorizon, fres * 0.05);
  float bank = smoothstep(0.88, 1.0, abs(vAcross));
  float rapids = clamp(vFoam * 0.55 + bank * 0.22, 0.0, 1.0);
  col = mix(col, uFoamCol, rapids);
  float fall = step(0.7, vFoam) * step(vDepth, 0.45);
  float streak = sin(vAcross * 38.0 + laNoise(vec2(vAlong * 0.22 - uTime * 2.4, vAcross * 4.0)) * 7.0);
  streak = smoothstep(-0.15, 0.75, streak);
  vec3 fallCol = mix(mix(shallow, deep, 0.35), uFoamCol, 0.22 + 0.62 * streak);
  col = mix(col, fallCol, fall);
  vec3 halfDir = normalize(normalize(uSunDir) + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 180.0) * uSunIntensity;
  col += uSunColor * spec * 0.02;
  col += uHotDeep * uHot * 0.05;
  float alpha = mix(0.92, 0.0, smoothstep(0.42, 1.0, abs(vAcross)));
  alpha = mix(alpha, 0.28 + 0.62 * streak, fall);
  float fogDist = distance(vWorld, cameraPosition);
  float fogFactor = (1.0 - exp(-uFogDensity * uFogDensity * fogDist * fogDist)) * 0.8;
  fogFactor += uMist * 0.04 * exp(-max(vWorld.y - uFloorY, 0.0) * 0.08);
  fogFactor = clamp(fogFactor, 0.0, 0.72);
  vec3 fogged = mix(col, uFogColor, fogFactor);
  gl_FragColor = vec4(fogged, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function waterMaterial(look: LookUniforms, hot: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uShallow: look.shallow,
      uDeep: look.deep,
      uHotShallow: look.hotShallow,
      uHotDeep: look.hotDeep,
      uFoamCol: look.foam,
      uSunDir: look.sunDir,
      uSunColor: look.sunColor,
      uSunIntensity: look.sunIntensity,
      uHorizon: look.horizon,
      uTime: look.time,
      uHot: { value: hot },
      uNight: look.night,
      uWet: look.wet,
      uFogColor: look.fogColor,
      uFogDensity: look.fogDensity,
      uFloorY: look.floorY,
      uMist: look.mist,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

export interface WaterLayer {
  readonly objects: THREE.Object3D[];
  dispose(): void;
}

export function createWater(terrain: Terrain, look: LookUniforms): WaterLayer {
  const objects: THREE.Object3D[] = [];
  const river = buildRiver(terrain);
  if (river) {
    const mesh = new THREE.Mesh(river, waterMaterial(look, 0));
    mesh.name = 'river';
    mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    objects.push(mesh);
  }
  const cold = waterMaterial(look, 0);
  const hot = waterMaterial(look, 1);
  for (const pool of terrain.pools) {
    const geo = new THREE.CircleGeometry(pool.radius * 0.98, pool.radius > 8 ? 56 : 36);
    geo.rotateX(-Math.PI / 2);
    tagDisc(geo, pool.radius * 0.98);
    const mesh = new THREE.Mesh(geo, pool.kind === 'hot_spring' ? hot : cold);
    mesh.position.set(pool.x, pool.surfaceY + 0.07, pool.z);
    mesh.name = `pool:${pool.id}`;
    mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    objects.push(mesh);
  }
  const falls = buildFalls(terrain);
  if (falls) {
    const mat = waterMaterial(look, 0);
    const mesh = new THREE.Mesh(falls.sheet, mat);
    mesh.name = 'waterfalls';
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    objects.push(mesh);
    const mist = buildMist(falls.mist, look);
    objects.push(mist);
  }
  return {
    objects,
    dispose() {
      for (const obj of objects) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    },
  };
}

function tagStrip(geo: THREE.BufferGeometry, across: number[], along: number[], depth: number[], foam: number[]): void {
  geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
  geo.computeVertexNormals();
}

function buildRiver(terrain: Terrain): THREE.BufferGeometry | null {
  const samples = terrain.riverSamples;
  if (samples.length < 2) return null;
  const positions: number[] = [];
  const across: number[] = [];
  const along: number[] = [];
  const depth: number[] = [];
  const foam: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const sideX = -Math.cos(s.flowDir);
    const sideZ = Math.sin(s.flowDir);
    const prev = samples[Math.max(0, i - 1)];
    const drop = Math.max(0, prev.surfaceY - s.surfaceY);
    const foamAmt = drop > 0.45 ? Math.min(1, (drop - 0.3) / 1.4) : 0;
    const w = s.halfWidth * 1.55;
    const cols: Array<[number, number, number]> = [
      [-1, 0.42, foamAmt * 0.25],
      [0, 1, foamAmt],
      [1, 0.42, foamAmt * 0.25],
    ];
    for (const [side, deep, foamSide] of cols) {
      positions.push(s.x + sideX * w * side, s.surfaceY + 0.14, s.z + sideZ * w * side);
      across.push(side);
      along.push(s.s);
      depth.push(deep);
      foam.push(foamSide);
    }
    if (i > 0) {
      const a = (i - 1) * 3;
      indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  tagStrip(geo, across, along, depth, foam);
  return geo;
}

function tagDisc(geo: THREE.BufferGeometry, radius: number): void {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const across = new Float32Array(n);
  const along = new Float32Array(n);
  const depth = new Float32Array(n);
  const foam = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const radial = Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)) / radius);
    across[i] = radial;
    along[i] = Math.atan2(pos.getZ(i), pos.getX(i));
    depth[i] = 1 - radial;
    foam[i] = radial > 0.86 ? 0.45 : 0;
  }
  geo.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
  geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geo.setAttribute('aFoam', new THREE.BufferAttribute(foam, 1));
}

function buildFalls(terrain: Terrain): { sheet: THREE.BufferGeometry; mist: Float32Array } | null {
  if (!terrain.waterfalls.length) return null;
  const positions: number[] = [];
  const across: number[] = [];
  const along: number[] = [];
  const depth: number[] = [];
  const foam: number[] = [];
  const indices: number[] = [];
  const mist: number[] = [];
  let base = 0;
  for (const fall of terrain.waterfalls) {
    const forward = new THREE.Vector3(Math.sin(fall.flowDir), 0, Math.cos(fall.flowDir));
    const side = new THREE.Vector3(-Math.cos(fall.flowDir), 0, Math.sin(fall.flowDir));
    const top = new THREE.Vector3(fall.top.x, fall.top.y, fall.top.z);
    const bot = new THREE.Vector3(fall.bottom.x, fall.bottom.y, fall.bottom.z);
    const drop = Math.max(1, top.y - bot.y);
    const segs = 14;
    const cols = 5;
    const half = fall.width * 0.5;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = new THREE.Vector3().lerpVectors(top, bot, t);
      p.y = THREE.MathUtils.lerp(top.y, bot.y, Math.pow(t, 1.35));
      p.addScaledVector(forward, Math.sin(t * Math.PI) * Math.min(1.6, drop * 0.08));
      const pinch = 0.72 + 0.28 * Math.sin(t * Math.PI);
      for (let c = 0; c < cols; c++) {
        const s = (c / (cols - 1)) * 2 - 1;
        const q = p.clone().addScaledVector(side, half * pinch * s);
        positions.push(q.x, q.y, q.z);
        across.push(s);
        along.push(t * drop);
        depth.push(0.2);
        foam.push(0.82);
      }
      if (i > 0) {
        const row = base + (i - 1) * cols;
        const next = row + cols;
        for (let c = 0; c < cols - 1; c++) {
          indices.push(row + c, next + c, row + c + 1, row + c + 1, next + c, next + c + 1);
        }
      }
    }
    base += (segs + 1) * cols;
    mist.push(bot.x, bot.y + 0.6, bot.z, fall.width);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  tagStrip(geo, across, along, depth, foam);
  return { sheet: geo, mist: new Float32Array(mist) };
}

const MIST_VERT = /* glsl */ `
attribute float aSeed;
varying float vSeed;
uniform float uTime;
void main() {
  vec3 p = position;
  float life = fract(aSeed + uTime * 0.08);
  p.y += life * 7.0;
  p.x += sin(uTime * 0.4 + aSeed * 12.0) * life * 2.2;
  p.z += cos(uTime * 0.35 + aSeed * 9.0) * life * 2.2;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(90.0 * (1.0 - life * 0.4) / max(1.0, -mv.z), 2.0, 64.0);
  vSeed = life;
}
`;

const MIST_FRAG = /* glsl */ `
precision highp float;
varying float vSeed;
uniform vec3 uSteam;
uniform float uOpacity;
void main() {
  vec2 pc = gl_PointCoord - vec2(0.5);
  float d = length(pc);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * (1.0 - vSeed) * uOpacity;
  gl_FragColor = vec4(uSteam, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function buildMist(packed: Float32Array, look: LookUniforms): THREE.Points {
  const count = Math.max(1, (packed.length / 4) * 28);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const falls = packed.length / 4;
  for (let i = 0; i < count; i++) {
    const f = Math.floor((i / count) * falls);
    const x = packed[f * 4];
    const y = packed[f * 4 + 1];
    const z = packed[f * 4 + 2];
    const w = packed[f * 4 + 3];
    const ang = (i * 2.399) % (Math.PI * 2);
    const rad = ((i * 17) % 100) / 100 * w * 0.55;
    positions[i * 3] = x + Math.cos(ang) * rad;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z + Math.sin(ang) * rad;
    seeds[i] = (i * 0.618) % 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: look.time,
      uSteam: look.steam,
      uOpacity: look.steamOpacity,
    },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'falls-mist';
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}
