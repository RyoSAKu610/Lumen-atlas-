import * as THREE from 'three';
import type { Terrain } from '../../sim/terrain';
import { NOISE_GLSL } from './glsl';
import type { LookUniforms } from './look';

const VERT_DECL = /* glsl */ `
attribute float aSurface;
attribute float aBank;
attribute float aVeg;
attribute float aRidge;
flat varying float vSurface;
varying float vBank;
varying float vVeg;
varying float vRidge;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
`;

const VERT_BODY = /* glsl */ `
vSurface = aSurface;
vBank = aBank;
vVeg = aVeg;
vRidge = aRidge;
vWorldNormal = transformNormalByInverseViewMatrix(transformedNormal, viewMatrix);
vec4 laWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  laWorld = instanceMatrix * laWorld;
#endif
vWorldPos = (modelMatrix * laWorld).xyz;
`;

const FRAG_DECL = /* glsl */ `
flat varying float vSurface;
varying float vBank;
varying float vVeg;
varying float vRidge;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform vec3 uC4; uniform vec3 uC5; uniform vec3 uC6; uniform vec3 uC7;
uniform vec3 uC8; uniform vec3 uC9; uniform vec3 uC10; uniform vec3 uC11;
uniform vec3 uC12; uniform vec3 uC13;
uniform vec3 uGrassBase;
uniform vec3 uGrassTip;
uniform vec3 uFlower;
uniform vec3 uMeadowDry;
uniform vec3 uMoss;
uniform vec3 uSulfur;
uniform vec3 uSnowCol;
uniform vec3 uSeasonGround;
uniform vec3 uForest;
uniform float uSnow;
uniform float uWet;
uniform float uPainterly;
uniform float uFlowerOn;
uniform float uNight;
uniform float uFloorY;
uniform float uMist;
${NOISE_GLSL}
vec3 laPick(float id) {
  vec3 c = uC0;
  c = mix(c, uC1, step(0.5, id));
  c = mix(c, uC2, step(1.5, id));
  c = mix(c, uC3, step(2.5, id));
  c = mix(c, uC4, step(3.5, id));
  c = mix(c, uC5, step(4.5, id));
  c = mix(c, uC6, step(5.5, id));
  c = mix(c, uC7, step(6.5, id));
  c = mix(c, uC8, step(7.5, id));
  c = mix(c, uC9, step(8.5, id));
  c = mix(c, uC10, step(9.5, id));
  c = mix(c, uC11, step(10.5, id));
  c = mix(c, uC12, step(11.5, id));
  c = mix(c, uC13, step(12.5, id));
  return c;
}
vec3 laTerrainAlbedo() {
  float id = vSurface;
  vec3 base = laPick(id);
  float ny = clamp(vWorldNormal.y, 0.0, 1.0);
  float slope = 1.0 - ny;
  vec2 w = vWorldPos.xz;
  float n = laFbm(w * 0.017);
  float n2 = laFbm(w * 0.052 + 19.2);
  float speckle = laHash(floor(w * 1.45 + 0.5));
  float veg = clamp(vVeg, 0.0, 1.0);
  float living = 1.0 - step(5.5, id);
  vec3 grass = mix(uGrassBase, uGrassTip, clamp(n2, 0.0, 1.0));
  base = mix(base, grass, living * (0.28 + 0.5 * veg));
  float meadow = 1.0 - step(0.5, id);
  base = mix(base, uMeadowDry, meadow * smoothstep(0.42, 0.78, n) * (1.0 - veg * 0.45) * 0.7);
  float flowers = step(0.5, id) * (1.0 - step(1.5, id));
  base = mix(base, uFlower, flowers * smoothstep(0.58, 0.86, speckle) * uFlowerOn * 0.9);
  float grove = step(1.5, id) * (1.0 - step(4.5, id));
  base = mix(base, mix(uForest, base, 0.35), grove * (0.3 + 0.45 * n2));
  float mossy = step(5.5, id) * (1.0 - step(6.5, id));
  base = mix(base, uMoss, mossy * (0.4 + 0.45 * n) * ny);
  float rockBlend = smoothstep(0.32, 0.62, slope);
  vec3 rockCol = mix(uC7, uC8, smoothstep(0.4, 0.78, slope));
  rockCol = mix(rockCol, uMoss, mossy * 0.65 + living * veg * 0.15 * (1.0 - slope));
  float allowRock = 1.0 - step(8.5, id);
  float hardRock = step(6.5, id) * allowRock;
  base = mix(base, rockCol, clamp(max(rockBlend * allowRock, hardRock * 0.88), 0.0, 1.0));
  float sinter = step(8.5, id) * (1.0 - step(9.5, id));
  base = mix(base, mix(uC9, uSulfur, smoothstep(0.58, 0.88, n2)), sinter);
  base = mix(base, mix(base, uC8, 0.4), vRidge * rockBlend * 0.55);
  base *= mix(0.82, 1.0, smoothstep(-0.05, 0.55, ny));
  float paint = mix(0.92, 1.08, n);
  base *= mix(1.0, paint, uPainterly);
  vec3 warm = base * vec3(1.07, 1.015, 0.93);
  vec3 cool = base * vec3(0.9, 0.97, 1.04);
  base = mix(base, mix(cool, warm, n2), uPainterly * 0.6);
  base *= mix(1.0, mix(0.9, 1.07, laFbm(w * 0.0045)), uPainterly);
  float snow = uSnow * smoothstep(0.5, 0.9, ny);
  snow = max(snow, uSnow * vRidge * smoothstep(0.28, 0.66, ny) * 0.9);
  snow *= mix(1.0, 0.62, step(2.5, id) * (1.0 - step(3.5, id)) * veg);
  snow *= smoothstep(0.22, 0.62, n * 0.7 + ny * 0.5);
  snow = clamp(snow, 0.0, 1.0);
  base = mix(base, uSnowCol * mix(0.88, 1.04, n2), snow);
  float wet = uWet * smoothstep(0.08, 0.6, ny) * (1.0 - snow);
  base = mix(base, base * base * vec3(0.7, 0.76, 0.78), wet * 0.78);
  float bare = (1.0 - veg) * living * (1.0 - snow);
  base = mix(base, uSeasonGround, bare * 0.32);
  float bankGate = smoothstep(0.03, 0.18, vBank);
  vec3 gravel = mix(uC10, mix(uC7, uC0, 0.4), 0.4 + 0.2 * n2);
  vec3 bankCol = mix(mix(uC0, grass, 0.62), gravel, smoothstep(0.18, 0.8, vBank));
  base = mix(base, bankCol, bankGate);
  return max(base, vec3(0.0));
}
`;

