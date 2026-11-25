import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArtDirection } from '../../data/schema';
import type { Season, TreeKind } from '../../sim/ids';
import type { Terrain, TreeInstance } from '../../sim/terrain';
import { NOISE_GLSL } from './glsl';
import type { LookUniforms } from './look';
import type { QualitySettings } from './lighting';

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

interface ProtoTree {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  height: number;
  canopyRadius: number;
}

export interface Foliage {
  readonly objects: THREE.Object3D[];
  update(camera: THREE.Camera): void;
  setSeason(season: Season): void;
  setQuality(settings: QualitySettings): void;
  dispose(): void;
}

export function createFoliage(terrain: Terrain, art: ArtDirection, look: LookUniforms, settings: QualitySettings): Foliage {
  const objects: THREE.Object3D[] = [];
  const trunkColor = new THREE.Color(art.terrain.forestFloor).lerp(new THREE.Color(art.terrain.rock), 0.42).multiplyScalar(0.72);
  const branchColor = trunkColor.clone().lerp(new THREE.Color(art.terrain.sinter), 0.18);
  const protos: Record<TreeKind, ProtoTree> = {
    cedar: buildCedar(trunkColor, branchColor),
    sakura: buildBroad(trunkColor, branchColor, 'sakura'),
    maple: buildBroad(trunkColor, branchColor, 'maple'),
    pine: buildPine(trunkColor, branchColor),
  };
  const batches: Batch[] = [];
  for (const kind of ['cedar', 'sakura', 'maple', 'pine'] as const) {
    const batch = makeBatch(kind, terrain, protos[kind], art, look, settings.fillerScale);
    batches.push(batch);
    objects.push(batch.trunk, batch.canopy);
  }
  objects.push(...createRocks(terrain, art, look));
  objects.push(...createProps(terrain, art));

  const cover = createGroundCover(terrain, look, settings);
  objects.push(cover.group);

  let season: Season | null = null;
  return {
    objects,
    update(camera) {
      cover.update(camera);
    },
    setSeason(next) {
      if (season === next) return;
      season = next;
      const s = art.seasons[next];
      const colors: Record<TreeKind, THREE.Color> = {
        cedar: new THREE.Color(s.cedar),
        sakura: new THREE.Color(s.sakuraCanopy),
        maple: new THREE.Color(s.mapleCanopy),
        pine: new THREE.Color(s.pine),
      };
      const foliage: Record<TreeKind, number> = {
        cedar: 1,
        pine: 1,
        sakura: next === 'winter' ? 0.1 : 1,
        maple: next === 'winter' ? 0.15 : 1,
      };
      for (const batch of batches) {
        paintAll(batch.canopy.geometry as THREE.BufferGeometry, colors[batch.kind]);
        batch.foliage.value = foliage[batch.kind];
      }
    },
    setQuality(next) {
      cover.setQuality(next);
    },
    dispose() {
      cover.dispose();
      const seenGeo = new Set<THREE.BufferGeometry>();
      const seenMat = new Set<THREE.Material>();
      for (const obj of objects) {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry && !seenGeo.has(mesh.geometry)) {
          seenGeo.add(mesh.geometry);
          mesh.geometry.dispose();
        }
        const mat = mesh.material;
        const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
        for (const item of list) {
          if (!seenMat.has(item)) {
            seenMat.add(item);
            item.dispose();
          }
        }
      }
    },
  };
}

interface Batch {
  kind: TreeKind;
  trunk: THREE.InstancedMesh;
  canopy: THREE.InstancedMesh;
  foliage: { value: number };
}

