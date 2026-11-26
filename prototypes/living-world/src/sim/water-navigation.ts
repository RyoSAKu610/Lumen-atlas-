import type { Terrain } from './terrain';

export interface DrinkSpot {
  x: number;
  z: number;
}

export interface DrinkRoute {
  /** Exact drinkable bank selected by shortest walkable route, not straight-line distance. */
  target: DrinkSpot;
  /** Ordered ground waypoints from the current individual toward the selected bank. */
  waypoints: DrinkSpot[];
  /** Approximate route length in metres. */
  distance: number;
}

interface WaterNavigation {
  step: number;
  maxSlopeDeg: number;
  width: number;
  half: number;
  walkable: Uint8Array;
  distance: Float32Array;
  next: Int32Array;
  targetIndex: Int32Array;
  targets: DrinkSpot[];
}

interface HeapNode {
  index: number;
  cost: number;
}

const navigationCache = new WeakMap<Terrain, Map<string, WaterNavigation>>();

/**
 * Pick a reachable water point by walking distance. The former nearest-bank
 * lookup used Euclidean distance, which could select water across a steep
 * ridge, deep river channel, or dense obstacle cluster. A reverse
 * multi-source Dijkstra field is built once per terrain / locomotion profile;
 * every later request is a short lookup and path reconstruction.
 */
export function findDrinkRoute(
  terrain: Terrain,
  spots: readonly DrinkSpot[],
  start: DrinkSpot,
  maxSlopeDeg: number,
  bodyRadius: number,
): DrinkRoute | null {
  if (spots.length === 0 || !Number.isFinite(start.x) || !Number.isFinite(start.z)) return null;
  // The route itself carries an explicit body-radius clearance. While
  // following it, steering uses the same 0.52× body radius + 0.15 m margin;
  // ordinary free movement retains a wider avoidance envelope.
  const clearance = Math.max(0.25, Math.min(2.2, bodyRadius * 0.52));
  const nav = getNavigation(terrain, spots, maxSlopeDeg, clearance);
  const startIndex = nearestReachableCell(nav, terrain, start, nav.maxSlopeDeg, clearance, 28);
  if (startIndex < 0 || !Number.isFinite(nav.distance[startIndex]) || nav.targetIndex[startIndex] < 0) return null;

  const target = nav.targets[nav.targetIndex[startIndex]];
  if (!target) return null;
  const waypoints: DrinkSpot[] = [];
  const startPoint = cellPoint(nav, startIndex);
  if (Math.hypot(startPoint.x - start.x, startPoint.z - start.z) > 0.7) waypoints.push(startPoint);

  let cursor = startIndex;
  for (let guard = 0; guard < nav.next.length; guard++) {
    const next = nav.next[cursor];
    if (next < 0) break;
    cursor = next;
    const point = cellPoint(nav, cursor);
    const last = waypoints[waypoints.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) > nav.step * 0.45) waypoints.push(point);
  }
  const last = waypoints[waypoints.length - 1] ?? start;
  if (Math.hypot(target.x - last.x, target.z - last.z) > 0.6) waypoints.push({ x: target.x, z: target.z });
  else if (waypoints.length === 0) waypoints.push({ x: target.x, z: target.z });

  return { target: { x: target.x, z: target.z }, waypoints, distance: nav.distance[startIndex] };
}

