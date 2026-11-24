/**
 * Deterministic terrain shared by the simulation and the renderer.
 *
 * The height field is synthesised from a RegionLayout + seed. `heightAt` interpolates with the
 * same triangle split that `meshData()` emits, so feet planted by the simulation / IK sit exactly
 * on the rendered ground. Grid index: idx = j * res + i, x = -half + i * cell, z = -half + j * cell.
 */
import type { RegionLayout } from '../data/schema';
import { SURFACE_KINDS, type LandmarkKind, type PoolKind, type SurfaceKind, type TreeKind } from './ids';
import { Noise2D } from './noise';
import { Rng, deriveSeed } from './rng';
import type { Vec3 } from './types';

export const WATER_NONE = 0;
export const WATER_RIVER = 1;
export const WATER_POOL = 2;
export const WATER_HOT_SPRING = 3;
export const WATER_PLUNGE = 4;

const SURFACE_INDEX: Record<SurfaceKind, number> = Object.fromEntries(
  SURFACE_KINDS.map((k, i) => [k, i]),
) as Record<SurfaceKind, number>;

/** Concealment offered by each surface (stalking / hiding). */
const SURFACE_COVER: Record<SurfaceKind, number> = {
  meadow: 0.18,
  flower_field: 0.22,
  sakura_grove: 0.45,
  cedar_forest: 0.85,
  maple_wood: 0.7,
  reed_marsh: 0.8,
  moss_rocks: 0.45,
  rock: 0.3,
  cliff: 0.2,
  sinter: 0.05,
  riverbed: 0.08,
  river: 0,
  pool: 0,
  hot_spring: 0.1,
};

/** Grazing biomass capacity of each surface (0..1). */
const SURFACE_FORAGE: Record<SurfaceKind, number> = {
  meadow: 1,
  flower_field: 0.9,
  sakura_grove: 0.6,
  cedar_forest: 0.3,
  maple_wood: 0.45,
  reed_marsh: 0.7,
  moss_rocks: 0.3,
  rock: 0.05,
  cliff: 0,
  sinter: 0,
  riverbed: 0.12,
  river: 0,
  pool: 0,
  hot_spring: 0,
};

export interface TreeInstance {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly kind: TreeKind;
  readonly height: number;
  readonly trunkRadius: number;
  readonly canopyRadius: number;
  readonly rotation: number;
  /** 0..1 per-instance variation for tint / shape. */
  readonly variation: number;
}

export interface RockInstance {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly radius: number;
  readonly height: number;
  readonly rotation: number;
  readonly kind: 'boulder' | 'sinter_mound' | 'slab';
  readonly variation: number;
}

export interface PoolInfo {
  readonly id: string;
  readonly kind: PoolKind;
  readonly name: { ja: string; en: string };
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly depth: number;
  readonly surfaceY: number;
  readonly temperatureC: number;
  readonly capacity: number;
}

export interface LandmarkInfo {
  readonly id: string;
  readonly kind: LandmarkKind;
  readonly name: { ja: string; en: string };
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly radius: number;
  readonly note: string;
}

export interface RiverSample {
  readonly x: number;
  readonly z: number;
  readonly surfaceY: number;
  readonly halfWidth: number;
  /** Heading of the flow (rad, forward = (sin, 0, cos)). */
  readonly flowDir: number;
  /** Arc length from the source (m). */
  readonly s: number;
}

export interface WaterfallInfo {
  readonly top: Vec3;
  readonly bottom: Vec3;
  readonly width: number;
  readonly flowDir: number;
}

export interface Obstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface TerrainMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly resolution: number;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const smootherstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Valley axis sampled per metre of arc length. */
interface AxisProfile {
  pts: ReadonlyArray<readonly [number, number]>;
  cum: number[];
  floor: Float32Array;
  /** Floor averaged over ±45 m, used away from the valley floor so cliff lips do not cut the ridges. */
  floorSoft: Float32Array;
  halfWidth: Float32Array;
}

function buildAxisProfile(tr: RegionLayout['terrain']): AxisProfile {
  const pts = tr.axis.map((a) => a.p);
  const cum = [0];
  for (let k = 0; k < pts.length - 1; k++) cum.push(cum[k] + Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]));
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(total) + 1);
  const floor = new Float32Array(n);
  const halfWidth = new Float32Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(i, total);
    while (seg < pts.length - 2 && s > cum[seg + 1]) seg++;
    const t = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    floor[i] = lerp(tr.axis[seg].floor, tr.axis[seg + 1].floor, t);
    halfWidth[i] = lerp(tr.axis[seg].halfWidth ?? tr.floorHalfWidth, tr.axis[seg + 1].halfWidth ?? tr.floorHalfWidth, t);
  }
  const window = 45;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + floor[i];
  const floorSoft = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - window);
    const b = Math.min(n, i + window + 1);
    floorSoft[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return { pts, cum, floor, floorSoft, halfWidth };
}