const FRAG_ALBEDO = /* glsl */ `
diffuseColor.rgb = laTerrainAlbedo();
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(0.94, 0.36, uWet * smoothstep(0.12, 0.75, clamp(vWorldNormal.y, 0.0, 1.0)) * (1.0 - uSnow));
`;

const FRAG_EMISSIVE = /* glsl */ `
float sinter = step(8.5, vSurface) * (1.0 - step(9.5, vSurface));
float hot = step(12.5, vSurface);
totalEmissiveRadiance += uSulfur * sinter * (0.025 + 0.07 * uNight);
totalEmissiveRadiance += uC13 * hot * 0.04 * (0.35 + uNight);
`;

const FRAG_FOG = /* glsl */ `
#ifdef USE_FOG
  float laDist = distance(vWorldPos, cameraPosition);
  float laBase = 1.0 - exp(-fogDensity * fogDensity * laDist * laDist);
  float laBasin = exp(-max(vWorldPos.y - uFloorY, 0.0) * 0.048);
  float laAerial = 1.0 - exp(-laDist * max(fogDensity, 0.0004) * 1.7);
  float laFogFactor = clamp(laBase + laBasin * laAerial * uMist, 0.0, 0.94);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, laFogFactor);
#endif
`;

function mustInsert(source: string, marker: string, code: string, after: boolean): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`Terrain shader is missing ${marker}`);
  if (after) {
    const end = at + marker.length;
    return source.slice(0, end) + '\n' + code + source.slice(end);
  }
  return source.slice(0, at) + code + '\n' + source.slice(at);
}

export function createTerrainMaterial(look: LookUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.94,
    metalness: 0,
    dithering: true,
  });
  material.name = 'terrain';
  material.customProgramCacheKey = () => 'la-terrain-v3';
  const uniforms = surfUniforms(look);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = mustInsert(shader.vertexShader, '#include <common>', VERT_DECL, true);
    shader.vertexShader = mustInsert(
      shader.vertexShader,
      '#include <beginnormal_vertex>',
      'objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), clamp(aBank, 0.0, 1.0) * 0.75));',
      true,
    );
    shader.vertexShader = mustInsert(shader.vertexShader, '#include <begin_vertex>', VERT_BODY, true);
    shader.fragmentShader = mustInsert(shader.fragmentShader, '#include <common>', FRAG_DECL, true);
    shader.fragmentShader = mustInsert(shader.fragmentShader, '#include <color_fragment>', FRAG_ALBEDO, true);
    shader.fragmentShader = mustInsert(shader.fragmentShader, '#include <roughnessmap_fragment>', FRAG_ROUGH, true);
    shader.fragmentShader = mustInsert(shader.fragmentShader, '#include <emissivemap_fragment>', FRAG_EMISSIVE, true);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FRAG_FOG);
  };
  return material;
}