function getNavigation(
  terrain: Terrain,
  spots: readonly DrinkSpot[],
  maxSlopeDeg: number,
  clearance: number,
): WaterNavigation {
  let byProfile = navigationCache.get(terrain);
  if (!byProfile) {
    byProfile = new Map();
    navigationCache.set(terrain, byProfile);
  }
  // Reserve a small safety margin below each species' hard climbing limit.
  // Route cells on the exact physical limit are highly sensitive to heightfield
  // interpolation and can trap a small animal after one steering correction.
  const roundedSlope = Math.max(5, Math.floor((maxSlopeDeg - 1.5) * 2) / 2);
  const roundedClearance = Math.round(clearance * 2) / 2;
  const first = spots[0];
  const last = spots[spots.length - 1];
  const key = `${roundedSlope}:${roundedClearance}:${spots.length}:${first?.x.toFixed(1)}:${first?.z.toFixed(1)}:${last?.x.toFixed(1)}:${last?.z.toFixed(1)}`;
  const cached = byProfile.get(key);
  if (cached) return cached;

  // A ~3 m lattice skipped narrow valley shelves and safe gaps between steep
  // faces. Use a finer lattice so small-bodied fauna can retain connected
  // corridors without inventing a route through water or cliffs.
  const step = Math.max(terrain.cell, 1.75);
  const width = Math.ceil(terrain.size / step) + 1;
  const count = width * width;
  const half = terrain.half;
  const walkable = new Uint8Array(count);
  const distance = new Float32Array(count);
  distance.fill(Number.POSITIVE_INFINITY);
  const next = new Int32Array(count);
  next.fill(-1);
  const targetIndex = new Int32Array(count);
  targetIndex.fill(-1);
  const obstacleScratch: Array<{ x: number; z: number; radius: number }> = [];

  const pointAt = (index: number): DrinkSpot => ({
    x: -half + (index % width) * step,
    z: -half + Math.floor(index / width) * step,
  });
  const clearAt = (point: DrinkSpot): boolean => {
    if (!terrain.isWalkable(point.x, point.z, roundedSlope, 0.35)) return false;
    terrain.obstaclesNear(point.x, point.z, roundedClearance + 0.2, obstacleScratch);
    return !obstacleScratch.some((obstacle) =>
      Math.hypot(obstacle.x - point.x, obstacle.z - point.z) < obstacle.radius + roundedClearance + 0.15,
    );
  };

  for (let index = 0; index < count; index++) {
    if (clearAt(pointAt(index))) walkable[index] = 1;
  }

  const targets: DrinkSpot[] = [];
  const seeds: number[] = [];
  for (const spot of spots) {
    const seed = nearestGridCell(spot, pointAt, width, walkable, terrain, roundedSlope, roundedClearance, step, 2);
    if (seed < 0) continue;
    if (Math.hypot(pointAt(seed).x - spot.x, pointAt(seed).z - spot.z) > step * 1.55) continue;
    if (!clearSegment(terrain, pointAt(seed), spot, roundedSlope, roundedClearance)) continue;
    const targetId = targets.length;
    targets.push({ x: spot.x, z: spot.z });
    const offset = Math.hypot(pointAt(seed).x - spot.x, pointAt(seed).z - spot.z);
    if (offset < distance[seed]) {
      distance[seed] = offset;
      targetIndex[seed] = targetId;
      next[seed] = -1;
      seeds.push(seed);
    }
  }

  const heap = new MinHeap();
  for (const seed of seeds) heap.push(seed, distance[seed]);
  const directions = [
    [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
    [-1, 0, 1], [1, 0, 1],
    [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2],
  ] as const;

  while (heap.length > 0) {
    const current = heap.pop()!;
    if (current.cost > distance[current.index] + 1e-4) continue;
    const i = current.index % width;
    const j = Math.floor(current.index / width);
    const from = pointAt(current.index);
    for (const [di, dj, factor] of directions) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= width || nj >= width) continue;
      const neighbour = nj * width + ni;
      if (!walkable[neighbour]) continue;
      if (di !== 0 && dj !== 0) {
        const sideA = j * width + ni;
        const sideB = nj * width + i;
        if (!walkable[sideA] || !walkable[sideB]) continue;
      }
      const to = pointAt(neighbour);
      if (!clearSegment(terrain, from, to, roundedSlope, roundedClearance)) continue;
      const rise = Math.abs(terrain.heightAt(to.x, to.z) - terrain.heightAt(from.x, from.z));
      const nextCost = current.cost + step * factor + rise * 0.18;
      if (nextCost + 1e-4 >= distance[neighbour]) continue;
      distance[neighbour] = nextCost;
      next[neighbour] = current.index;
      targetIndex[neighbour] = targetIndex[current.index];
      heap.push(neighbour, nextCost);
    }
  }

  const result: WaterNavigation = {
    step,
    maxSlopeDeg: roundedSlope,
    width,
    half,
    walkable,
    distance,
    next,
    targetIndex,
    targets,
  };
  byProfile.set(key, result);
  return result;
}