function makeBatch(kind: TreeKind, terrain: Terrain, proto: ProtoTree, art: ArtDirection, look: LookUniforms, fillerScale: number): Batch {
  const real = terrain.trees.filter((t) => t.kind === kind);
  const filler = fillerTrees(kind, terrain, fillerScale);
  const all = real.concat(filler);
  const count = Math.max(1, all.length);
  const foliage = { value: 1 };
  const material = treeMaterial(look, foliage, kind);
  const depth = treeDepthMaterial(look, foliage);
  const trunk = new THREE.InstancedMesh(proto.trunk, material, count);
  const canopy = new THREE.InstancedMesh(proto.canopy, material, count);
  trunk.name = `${kind}-trunk`;
  canopy.name = `${kind}-canopy`;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  canopy.castShadow = true;
  canopy.receiveShadow = false;
  trunk.frustumCulled = false;
  canopy.frustumCulled = false;
  trunk.customDepthMaterial = depth;
  canopy.customDepthMaterial = depth;
  trunk.count = all.length;
  canopy.count = all.length;
  const tint = new THREE.Color();
  for (let i = 0; i < all.length; i++) {
    const tree = all[i];
    _q.setFromAxisAngle(UP, tree.rotation);
    _p.set(tree.x, tree.y, tree.z);
    const sx = tree.canopyRadius / proto.canopyRadius;
    const sy = tree.height / proto.height;
    _s.set(sx, sy, sx);
    _m.compose(_p, _q, _s);
    trunk.setMatrixAt(i, _m);
    canopy.setMatrixAt(i, _m);
    const shift = (tree.variation - 0.5) * 0.14;
    tint.setRGB(
      THREE.MathUtils.clamp(1 + shift, 0.75, 1.2),
      THREE.MathUtils.clamp(1 + shift * 0.4, 0.8, 1.15),
      THREE.MathUtils.clamp(1 - shift * 0.3, 0.8, 1.15),
    );
    trunk.setColorAt(i, tint);
    canopy.setColorAt(i, tint);
  }
  trunk.instanceMatrix.needsUpdate = true;
  canopy.instanceMatrix.needsUpdate = true;
  if (trunk.instanceColor) trunk.instanceColor.needsUpdate = true;
  if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
  if (all.length === 0) {
    trunk.visible = false;
    canopy.visible = false;
  }
  void art;
  return { kind, trunk, canopy, foliage };
}

function fillerTrees(kind: TreeKind, terrain: Terrain, scale: number): TreeInstance[] {
  if (scale <= 0) return [];
  const step = kind === 'sakura' ? 9.5 : kind === 'maple' ? 9 : kind === 'cedar' ? 14 : 0;
  if (step === 0) return [];
  const cap = Math.round((kind === 'cedar' ? 380 : kind === 'sakura' ? 42 : 48) * scale);
  const occupied = new Set<string>();
  for (const tree of terrain.trees) occupied.add(`${Math.round(tree.x / 5)}:${Math.round(tree.z / 5)}`);
  const out: TreeInstance[] = [];
  const half = terrain.half;
  let n = 0;
  for (let z = -half + step; z < half; z += step) {
    for (let x = -half + step; x < half; x += step) {
      if (out.length >= cap) return out;
      n++;
      const jx = (hash(n, 1) - 0.5) * step * 0.8;
      const jz = (hash(n, 2) - 0.5) * step * 0.8;
      const px = x + jx;
      const pz = z + jz;
      if (!terrain.inBounds(px, pz, 3)) continue;
      if (occupied.has(`${Math.round(px / 5)}:${Math.round(pz / 5)}`)) continue;
      const surface = terrain.surfaceAt(px, pz);
      if (kind === 'cedar' && surface !== 'cedar_forest') continue;
      if (kind === 'sakura' && surface !== 'sakura_grove') continue;
      if (kind === 'maple' && surface !== 'maple_wood') continue;
      if (terrain.slopeAt(px, pz) > 0.7) continue;
      if (terrain.waterDepthAt(px, pz) > 0.05) continue;
      const v = hash(n, 3);
      const height = kind === 'cedar' ? 13 + v * 8 : kind === 'sakura' ? 5.8 + v * 3.2 : 7 + v * 4;
      const canopy = kind === 'cedar' ? 2.3 + v * 1.1 : kind === 'sakura' ? 3.3 + v * 1.8 : 2.8 + v * 1.4;
      out.push({
        x: px,
        z: pz,
        y: terrain.heightAt(px, pz),
        kind,
        height,
        trunkRadius: 0.3,
        canopyRadius: canopy,
        rotation: hash(n, 4) * Math.PI * 2,
        variation: v,
      });
      occupied.add(`${Math.round(px / 5)}:${Math.round(pz / 5)}`);
    }
  }
  return out;
}