function surfUniforms(look: LookUniforms): Record<string, { value: unknown }> {
  const u: Record<string, { value: unknown }> = {
    uGrassBase: look.grassBase,
    uGrassTip: look.grassTip,
    uFlower: look.flower,
    uMeadowDry: look.meadowDry,
    uMoss: look.moss,
    uSulfur: look.sulfur,
    uSnowCol: look.snowCol,
    uSeasonGround: look.seasonGround,
    uForest: look.forest,
    uSnow: look.snow,
    uWet: look.wet,
    uPainterly: look.painterly,
    uFlowerOn: look.flowerOn,
    uNight: look.night,
    uFloorY: look.floorY,
    uMist: look.mist,
  };
  for (let i = 0; i < 14; i++) u[`uC${i}`] = look.surf[i];
  return u;
}

export function createTerrainMesh(terrain: Terrain, material: THREE.Material): THREE.Mesh {
  const data = terrain.meshData();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const n = terrain.res * terrain.res;
  const surface = new Float32Array(n);
  const bank = new Float32Array(n);
  const veg = new Float32Array(n);
  const ridge = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    surface[i] = terrain.surface[i];
    const x = -terrain.half + (i % terrain.res) * terrain.cell;
    const z = -terrain.half + Math.floor(i / terrain.res) * terrain.cell;
    const river = terrain.nearestRiverPoint(x, z);
    if (river) {
      const outer = river.halfWidth + 3.2;
      const t = (river.distance - river.halfWidth * 0.55) / Math.max(0.5, outer - river.halfWidth * 0.55);
      bank[i] = 1 - Math.min(1, Math.max(0, t));
    }
    veg[i] = terrain.vegetationDensity[i];
    ridge[i] = terrain.ridgeFactor[i];
  }
  geo.setAttribute('aSurface', new THREE.BufferAttribute(surface, 1));
  geo.setAttribute('aBank', new THREE.BufferAttribute(bank, 1));
  geo.setAttribute('aVeg', new THREE.BufferAttribute(veg, 1));
  geo.setAttribute('aRidge', new THREE.BufferAttribute(ridge, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

export function createBackdrop(terrain: Terrain, material: THREE.Material): THREE.Mesh {
  const half = terrain.half;
  const outer = half + 520;
  const segments = 80;
  const stride = segments + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const surface: number[] = [];
  const bank: number[] = [];
  const veg: number[] = [];
  const ridge: number[] = [];
  const indexOf: number[] = new Array(stride * stride).fill(-1);
  const grid: Array<{ x: number; y: number; z: number; out: number }> = [];

  for (let j = 0; j < stride; j++) {
    const z = THREE.MathUtils.lerp(-outer, outer, j / segments);
    for (let i = 0; i < stride; i++) {
      const x = THREE.MathUtils.lerp(-outer, outer, i / segments);
      const out = Math.max(Math.abs(x), Math.abs(z)) - half;
      let y = terrain.backdropHeightAt(x, z);
      if (out < 0) y -= 0.2;
      grid.push({ x, y, z, out });
    }
  }

  const indices: number[] = [];
  const inside = (i: number, j: number) => grid[j * stride + i].out < -6;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      if (inside(i, j) && inside(i + 1, j) && inside(i, j + 1) && inside(i + 1, j + 1)) continue;
      const corners = [j * stride + i, j * stride + i + 1, (j + 1) * stride + i, (j + 1) * stride + i + 1];
      const ids = corners.map((c) => {
        if (indexOf[c] >= 0) return indexOf[c];
        const p = grid[c];
        const id = positions.length / 3;
        indexOf[c] = id;
        positions.push(p.x, p.y, p.z);
        const slope = Math.min(1, Math.max(0, p.out) / 220);
        const cliff = slope > 0.42 || p.y > 70 ? 1 : 0;
        surface.push(cliff ? 8 : 3);
        bank.push(0);
        veg.push(cliff ? 0.08 : 0.55);
        ridge.push(Math.min(1, 0.65 + slope));
        normals.push(0, 1, 0);
        return id;
      });
      indices.push(ids[0], ids[2], ids[1], ids[1], ids[2], ids[3]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aSurface', new THREE.Float32BufferAttribute(surface, 1));
  geo.setAttribute('aBank', new THREE.Float32BufferAttribute(bank, 1));
  geo.setAttribute('aVeg', new THREE.Float32BufferAttribute(veg, 1));
  geo.setAttribute('aRidge', new THREE.Float32BufferAttribute(ridge, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'backdrop';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}