function nearestReachableCell(
  nav: WaterNavigation,
  terrain: Terrain,
  start: DrinkSpot,
  maxSlopeDeg: number,
  clearance: number,
  rings: number,
): number {
  const approximateI = Math.round((start.x + nav.half) / nav.step);
  const approximateJ = Math.round((start.z + nav.half) / nav.step);
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let ring = 0; ring <= rings; ring++) {
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const i = approximateI + di;
        const j = approximateJ + dj;
        if (i < 0 || j < 0 || i >= nav.width || j >= nav.width) continue;
        const index = j * nav.width + i;
        if (!nav.walkable[index] || !Number.isFinite(nav.distance[index])) continue;
        const point = cellPoint(nav, index);
        if (!clearSegment(terrain, start, point, maxSlopeDeg, clearance)) continue;
        const direct = Math.hypot(point.x - start.x, point.z - start.z);
        const score = direct + nav.distance[index] * 0.12;
        if (score < bestScore) {
          best = index;
          bestScore = score;
        }
      }
    }
    if (best >= 0) break;
  }
  return best;
}

function nearestGridCell(
  point: DrinkSpot,
  pointAt: (index: number) => DrinkSpot,
  width: number,
  walkable: Uint8Array,
  terrain: Terrain,
  maxSlopeDeg: number,
  clearance: number,
  step: number,
  rings: number,
): number {
  const approximateI = Math.round((point.x + terrain.half) / step);
  const approximateJ = Math.round((point.z + terrain.half) / step);
  for (let ring = 0; ring <= rings; ring++) {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const i = approximateI + di;
        const j = approximateJ + dj;
        if (i < 0 || j < 0 || i >= width || j >= width) continue;
        const index = j * width + i;
        if (!walkable[index]) continue;
        const candidate = pointAt(index);
        if (!clearSegment(terrain, candidate, point, maxSlopeDeg, clearance)) continue;
        const d = Math.hypot(candidate.x - point.x, candidate.z - point.z);
        if (d < bestD) {
          best = index;
          bestD = d;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function cellPoint(nav: WaterNavigation, index: number): DrinkSpot {
  return {
    x: -nav.half + (index % nav.width) * nav.step,
    z: -nav.half + Math.floor(index / nav.width) * nav.step,
  };
}

const segmentObstacleScratch: Array<{ x: number; z: number; radius: number }> = [];

function clearSegment(
  terrain: Terrain,
  a: DrinkSpot,
  b: DrinkSpot,
  maxSlopeDeg: number,
  clearance: number,
): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const samples = Math.max(1, Math.ceil(d / 1.25));
  for (let k = 1; k < samples; k++) {
    const t = k / samples;
    const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    if (!terrain.isWalkable(point.x, point.z, maxSlopeDeg, 0.35)) return false;
    terrain.obstaclesNear(point.x, point.z, clearance + 0.2, segmentObstacleScratch);
    if (segmentObstacleScratch.some((obstacle) =>
      Math.hypot(obstacle.x - point.x, obstacle.z - point.z) < obstacle.radius + clearance + 0.15,
    )) return false;
  }
  return true;
}

class MinHeap {
  private readonly data: HeapNode[] = [];
  get length(): number {
    return this.data.length;
  }
  push(index: number, cost: number): void {
    const node = { index, cost };
    this.data.push(node);
    let i = this.data.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.data[parent].cost <= cost) break;
      this.data[i] = this.data[parent];
      i = parent;
    }
    this.data[i] = node;
  }
  pop(): HeapNode | undefined {
    if (this.data.length === 0) return undefined;
    const root = this.data[0];
    const tail = this.data.pop()!;
    if (this.data.length === 0) return root;
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      if (left >= this.data.length) break;
      const child = right < this.data.length && this.data[right].cost < this.data[left].cost ? right : left;
      if (this.data[child].cost >= tail.cost) break;
      this.data[i] = this.data[child];
      i = child;
    }
    this.data[i] = tail;
    return root;
  }
}