function hash(i: number, k: number): number {
  let x = (i * 374761393 + k * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function treeMaterial(look: LookUniforms, foliage: { value: number }, kind: TreeKind): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.86,
    metalness: 0,
    vertexColors: true,
    dithering: true,
  });
  material.name = `tree-${kind}`;
  material.customProgramCacheKey = () => 'la-tree-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = look.time;
    shader.uniforms.uWindX = look.windX;
    shader.uniforms.uWindZ = look.windZ;
    shader.uniforms.uWindAmp = look.windAmp;
    shader.uniforms.uFoliage = foliage;
    shader.uniforms.uSnow = look.snow;
    shader.uniforms.uSnowCol = look.snowCol;
    shader.uniforms.uPainterly = look.painterly;
    shader.vertexShader = insert(shader.vertexShader, '#include <common>', TREE_VERT_DECL, true);
    shader.vertexShader = insert(shader.vertexShader, '#include <begin_vertex>', TREE_VERT_WIND, true);
    shader.fragmentShader = insert(shader.fragmentShader, '#include <common>', TREE_FRAG_DECL, true);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() {\n  if (vSway > 0.75 && vKeep > uFoliage) discard;\n');
    shader.fragmentShader = insert(shader.fragmentShader, '#include <color_fragment>', TREE_FRAG_COLOR, true);
  };
  return material;
}

function treeDepthMaterial(look: LookUniforms, foliage: { value: number }): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.customProgramCacheKey = () => 'la-tree-depth-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = look.time;
    shader.uniforms.uWindX = look.windX;
    shader.uniforms.uWindZ = look.windZ;
    shader.uniforms.uWindAmp = look.windAmp;
    shader.uniforms.uFoliage = foliage;
    shader.vertexShader = insert(shader.vertexShader, '#include <common>', TREE_DEPTH_DECL, true);
    shader.vertexShader = insert(shader.vertexShader, '#include <begin_vertex>', TREE_DEPTH_WIND, true);
    shader.fragmentShader = insert(shader.fragmentShader, '#include <common>', 'varying float vSway;\nvarying float vKeep;\nuniform float uFoliage;\n', true);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() {\n  if (vSway > 0.75 && vKeep > uFoliage) discard;\n');
  };
  return material;
}

const TREE_VERT_DECL = /* glsl */ `
attribute float aSway;
attribute float aHash;
varying float vSway;
varying float vKeep;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform float uTime;
uniform float uWindX;
uniform float uWindZ;
uniform float uWindAmp;
`;

const TREE_VERT_WIND = /* glsl */ `
vSway = aSway;
#ifdef USE_INSTANCING
  float laPhase = instanceMatrix[3].x * 0.15 + instanceMatrix[3].z * 0.11;
  vKeep = fract(aHash + instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.009);
#else
  float laPhase = 0.0;
  vKeep = aHash;
#endif
float laBend = aSway * aSway * uWindAmp;
transformed.x += sin(uTime * 1.25 + laPhase) * laBend * uWindX;
transformed.z += cos(uTime * 1.05 + laPhase) * laBend * uWindZ;
vWorldNormal = transformNormalByInverseViewMatrix(transformedNormal, viewMatrix);
vec4 laWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  laWorld = instanceMatrix * laWorld;
#endif
vWorldPos = (modelMatrix * laWorld).xyz;
`;

const TREE_DEPTH_DECL = /* glsl */ `
attribute float aSway;
attribute float aHash;
varying float vSway;
varying float vKeep;
uniform float uTime;
uniform float uWindX;
uniform float uWindZ;
uniform float uWindAmp;
`;

const TREE_DEPTH_WIND = /* glsl */ `
vSway = aSway;
#ifdef USE_INSTANCING
  float laPhase = instanceMatrix[3].x * 0.15 + instanceMatrix[3].z * 0.11;
  vKeep = fract(aHash + instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.009);
  float laBend = aSway * aSway * uWindAmp;
  transformed.x += sin(uTime * 1.25 + laPhase) * laBend * uWindX;
  transformed.z += cos(uTime * 1.05 + laPhase) * laBend * uWindZ;
#else
  vKeep = aHash;
#endif
`;