function axisLookup(table: Float32Array, s: number): number {
  const i = Math.min(table.length - 1, Math.max(0, s));
  const i0 = Math.floor(i);
  return lerp(table[i0], table[Math.min(table.length - 1, i0 + 1)], i - i0);
}

interface AxisSample {
  dist: number;
  halfWidth: number;
  floor: number;
  floorSoft: number;
}

const AXIS_BLEND = 14;
const axisScratchD: number[] = [];
const axisScratchS: number[] = [];

/**
 * Distance to the axis polyline plus axis-profile values. Values are soft-min blended across
 * segments so they stay continuous where the nearest segment switches (no creases on the ridges).
 */
function sampleAxis(x: number, z: number, axis: AxisProfile, lipOffset: number): AxisSample {
  const pts = axis.pts;
  let dMin = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[k + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    axisScratchD[k] = d;
    axisScratchS[k] = axis.cum[k] + Math.sqrt(len2) * t;
    if (d < dMin) dMin = d;
  }
  let wSum = 0;
  let hw = 0;
  let fl = 0;
  let fs = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const w = Math.exp(-(axisScratchD[k] - dMin) / AXIS_BLEND);
    if (w < 1e-4) continue;
    const s = axisScratchS[k];
    wSum += w;
    hw += w * axisLookup(axis.halfWidth, s);
    fl += w * axisLookup(axis.floor, s + lipOffset);
    fs += w * axisLookup(axis.floorSoft, s);
  }
  return { dist: dMin, halfWidth: hw / wSum, floor: fl / wSum, floorSoft: fs / wSum };
}

export class Terrain {
  readonly size: number;
  readonly res: number;
  readonly cell: number;
  readonly half: number;
  /** Ground (or bed, under water) height per grid vertex. */
  readonly heights: Float32Array;
  /** Water surface height per vertex, NaN where dry. */
  readonly water: Float32Array;
  readonly waterKind: Uint8Array;
  /** Index into SURFACE_KINDS per vertex. */
  readonly surface: Uint8Array;
  /** Vegetation density 0..1 from zones and defaults (grass / undergrowth). */
  readonly vegetationDensity: Float32Array;
  readonly cover: Float32Array;
  /** Grazing biomass capacity 0..1. */
  readonly forage: Float32Array;
  /** Per-vertex normals (x, y, z). */
  readonly normals: Float32Array;
  /** 0 on the valley floor → 1 on the ridges. */
  readonly ridgeFactor: Float32Array;
  readonly trees: TreeInstance[] = [];
  readonly rocks: RockInstance[] = [];
  readonly pools: PoolInfo[] = [];
  readonly landmarks = new Map<string, LandmarkInfo>();
  readonly riverSamples: RiverSample[] = [];
  readonly waterfalls: WaterfallInfo[] = [];

  private readonly obstacleCell = 8;
  private readonly obstacleRes: number;
  private readonly obstacleGrid: Obstacle[][];

  private constructor(region: RegionLayout) {
    this.size = region.size;
    this.res = region.resolution;
    this.half = region.size / 2;
    this.cell = region.size / (region.resolution - 1);
    const n = this.res * this.res;
    this.heights = new Float32Array(n);
    this.water = new Float32Array(n).fill(Number.NaN);
    this.waterKind = new Uint8Array(n);
    this.surface = new Uint8Array(n);
    this.vegetationDensity = new Float32Array(n);
    this.cover = new Float32Array(n);
    this.forage = new Float32Array(n);
    this.normals = new Float32Array(n * 3);
    this.ridgeFactor = new Float32Array(n);
    this.obstacleRes = Math.ceil(this.size / this.obstacleCell);
    this.obstacleGrid = Array.from({ length: this.obstacleRes * this.obstacleRes }, () => []);
  }