const TREE_FRAG_DECL = /* glsl */ `
varying float vSway;
varying float vKeep;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform float uFoliage;
uniform float uSnow;
uniform vec3 uSnowCol;
uniform float uPainterly;
${NOISE_GLSL}
`;

const TREE_FRAG_COLOR = /* glsl */ `
float laN = laFbm(vWorldPos.xz * 0.085 + vWorldPos.y * 0.03);
diffuseColor.rgb *= mix(1.0, mix(0.86, 1.1, laN), uPainterly);
float laSnow = uSnow * smoothstep(0.22, 0.86, clamp(vWorldNormal.y, 0.0, 1.0)) * mix(0.18, 1.0, vSway);
diffuseColor.rgb = mix(diffuseColor.rgb, uSnowCol, clamp(laSnow, 0.0, 0.9));
totalEmissiveRadiance += diffuseColor.rgb * mix(0.045, 0.12, vSway);
`;

function insert(source: string, marker: string, code: string, after: boolean): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`Tree shader is missing ${marker}`);
  if (after) return source.slice(0, at + marker.length) + '\n' + code + source.slice(at + marker.length);
  return source.slice(0, at) + code + '\n' + source.slice(at);
}

function paintAll(geo: THREE.BufferGeometry, color: THREE.Color): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < attr.count; i++) attr.setXYZ(i, color.r, color.g, color.b);
  attr.needsUpdate = true;
}

function tag(geo: THREE.BufferGeometry, sway: number, color: THREE.Color): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count;
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const swayA = new Float32Array(n);
  const hash = new Float32Array(n);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    swayA[i] = sway;
    hash[i] = ((i * 1103515245 + 12345) % 997) / 997;
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  geo.setAttribute('aSway', new THREE.BufferAttribute(swayA, 1));
  geo.setAttribute('aHash', new THREE.BufferAttribute(hash, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geo = mergeGeometries(parts, false);
  if (!geo) throw new Error('Failed to merge tree geometry');
  for (const part of parts) part.dispose();
  geo.computeBoundingBox();
  return geo;
}

function metrics(canopy: THREE.BufferGeometry, fallbackHeight: number): { height: number; canopyRadius: number } {
  canopy.computeBoundingBox();
  const box = canopy.boundingBox;
  if (!box) return { height: fallbackHeight, canopyRadius: 1 };
  const pos = canopy.getAttribute('position');
  let r = 0.001;
  for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
  return { height: Math.max(0.5, box.max.y), canopyRadius: r };
}

function buildCedar(trunkColor: THREE.Color, branch: THREE.Color): ProtoTree {
  const trunk = tag(new THREE.CylinderGeometry(0.2, 0.38, 8.5, 6, 1), 0.05, trunkColor);
  trunk.translate(0, 4.25, 0);
  const cones: THREE.BufferGeometry[] = [];
  const specs: Array<[number, number, number]> = [
    [2.7, 7.2, 8.2],
    [2.15, 6.2, 11.2],
    [1.5, 5.2, 14.2],
    [0.75, 4.2, 17.0],
  ];
  specs.forEach(([radius, height, y], i) => {
    const cone = tag(new THREE.ConeGeometry(radius, height, 7, 1), 1, new THREE.Color('#ffffff'));
    cone.translate(0, y, 0);
    cone.rotateY(i * 0.6);
    cones.push(cone);
  });
  const canopy = merge(cones);
  const size = metrics(canopy, 19);
  return { trunk, canopy, height: Math.max(size.height, 19), canopyRadius: size.canopyRadius };
}

function buildPine(trunkColor: THREE.Color, branch: THREE.Color): ProtoTree {
  const trunk = tag(new THREE.CylinderGeometry(0.18, 0.34, 6.5, 6, 1), 0.05, trunkColor);
  trunk.translate(0, 3.25, 0);
  const parts: THREE.BufferGeometry[] = [];
  [[2.4, 5.5, 6.4], [1.7, 4.6, 9.0], [0.9, 3.6, 11.2]].forEach(([radius, height, y], i) => {
    const cone = tag(new THREE.ConeGeometry(radius, height, 6, 1), 1, new THREE.Color('#ffffff'));
    cone.translate((i - 1) * 0.12, y, 0.08 * i);
    parts.push(cone);
  });
  const canopy = merge(parts);
  const size = metrics(canopy, 13);
  void branch;
  return { trunk, canopy, height: Math.max(size.height, 13), canopyRadius: size.canopyRadius };
}

function buildBroad(trunkColor: THREE.Color, branch: THREE.Color, kind: 'sakura' | 'maple'): ProtoTree {
  const height = kind === 'sakura' ? 8 : 9.5;
  const trunkParts: THREE.BufferGeometry[] = [];
  const trunk = tag(new THREE.CylinderGeometry(0.16, 0.32, height * 0.42, 5, 1), 0.04, trunkColor);
  trunk.translate(0, height * 0.21, 0);
  trunkParts.push(trunk);
  const forks = kind === 'sakura' ? 5 : 4;
  for (let i = 0; i < forks; i++) {
    const limb = tag(new THREE.CylinderGeometry(0.04, 0.09, height * 0.34, 4, 1), 0.28, branch);
    limb.translate(0, height * 0.17, 0);
    limb.rotateZ(0.55 + (i % 2) * 0.25);
    limb.rotateY((i / forks) * Math.PI * 2);
    limb.translate(0, height * 0.38, 0);
    trunkParts.push(limb);
  }
  const blobs: THREE.BufferGeometry[] = [];
  const crown = kind === 'sakura' ? 5 : 4;
  for (let i = 0; i < crown; i++) {
    const radius = kind === 'sakura' ? 1.7 + (i % 3) * 0.28 : 1.45 + (i % 2) * 0.25;
    const blob = tag(new THREE.IcosahedronGeometry(radius, 1), 1, new THREE.Color('#ffffff'));
    const ang = (i / crown) * Math.PI * 2;
    const spread = kind === 'sakura' ? 1.55 : 1.15;
    blob.translate(Math.cos(ang) * spread, height * 0.62 + (i % 2) * 0.35, Math.sin(ang) * spread * 0.85);
    blobs.push(blob);
  }
  const canopy = merge(blobs);
  const size = metrics(canopy, height);
  return { trunk: merge(trunkParts), canopy, height: Math.max(size.height, height * 0.8), canopyRadius: size.canopyRadius };
}

function createRocks(terrain: Terrain, art: ArtDirection, look: LookUniforms): THREE.InstancedMesh[] {
  const geos = {
    boulder: rockGeo('boulder'),
    slab: rockGeo('slab'),
    sinter_mound: rockGeo('sinter_mound'),
  };
  const meshes: THREE.InstancedMesh[] = [];
  for (const kind of ['boulder', 'slab', 'sinter_mound'] as const) {
    const items = terrain.rocks.filter((r) => r.kind === kind);
    if (!items.length) continue;
    const snowMul = { value: kind === 'sinter_mound' ? 0.12 : kind === 'slab' ? 0.75 : 1 };
    const mat = rockMaterial(look, snowMul);
    const mesh = new THREE.InstancedMesh(geos[kind].geo, mat, items.length);
    mesh.name = `rocks-${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const tint = new THREE.Color();
    const base = new THREE.Color(kind === 'sinter_mound' ? art.terrain.sinter : kind === 'slab' ? art.terrain.cliff : art.terrain.rock);
    const moss = new THREE.Color(art.terrain.moss);
    const sulfur = new THREE.Color(art.terrain.sulfur);
    for (let i = 0; i < items.length; i++) {
      const rock = items[i];
      _q.setFromAxisAngle(UP, rock.rotation);
      _p.set(rock.x, rock.y, rock.z);
      _s.set(rock.radius / geos[kind].radius, rock.height / geos[kind].height, rock.radius / geos[kind].radius);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      tint.copy(base);
      if (kind === 'boulder') tint.lerp(moss, rock.variation * 0.35);
      if (kind === 'sinter_mound') tint.lerp(sulfur, rock.variation * 0.45);
      tint.multiplyScalar(0.9 + rock.variation * 0.2);
      mesh.setColorAt(i, tint);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    meshes.push(mesh);
  }
  return meshes;
}

function rockGeo(kind: 'boulder' | 'slab' | 'sinter_mound'): { geo: THREE.BufferGeometry; radius: number; height: number } {
  let geo: THREE.BufferGeometry;
  if (kind === 'slab') geo = new THREE.BoxGeometry(1.7, 0.42, 1.15);
  else if (kind === 'sinter_mound') geo = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  else geo = new THREE.IcosahedronGeometry(1, 1);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  geo.translate(0, -box.min.y, 0);
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  let radius = 0.001;
  let height = 0.001;
  for (let i = 0; i < pos.count; i++) {
    radius = Math.max(radius, Math.hypot(pos.getX(i), pos.getZ(i)));
    height = Math.max(height, pos.getY(i));
  }
  return { geo, radius, height };
}

function rockMaterial(look: LookUniforms, snowMul: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.94,
    metalness: 0,
    vertexColors: false,
  });
  material.customProgramCacheKey = () => 'la-rock-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = look.snow;
    shader.uniforms.uSnowCol = look.snowCol;
    shader.uniforms.uSnowMul = snowMul;
    shader.vertexShader = insert(shader.vertexShader, '#include <common>', 'varying vec3 vWorldNormal;\n', true);
    shader.vertexShader = insert(
      shader.vertexShader,
      '#include <begin_vertex>',
      'vWorldNormal = transformNormalByInverseViewMatrix(transformedNormal, viewMatrix);\n',
      true,
    );
    shader.fragmentShader = insert(
      shader.fragmentShader,
      '#include <common>',
      'varying vec3 vWorldNormal;\nuniform float uSnow;\nuniform vec3 uSnowCol;\nuniform float uSnowMul;\n',
      true,
    );
    shader.fragmentShader = insert(
      shader.fragmentShader,
      '#include <color_fragment>',
      'diffuseColor.rgb = mix(diffuseColor.rgb, uSnowCol, uSnow * uSnowMul * smoothstep(0.42, 0.88, clamp(vWorldNormal.y, 0.0, 1.0)));\n',
      true,
    );
  };
  return material;
}

function createProps(terrain: Terrain, art: ArtDirection): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const ruin = terrain.landmarks.get('lantern_ruin');
  if (ruin) {
    const rock = new THREE.Color(art.terrain.rock);
    const moss = new THREE.Color(art.terrain.moss);
    const parts: THREE.BufferGeometry[] = [];
    const stones: Array<[number, number, number, number, number, number, number]> = [
      [0.9, 0.45, 0.7, 0, 0.22, 0, 0.2],
      [0.55, 0.7, 0.5, -0.7, 0.32, 0.45, 0.8],
      [0.4, 0.28, 0.36, 0.75, 0.12, -0.35, 1.4],
    ];
    for (const [w, h, d, x, y, z, rot] of stones) {
      const box = new THREE.BoxGeometry(w, h, d);
      box.translate(0, h / 2, 0);
      box.rotateY(rot);
      box.translate(x, y, z);
      const n = box.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const mossy = box.getAttribute('position').getY(i) > h * 0.45 ? 0.55 : 0.15;
        const c = rock.clone().lerp(moss, mossy);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      box.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(box);
    }
    const geo = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (geo) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(ruin.x, ruin.y, ruin.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'lantern-ruin';
      out.push(mesh);
    }
  }
  const lick = terrain.landmarks.get('mineral_lick');
  if (lick) {
    const geo = new THREE.CircleGeometry(lick.radius * 0.72, 20);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(art.terrain.sinter).lerp(new THREE.Color(art.terrain.sulfur), 0.2),
      roughness: 0.9,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(lick.x, lick.y + 0.05, lick.z);
    mesh.receiveShadow = true;
    mesh.name = 'salt-lick';
    out.push(mesh);
  }
  return out;
}

interface Cover {
  group: THREE.Group;
  update(camera: THREE.Camera): void;
  setQuality(settings: QualitySettings): void;
  dispose(): void;
}

function createGroundCover(terrain: Terrain, look: LookUniforms, settings: QualitySettings): Cover {
  const group = new THREE.Group();
  group.name = 'ground-cover';
  const blade = bladeGeometry();
  const material = grassMaterial(look);
  const chunks = new Map<string, THREE.InstancedMesh>();
  let radius = settings.grassRadius;
  let spacing = settings.grassSpacing;
  const anchor = new THREE.Vector2(1e9, 1e9);
  const chunk = 22;

  function clear(): void {
    for (const mesh of chunks.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    chunks.clear();
    anchor.set(1e9, 1e9);
  }

  function build(i: number, j: number): THREE.InstancedMesh | null {
    const x0 = i * chunk;
    const z0 = j * chunk;
    const samples = Math.min(140, Math.round((chunk * chunk) / (spacing * spacing)));
    const matrices: THREE.Matrix4[] = [];
    const kinds: number[] = [];
    for (let n = 0; n < samples; n++) {
      const px = x0 + hash(i * 1000 + n, j + 3) * chunk;
      const pz = z0 + hash(i * 1000 + n, j + 9) * chunk;
      if (!terrain.inBounds(px, pz, 1.5)) continue;
      if (terrain.slopeAt(px, pz) > 0.62) continue;
      if (terrain.waterDepthAt(px, pz) > 0.12) continue;
      const surface = terrain.surfaceAt(px, pz);
      if (surface === 'rock' || surface === 'cliff' || surface === 'sinter' || surface === 'river' || surface === 'pool' || surface === 'hot_spring' || surface === 'riverbed') continue;
      const veg = terrain.vegetationDensityAt(px, pz);
      if (surface !== 'reed_marsh' && veg < 0.18) continue;
      const roll = hash(n + i * 13, j * 17 + 4);
      let kind = 0;
      let h = 0.4 + roll * 0.45;
      let w = 0.28 + roll * 0.22;
      if (surface === 'reed_marsh') {
        kind = 2;
        h = 1.15 + roll * 0.9;
        w = 0.16;
      } else if ((surface === 'flower_field' || (surface === 'meadow' && roll > 0.72)) && look.flowerOn.value > 0.5 && roll > 0.45) {
        kind = 1;
        h = 0.32 + roll * 0.22;
        w = 0.34;
      }
      _q.setFromAxisAngle(UP, roll * Math.PI);
      _p.set(px, terrain.heightAt(px, pz), pz);
      _s.set(w, h, w);
      matrices.push(new THREE.Matrix4().compose(_p, _q, _s));
      kinds.push(kind);
    }
    if (!matrices.length) return null;
    const geo = blade.clone();
    const kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(kinds), 1);
    geo.setAttribute('aKind', kindAttr);
    const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
    for (let n = 0; n < matrices.length; n++) mesh.setMatrixAt(n, matrices[n]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.name = `grass-${i}:${j}`;
    return mesh;
  }

  return {
    group,
    update(camera) {
      look.fade0.value = radius * 0.45;
      look.fade1.value = radius * 0.96;
      const x = camera.position.x;
      const z = camera.position.z;
      if (Math.hypot(x - anchor.x, z - anchor.y) < chunk * 0.4 && chunks.size) return;
      anchor.set(x, z);
      const i0 = Math.floor((x - radius) / chunk);
      const i1 = Math.floor((x + radius) / chunk);
      const j0 = Math.floor((z - radius) / chunk);
      const j1 = Math.floor((z + radius) / chunk);
      const need = new Set<string>();
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cx = (i + 0.5) * chunk;
          const cz = (j + 0.5) * chunk;
          if (Math.hypot(cx - x, cz - z) > radius + chunk * 0.5) continue;
          const key = `${i}:${j}`;
          need.add(key);
          if (!chunks.has(key)) {
            const mesh = build(i, j);
            if (mesh) {
              chunks.set(key, mesh);
              group.add(mesh);
            }
          }
        }
      }
      for (const [key, mesh] of chunks) {
        if (!need.has(key)) {
          mesh.removeFromParent();
          mesh.geometry.dispose();
          chunks.delete(key);
        }
      }
    },
    setQuality(next) {
      radius = next.grassRadius;
      spacing = next.grassSpacing;
      clear();
    },
    dispose() {
      clear();
      blade.dispose();
      material.dispose();
    },
  };
}

function bladeGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
    0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geo.computeVertexNormals();
  return geo;
}

function grassMaterial(look: LookUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: look.time,
      uWindX: look.windX,
      uWindZ: look.windZ,
      uWindAmp: look.windAmp,
      uGrassBase: look.grassBase,
      uGrassTip: look.grassTip,
      uFlower: look.flower,
      uMoss: look.moss,
      uSunDir: look.sunDir,
      uSunColor: look.sunColor,
      uSunIntensity: look.sunIntensity,
      uHemiSky: look.hemiSky,
      uHemiGround: look.hemiGround,
      uHemiIntensity: look.hemiIntensity,
      uSnow: look.snow,
      uSnowCol: look.snowCol,
      uFade0: look.fade0,
      uFade1: look.fade1,
      uFogColor: look.fogColor,
      uFogDensity: look.fogDensity,
      uFloorY: look.floorY,
      uMist: look.mist,
    },
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

const GRASS_VERT = /* glsl */ `
attribute float aKind;
varying float vKind;
varying float vY;
varying vec2 vUv;
varying vec3 vWorld;
uniform float uTime;
uniform float uWindX;
uniform float uWindZ;
uniform float uWindAmp;
void main() {
  vUv = uv;
  vKind = aKind;
  vY = position.y;
  vec3 p = position;
  #ifdef USE_INSTANCING
    float phase = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
    float bend = position.y * position.y * uWindAmp * 0.55;
    p.x += sin(uTime * 1.8 + phase) * bend * uWindX;
    p.z += cos(uTime * 1.5 + phase) * bend * uWindZ;
    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  #else
    vec4 world = modelMatrix * vec4(p, 1.0);
  #endif
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GRASS_FRAG = /* glsl */ `
precision highp float;
varying float vKind;
varying float vY;
varying vec2 vUv;
varying vec3 vWorld;
uniform vec3 uGrassBase;
uniform vec3 uGrassTip;
uniform vec3 uFlower;
uniform vec3 uMoss;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uHemiIntensity;
uniform float uSnow;
uniform vec3 uSnowCol;
uniform float uFade0;
uniform float uFade1;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFloorY;
uniform float uMist;

void main() {
  float taper = mix(0.5, 0.08, vY);
  if (abs(vUv.x - 0.5) > taper) discard;
  vec3 col = mix(uGrassBase, uGrassTip, vY);
  if (vKind > 1.5) col = mix(uMoss, uGrassTip, vY);
  else if (vKind > 0.5) col = mix(uGrassBase, uFlower, smoothstep(0.45, 0.95, vY));
  col = mix(col, uSnowCol, uSnow * smoothstep(0.5, 1.0, vY) * 0.85);
  float ndl = 0.42 + 0.58 * max(dot(vec3(0.0, 1.0, 0.0), normalize(uSunDir)), 0.0);
  vec3 light = uSunColor * uSunIntensity * ndl + mix(uHemiGround, uHemiSky, 0.65) * uHemiIntensity;
  col *= light;
  float dist = distance(vWorld.xz, cameraPosition.xz);
  float fade = 1.0 - smoothstep(uFade0, uFade1, dist);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (fade < dither) discard;
  float fogDist = distance(vWorld, cameraPosition);
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * fogDist * fogDist);
  float basin = exp(-max(vWorld.y - uFloorY, 0.0) * 0.048);
  fogFactor = clamp(fogFactor + basin * (1.0 - exp(-fogDist * max(uFogDensity, 0.0004) * 3.6)) * uMist, 0.0, 0.94);
  col = mix(col, uFogColor, fogFactor);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