  /** Build the terrain. `onProgress` receives 0..1 for the bootstrap progress screen. */
  static build(region: RegionLayout, seed: number, onProgress?: (fraction: number, stage: string) => void): Terrain {
    const t = new Terrain(region);
    const report = onProgress ?? (() => {});
    report(0, 'height field');
    t.buildBaseHeights(region, seed);
    report(0.35, 'river');
    const riverDist = t.carveRiver(region);
    report(0.5, 'pools');
    const hotSpringDist = t.carvePools(region);
    report(0.6, 'normals');
    t.computeNormals();
    report(0.7, 'surfaces');
    t.classifySurfaces(region, seed, riverDist, hotSpringDist);
    report(0.8, 'landmarks');
    for (const lm of region.landmarks) {
      t.landmarks.set(lm.id, {
        id: lm.id,
        kind: lm.kind,
        name: lm.name,
        x: lm.center[0],
        z: lm.center[1],
        y: t.heightAt(lm.center[0], lm.center[1]),
        radius: lm.radius,
        note: lm.note ?? '',
      });
    }
    report(0.85, 'vegetation & rocks');
    t.scatterTrees(region, seed, riverDist);
    t.scatterRocks(seed, riverDist, hotSpringDist);
    report(1, 'terrain ready');
    return t;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  inBounds(x: number, z: number, margin = 0): boolean {
    return x >= -this.half + margin && x <= this.half - margin && z >= -this.half + margin && z <= this.half - margin;
  }

  clampToBounds(x: number, z: number, margin = 2): { x: number; z: number } {
    const lim = this.half - margin;
    return { x: Math.min(lim, Math.max(-lim, x)), z: Math.min(lim, Math.max(-lim, z)) };
  }

  private cellCoords(x: number, z: number): { i: number; j: number; fx: number; fz: number } {
    const gx = Math.min(this.res - 1.000001, Math.max(0, (x + this.half) / this.cell));
    const gz = Math.min(this.res - 1.000001, Math.max(0, (z + this.half) / this.cell));
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    return { i, j, fx: gx - i, fz: gz - j };
  }

  private nearestIndex(x: number, z: number): number {
    const i = Math.min(this.res - 1, Math.max(0, Math.round((x + this.half) / this.cell)));
    const j = Math.min(this.res - 1, Math.max(0, Math.round((z + this.half) / this.cell)));
    return j * this.res + i;
  }

  /** Ground height (river / pool bed under water), matching the rendered triangles. */
  heightAt(x: number, z: number): number {
    const { i, j, fx, fz } = this.cellCoords(x, z);
    const r = this.res;
    const h00 = this.heights[j * r + i];
    const h10 = this.heights[j * r + i + 1];
    const h01 = this.heights[(j + 1) * r + i];
    const h11 = this.heights[(j + 1) * r + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Water surface height at (x, z), or null if dry. */
  waterSurfaceAt(x: number, z: number): number | null {
    const { i, j, fx, fz } = this.cellCoords(x, z);
    const r = this.res;
    let sum = 0;
    let wsum = 0;
    const corners: Array<[number, number]> = [
      [j * r + i, (1 - fx) * (1 - fz)],
      [j * r + i + 1, fx * (1 - fz)],
      [(j + 1) * r + i, (1 - fx) * fz],
      [(j + 1) * r + i + 1, fx * fz],
    ];
    for (const [idx, w] of corners) {
      const v = this.water[idx];
      if (!Number.isNaN(v)) {
        sum += v * w;
        wsum += w;
      }
    }
    if (wsum < 0.25) return null;
    return sum / wsum;
  }

  waterDepthAt(x: number, z: number): number {
    const s = this.waterSurfaceAt(x, z);
    if (s === null) return 0;
    return Math.max(0, s - this.heightAt(x, z));
  }

  /** Top surface: water surface where submerged, otherwise ground. */
  surfaceHeightAt(x: number, z: number): number {
    const g = this.heightAt(x, z);
    const s = this.waterSurfaceAt(x, z);
    return s !== null && s > g ? s : g;
  }

  waterKindAt(x: number, z: number): number {
    return this.waterKind[this.nearestIndex(x, z)];
  }

  normalAt(x: number, z: number): Vec3 {
    const { i, j, fx, fz } = this.cellCoords(x, z);
    const r = this.res;
    const w = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz];
    const idx = [j * r + i, j * r + i + 1, (j + 1) * r + i, (j + 1) * r + i + 1];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 4; k++) {
      nx += this.normals[idx[k] * 3] * w[k];
      ny += this.normals[idx[k] * 3 + 1] * w[k];
      nz += this.normals[idx[k] * 3 + 2] * w[k];
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /** Ground slope in radians. */
  slopeAt(x: number, z: number): number {
    return Math.acos(Math.min(1, Math.max(-1, this.normalAt(x, z).y)));
  }

  surfaceAt(x: number, z: number): SurfaceKind {
    return SURFACE_KINDS[this.surface[this.nearestIndex(x, z)]];
  }

  coverAt(x: number, z: number): number {
    return this.cover[this.nearestIndex(x, z)];
  }

  forageAt(x: number, z: number): number {
    return this.forage[this.nearestIndex(x, z)];
  }

  vegetationDensityAt(x: number, z: number): number {
    return this.vegetationDensity[this.nearestIndex(x, z)];
  }

  /** 0 on the valley floor, 1 on the ridges. */
  ridgeFactorAt(x: number, z: number): number {
    return this.ridgeFactor[this.nearestIndex(x, z)];
  }

  isWalkable(x: number, z: number, maxSlopeDeg: number, maxWaterDepth = 0.6): boolean {
    if (!this.inBounds(x, z, 3)) return false;
    if (this.slopeAt(x, z) > (maxSlopeDeg * Math.PI) / 180) return false;
    return this.waterDepthAt(x, z) <= maxWaterDepth;
  }

  getPool(id: string): PoolInfo | undefined {
    return this.pools.find((p) => p.id === id);
  }

  getLandmark(id: string): LandmarkInfo | undefined {
    return this.landmarks.get(id);
  }

  nearestPool(x: number, z: number, kind?: PoolKind): PoolInfo | null {
    let best: PoolInfo | null = null;
    let bestD = Infinity;
    for (const p of this.pools) {
      if (kind && p.kind !== kind) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Nearest point on the river centre-line (for drinking / crossing decisions). */
  nearestRiverPoint(x: number, z: number): { x: number; z: number; surfaceY: number; distance: number; halfWidth: number } | null {
    let best: RiverSample | null = null;
    let bestD = Infinity;
    for (const s of this.riverSamples) {
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, surfaceY: best.surfaceY, distance: Math.sqrt(bestD), halfWidth: best.halfWidth };
  }

  /** Tree trunks and large rocks within `radius` of (x, z). */
  obstaclesNear(x: number, z: number, radius: number, out: Obstacle[] = []): Obstacle[] {
    out.length = 0;
    const c = this.obstacleCell;
    const i0 = Math.max(0, Math.floor((x - radius + this.half) / c));
    const i1 = Math.min(this.obstacleRes - 1, Math.floor((x + radius + this.half) / c));
    const j0 = Math.max(0, Math.floor((z - radius + this.half) / c));
    const j1 = Math.min(this.obstacleRes - 1, Math.floor((z + radius + this.half) / c));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const o of this.obstacleGrid[j * this.obstacleRes + i]) {
          const d = Math.hypot(o.x - x, o.z - z);
          if (d - o.radius <= radius) out.push(o);
        }
      }
    }
    return out;
  }

  /** Triangle mesh matching `heightAt` exactly. */
  meshData(): TerrainMeshData {
    const r = this.res;
    const positions = new Float32Array(r * r * 3);
    for (let j = 0; j < r; j++) {
      for (let i = 0; i < r; i++) {
        const idx = j * r + i;
        positions[idx * 3] = -this.half + i * this.cell;
        positions[idx * 3 + 1] = this.heights[idx];
        positions[idx * 3 + 2] = -this.half + j * this.cell;
      }
    }
    const indices = new Uint32Array((r - 1) * (r - 1) * 6);
    let k = 0;
    for (let j = 0; j < r - 1; j++) {
      for (let i = 0; i < r - 1; i++) {
        const p00 = j * r + i;
        const p10 = p00 + 1;
        const p01 = p00 + r;
        const p11 = p01 + 1;
        indices[k++] = p00;
        indices[k++] = p01;
        indices[k++] = p10;
        indices[k++] = p10;
        indices[k++] = p01;
        indices[k++] = p11;
      }
    }
    return { positions, normals: this.normals.slice(), indices, resolution: r };
  }

  // ---------------------------------------------------------------------------
  // Synthesis
  // ---------------------------------------------------------------------------

  private forEachVertex(fn: (idx: number, x: number, z: number) => void): void {
    const r = this.res;
    for (let j = 0; j < r; j++) {
      const z = -this.half + j * this.cell;
      for (let i = 0; i < r; i++) fn(j * r + i, -this.half + i * this.cell, z);
    }
  }

  /** Base (pre-river / pre-pool) height function; also evaluated outside the bounds for the backdrop. */
  private baseFn: (x: number, z: number) => { h: number; cross: number; floor: number } = () => ({ h: 0, cross: 0, floor: 0 });
  /** Valley-floor height under each vertex (for "height above local floor" classification). */
  private localFloor: Float32Array = new Float32Array(0);

  /**
   * Height for distant scenery outside the playable bounds: the base field plus a steep rise so the
   * valley reads as enclosed by mountains. Inside the bounds it returns the playable height.
   */
  backdropHeightAt(x: number, z: number): number {
    const out = Math.max(Math.abs(x), Math.abs(z)) - this.half;
    if (out <= 0) return this.heightAt(x, z);
    const b = this.baseFn(x, z);
    return b.h + out * 0.55 + Math.min(1, out / 60) * 30;
  }

  private buildBaseHeights(region: RegionLayout, seed: number): void {
    const tr = region.terrain;
    const base = new Noise2D(deriveSeed(seed, 'terrain', 'base'));
    const warp = new Noise2D(deriveSeed(seed, 'terrain', 'warp'));
    const ridge = new Noise2D(deriveSeed(seed, 'terrain', 'ridge'));
    const featureNoise = new Noise2D(deriveSeed(seed, 'terrain', 'feature'));
    const axis = buildAxisProfile(tr);
    const rf = tr.ridgeFalloff;

    this.baseFn = (x: number, z: number) => {
      const hit = sampleAxis(x, z, axis, featureNoise.fbm(x * 0.035, z * 0.035, 2) * 7);
      const wobble = warp.fbm(x * 0.004, z * 0.004, 3);
      const fhw = hit.halfWidth * (1 + 0.3 * tr.edgeWarp * wobble);
      const d = Math.max(0, hit.dist + warp.fbm(x * 0.009 + 3.3, z * 0.009 - 1.7, 3) * tr.edgeWarp * fhw * 0.45);
      const cross = smoothstep(fhw, fhw + rf, d);
      const floor = lerp(hit.floor, hit.floorSoft, smoothstep(0, 0.55, cross));
      const bowl = Math.pow(Math.min(d, fhw) / fhw, 2) * 1.6;
      const ridgeT = smootherstep(fhw, fhw + rf, d);
      const ridgeShape = Math.pow(ridgeT, 1.15) * tr.ridgeHeight * (0.72 + 0.56 * (0.5 + 0.5 * base.fbm(x * 0.0032 + 5.1, z * 0.0032 - 3.7, 3)));
      const beyond = Math.max(0, d - (fhw + rf)) * 0.12;
      const floorNoise =
        base.fbm(x * 0.022, z * 0.022, 4) * tr.floorRoughness * (1 - cross * 0.5) +
        base.fbm(x * 0.0065 - 7.7, z * 0.0065 + 2.2, 2) * tr.floorRoughness * 0.9;
      const ridgeNoise = (ridge.ridged(x * 0.0055, z * 0.0055, 5) - 0.3) * tr.ridgeRoughness * Math.pow(cross, 1.3);
      let h = floor + bowl + ridgeShape + beyond + floorNoise + ridgeNoise;

      for (const f of tr.features) {
        const dist = Math.hypot(x - f.center[0], z - f.center[1]);
        const edge = featureNoise.fbm(x * 0.05 + f.center[0], z * 0.05 + f.center[1], 3) * f.falloff * 0.9;
        if (f.kind === 'plateau') {
          const m = 1 - smoothstep(f.radius, f.radius + f.falloff, dist + edge);
          h += f.height * m + featureNoise.fbm(x * 0.12, z * 0.12, 2) * 0.6 * m;
        } else {
          const m = 1 - smoothstep(f.radius * 0.15, f.radius + f.falloff, dist + edge * 0.5);
          h += (f.kind === 'mound' ? 1 : -1) * f.height * m * m * (3 - 2 * m);
        }
      }
      return { h, cross, floor };
    };

    this.localFloor = new Float32Array(this.res * this.res);
    this.forEachVertex((idx, x, z) => {
      const b = this.baseFn(x, z);
      this.heights[idx] = b.h;
      this.ridgeFactor[idx] = b.cross;
      this.localFloor[idx] = b.floor;
    });
  }

  /** Bilinear sample of the current heights (used during synthesis before triangles matter). */
  private sampleHeights(x: number, z: number): number {
    const { i, j, fx, fz } = this.cellCoords(x, z);
    const r = this.res;
    const h00 = this.heights[j * r + i];
    const h10 = this.heights[j * r + i + 1];
    const h01 = this.heights[(j + 1) * r + i];
    const h11 = this.heights[(j + 1) * r + i + 1];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }

  /** Returns per-vertex distance to the river centre-line (Infinity if far / no river). */
  private carveRiver(region: RegionLayout): Float32Array {
    const n = this.res * this.res;
    const dist = new Float32Array(n).fill(Infinity);
    const river = region.river;
    if (!river) return dist;

    // Densify the polyline and derive a monotonic (downhill) water surface.
    const step = Math.max(1, this.cell * 0.75);
    const raw: Array<{ x: number; z: number; s: number; dir: number }> = [];
    let arc = 0;
    for (let k = 0; k < river.points.length - 1; k++) {
      const [ax, az] = river.points[k];
      const [bx, bz] = river.points[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dir = Math.atan2(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / step));
      for (let q = 0; q < steps; q++) {
        const t = q / steps;
        raw.push({ x: lerp(ax, bx, t), z: lerp(az, bz, t), s: arc + len * t, dir });
      }
      arc += len;
    }
    const last = river.points[river.points.length - 1];
    const prev = river.points[river.points.length - 2];
    raw.push({ x: last[0], z: last[1], s: arc, dir: Math.atan2(last[0] - prev[0], last[1] - prev[1]) });

    let surface = Infinity;
    for (const p of raw) {
      // Minimum over a small cross-section keeps the channel in the valley bottom.
      let ground = this.sampleHeights(p.x, p.z);
      for (const o of [-1, 1]) {
        const ox = p.x + Math.cos(p.dir) * river.halfWidth * o;
        const oz = p.z - Math.sin(p.dir) * river.halfWidth * o;
        ground = Math.min(ground, this.sampleHeights(ox, oz));
      }
      surface = Math.min(surface, ground - 0.35);
      this.riverSamples.push({ x: p.x, z: p.z, surfaceY: surface, halfWidth: river.halfWidth, flowDir: p.dir, s: p.s });
    }

    // Waterfalls: abrupt drops of the water surface along the channel.
    for (let k = 1; k < this.riverSamples.length; k++) {
      const a = this.riverSamples[k - 1];
      let b = this.riverSamples[k];
      if (a.surfaceY - b.surfaceY < 0.8) continue;
      let m = k;
      while (m + 1 < this.riverSamples.length && this.riverSamples[m].surfaceY - this.riverSamples[m + 1].surfaceY > 0.4) m++;
      b = this.riverSamples[m];
      const drop = a.surfaceY - b.surfaceY;
      if (drop > 2.5) {
        this.waterfalls.push({
          top: { x: a.x, y: a.surfaceY, z: a.z },
          bottom: { x: b.x, y: b.surfaceY, z: b.z },
          width: river.halfWidth * 2,
          flowDir: a.flowDir,
        });
      }
      k = m;
    }

    // Stamp the channel into the grid.
    const bank = river.halfWidth * 1.4 + 3;
    const reach = river.halfWidth + bank;
    const surfAt = new Float32Array(n).fill(Number.NaN);
    for (const s of this.riverSamples) {
      const i0 = Math.max(0, Math.floor((s.x - reach + this.half) / this.cell));
      const i1 = Math.min(this.res - 1, Math.ceil((s.x + reach + this.half) / this.cell));
      const j0 = Math.max(0, Math.floor((s.z - reach + this.half) / this.cell));
      const j1 = Math.min(this.res - 1, Math.ceil((s.z + reach + this.half) / this.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const idx = j * this.res + i;
          const x = -this.half + i * this.cell;
          const z = -this.half + j * this.cell;
          const d = Math.hypot(x - s.x, z - s.z);
          if (d < dist[idx]) {
            dist[idx] = d;
            surfAt[idx] = s.surfaceY;
          }
        }
      }
    }
    for (let idx = 0; idx < n; idx++) {
      const d = dist[idx];
      if (!(d < reach)) continue;
      const s = surfAt[idx];
      const h = this.heights[idx];
      if (d < river.halfWidth) {
        const bed = s - river.depth * (1 - Math.pow(d / river.halfWidth, 2)) - 0.05;
        this.heights[idx] = Math.min(h, bed);
      } else {
        const tb = (d - river.halfWidth) / bank;
        const bankTarget = s + 0.12 + tb * 0.8;
        this.heights[idx] = lerp(Math.min(h, bankTarget), h, smoothstep(0, 1, tb));
      }
      if (d < river.halfWidth + 0.6 && this.heights[idx] < s) {
        this.water[idx] = s;
        this.waterKind[idx] = WATER_RIVER;
      }
    }
    return dist;
  }

  /** Returns per-vertex distance to the nearest hot spring edge, normalised by its radius. */
  private carvePools(region: RegionLayout): Float32Array {
    const n = this.res * this.res;
    const hotDist = new Float32Array(n).fill(Infinity);
    for (const pool of region.pools) {
      const [cx, cz] = pool.center;
      const R = pool.radius;
      let surface: number;
      const river = pool.kind === 'plunge_pool' ? this.nearestRiverPoint(cx, cz) : null;
      if (river && river.distance < R + river.halfWidth) {
        surface = river.surfaceY;
      } else {
        let minRim = Infinity;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          minRim = Math.min(minRim, this.sampleHeights(cx + Math.cos(a) * R, cz + Math.sin(a) * R));
        }
        surface = minRim - 0.12;
      }
      const rimW = Math.max(2.5, R * 0.45);
      const terraceR = pool.kind === 'hot_spring' ? R * 2 : R + rimW;
      const kind = pool.kind === 'hot_spring' ? WATER_HOT_SPRING : pool.kind === 'plunge_pool' ? WATER_PLUNGE : WATER_POOL;
      this.forEachVertex((idx, x, z) => {
        const r = Math.hypot(x - cx, z - cz);
        if (pool.kind === 'hot_spring') hotDist[idx] = Math.min(hotDist[idx], Math.max(0, r - R) / R);
        if (r > terraceR) return;
        let h = this.heights[idx];
        if (r < R) {
          const bed = surface - pool.depth * Math.pow(1 - Math.pow(r / R, 2), 0.6) - 0.05;
          h = Math.min(h, bed);
        } else if (r < R + rimW) {
          const t = (r - R) / rimW;
          h = lerp(Math.min(h, surface + 0.18), h, smoothstep(0, 1, t));
        }
        if (pool.kind === 'hot_spring' && r >= R && r < terraceR) {
          const fade = 1 - smoothstep(R, terraceR, r);
          h += 0.16 * (0.5 + 0.5 * Math.sin((r - R) * 2.6)) * fade;
        }
        this.heights[idx] = h;
        if (r < R + 0.6 && h < surface) {
          this.water[idx] = surface;
          this.waterKind[idx] = kind;
        }
      });
      this.pools.push({
        id: pool.id,
        kind: pool.kind,
        name: pool.name,
        x: cx,
        z: cz,
        radius: R,
        depth: pool.depth,
        surfaceY: surface,
        temperatureC: pool.temperatureC,
        capacity: pool.capacity,
      });
    }
    return hotDist;
  }

  private computeNormals(): void {
    const r = this.res;
    const c = this.cell;
    for (let j = 0; j < r; j++) {
      for (let i = 0; i < r; i++) {
        const hl = this.heights[j * r + Math.max(0, i - 1)];
        const hr = this.heights[j * r + Math.min(r - 1, i + 1)];
        const hd = this.heights[Math.max(0, j - 1) * r + i];
        const hu = this.heights[Math.min(r - 1, j + 1) * r + i];
        const dx = (i === 0 || i === r - 1 ? 1 : 2) * c;
        const dz = (j === 0 || j === r - 1 ? 1 : 2) * c;
        let nx = -(hr - hl) / dx;
        let ny = 1;
        let nz = -(hu - hd) / dz;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const idx = (j * r + i) * 3;
        this.normals[idx] = nx;
        this.normals[idx + 1] = ny;
        this.normals[idx + 2] = nz;
      }
    }
  }

  private classifySurfaces(region: RegionLayout, seed: number, riverDist: Float32Array, hotDist: Float32Array): void {
    const edge = new Noise2D(deriveSeed(seed, 'terrain', 'zones'));
    const veg = new Noise2D(deriveSeed(seed, 'terrain', 'veg'));
    const riverHalf = region.river?.halfWidth ?? 0;
    const zones = region.zones.map((zn) => ({
      ...zn,
      cos: Math.cos(-(zn.rotation ?? 0)),
      sin: Math.sin(-(zn.rotation ?? 0)),
    }));
    this.forEachVertex((idx, x, z) => {
      const h = this.heights[idx];
      const ny = this.normals[idx * 3 + 1];
      const slope = Math.acos(Math.min(1, ny)) * (180 / Math.PI);
      const cross = this.ridgeFactor[idx];
      const n1 = veg.fbm(x * 0.02, z * 0.02, 3);

      let bestKind: SurfaceKind | null = null;
      let bestW = 0;
      for (const zn of zones) {
        const dx = x - zn.center[0];
        const dz = z - zn.center[1];
        const lx = dx * zn.cos - dz * zn.sin;
        const lz = dx * zn.sin + dz * zn.cos;
        const e = Math.sqrt((lx / zn.radiusX) ** 2 + (lz / zn.radiusZ) ** 2);
        const w = (1 - smoothstep(0.55, 1.05, e + edge.fbm(x * 0.03, z * 0.03, 3) * 0.28)) * zn.density;
        if (w > bestW) {
          bestW = w;
          bestKind = zn.kind;
        }
      }

      let kind: SurfaceKind;
      let density = 0;
      const wk = this.waterKind[idx];
      if (wk !== WATER_NONE && this.water[idx] > h + 0.04) {
        kind = wk === WATER_RIVER || wk === WATER_PLUNGE ? 'river' : wk === WATER_HOT_SPRING ? 'hot_spring' : 'pool';
      } else if (slope > 46) {
        kind = 'cliff';
      } else if (hotDist[idx] < 0.9 + n1 * 0.25) {
        kind = 'sinter';
      } else if (riverDist[idx] < riverHalf + 2.2 + n1 * 1.5) {
        kind = 'riverbed';
        density = 0.15;
      } else if (bestKind && bestW > 0.3) {
        kind = bestKind;
        density = bestW;
      } else if (slope > 36) {
        kind = 'rock';
      } else if (cross > 0.3) {
        const alpine = h - this.localFloor[idx] > region.terrain.ridgeHeight * 1.25 && n1 > 0;
        kind = alpine ? 'moss_rocks' : 'cedar_forest';
        density = alpine ? 0.35 : 0.55 + 0.35 * (0.5 + 0.5 * n1);
      } else {
        kind = 'meadow';
        density = 0.65 + 0.35 * (0.5 + 0.5 * n1);
      }
      this.surface[idx] = SURFACE_INDEX[kind];
      this.vegetationDensity[idx] = Math.min(1, Math.max(0, density));
      this.cover[idx] = Math.min(1, SURFACE_COVER[kind] * (0.7 + 0.6 * Math.max(density, 0.5)));
      this.forage[idx] = Math.min(1, SURFACE_FORAGE[kind] * (0.6 + 0.5 * Math.max(density, 0.4)));
    });
  }

  private addObstacle(o: Obstacle): void {
    const i = Math.floor((o.x + this.half) / this.obstacleCell);
    const j = Math.floor((o.z + this.half) / this.obstacleCell);
    if (i < 0 || j < 0 || i >= this.obstacleRes || j >= this.obstacleRes) return;
    this.obstacleGrid[j * this.obstacleRes + i].push(o);
  }

  private scatterTrees(region: RegionLayout, seed: number, riverDist: Float32Array): void {
    const rng = new Rng(deriveSeed(seed, 'terrain', 'trees'));
    const clearings = region.landmarks.filter((l) => l.kind === 'den' || l.kind === 'nest' || l.kind === 'lookout' || l.kind === 'salt_lick');
    const spacing = 5.5;
    const maxTrees = 4200;
    const riverHalf = region.river?.halfWidth ?? 0;
    for (let z = -this.half + spacing / 2; z < this.half; z += spacing) {
      for (let x = -this.half + spacing / 2; x < this.half; x += spacing) {
        const px = x + rng.range(-0.45, 0.45) * spacing;
        const pz = z + rng.range(-0.45, 0.45) * spacing;
        const roll = rng.next();
        const variation = rng.next();
        const rot = rng.range(0, Math.PI * 2);
        const sizeRoll = rng.next();
        if (this.trees.length >= maxTrees || !this.inBounds(px, pz, 2)) continue;
        const idx = this.nearestIndex(px, pz);
        const kind = SURFACE_KINDS[this.surface[idx]];
        const density = this.vegetationDensity[idx];
        let tree: TreeKind | null = null;
        let p = 0;
        switch (kind) {
          case 'cedar_forest':
            p = 0.62 * Math.max(0.35, density);
            tree = variation < 0.1 ? 'maple' : 'cedar';
            break;
          case 'sakura_grove':
            p = 0.42 * Math.max(0.4, density);
            tree = 'sakura';
            break;
          case 'maple_wood':
            p = 0.5 * Math.max(0.4, density);
            tree = variation < 0.15 ? 'cedar' : 'maple';
            break;
          case 'moss_rocks':
            p = 0.1;
            tree = 'pine';
            break;
          case 'rock':
            p = 0.035;
            tree = 'pine';
            break;
          case 'meadow':
            p = 0.004;
            tree = variation < 0.6 ? 'sakura' : 'maple';
            break;
          case 'flower_field':
            p = 0.003;
            tree = 'sakura';
            break;
          default:
            p = 0;
        }
        if (!tree || roll >= p) continue;
        if (this.slopeAt(px, pz) > (38 * Math.PI) / 180) continue;
        if (riverDist[idx] < riverHalf + 4) continue;
        if (this.waterDepthAt(px, pz) > 0) continue;
        if (this.pools.some((pl) => Math.hypot(pl.x - px, pl.z - pz) < pl.radius * (pl.kind === 'hot_spring' ? 2.1 : 1.4) + 2)) continue;
        if (clearings.some((c) => Math.hypot(c.center[0] - px, c.center[1] - pz) < c.radius)) continue;
        const dims: Record<TreeKind, [number, number, number, number, number, number]> = {
          // [minH, maxH, minTrunk, maxTrunk, minCanopy, maxCanopy]
          cedar: [15, 27, 0.32, 0.6, 2.2, 3.6],
          sakura: [5.5, 9.5, 0.28, 0.45, 3.4, 5.4],
          maple: [6.5, 12, 0.24, 0.4, 2.8, 4.4],
          pine: [7, 14, 0.28, 0.48, 2.2, 3.4],
        };
        const d = dims[tree];
        const t = sizeRoll;
        const inst: TreeInstance = {
          x: px,
          z: pz,
          y: this.heightAt(px, pz),
          kind: tree,
          height: lerp(d[0], d[1], t),
          trunkRadius: lerp(d[2], d[3], t),
          canopyRadius: lerp(d[4], d[5], t),
          rotation: rot,
          variation,
        };
        this.trees.push(inst);
        this.addObstacle({ x: px, z: pz, radius: inst.trunkRadius + 0.25 });
      }
    }
  }

  private scatterRocks(seed: number, riverDist: Float32Array, hotDist: Float32Array): void {
    const rng = new Rng(deriveSeed(seed, 'terrain', 'rocks'));
    const spacing = 4;
    const maxRocks = 900;
    for (let z = -this.half + spacing / 2; z < this.half; z += spacing) {
      for (let x = -this.half + spacing / 2; x < this.half; x += spacing) {
        const px = x + rng.range(-0.5, 0.5) * spacing;
        const pz = z + rng.range(-0.5, 0.5) * spacing;
        const roll = rng.next();
        const sizeRoll = rng.next();
        const rot = rng.range(0, Math.PI * 2);
        const variation = rng.next();
        if (this.rocks.length >= maxRocks || !this.inBounds(px, pz, 2)) continue;
        const idx = this.nearestIndex(px, pz);
        const kind = SURFACE_KINDS[this.surface[idx]];
        let p = 0;
        let rockKind: RockInstance['kind'] = 'boulder';
        if (kind === 'sinter' && hotDist[idx] > 0.15) {
          p = 0.14;
          rockKind = 'sinter_mound';
        } else if (kind === 'riverbed' || (riverDist[idx] < 14 && kind !== 'river')) {
          p = 0.06;
        } else if (kind === 'moss_rocks') {
          p = 0.16;
        } else if (kind === 'rock') {
          p = 0.07;
          rockKind = variation < 0.4 ? 'slab' : 'boulder';
        } else if (kind === 'cedar_forest') {
          p = 0.012;
        } else if (kind === 'meadow' || kind === 'flower_field') {
          p = 0.004;
        }
        if (roll >= p || this.waterDepthAt(px, pz) > 0.05) continue;
        const radius = rockKind === 'sinter_mound' ? lerp(0.5, 1.4, sizeRoll) : lerp(0.35, 2.1, sizeRoll * sizeRoll);
        const inst: RockInstance = {
          x: px,
          z: pz,
          y: this.heightAt(px, pz),
          radius,
          height: radius * (rockKind === 'slab' ? 0.45 : rockKind === 'sinter_mound' ? 0.5 : lerp(0.6, 1.1, variation)),
          rotation: rot,
          kind: rockKind,
          variation,
        };
        this.rocks.push(inst);
        if (radius >= 0.7) this.addObstacle({ x: px, z: pz, radius: radius * 0.9 });
      }
    }
  }
}
