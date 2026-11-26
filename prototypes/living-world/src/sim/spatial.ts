import type { AgentState } from './types';
import type { SpatialIndex, SimState } from './internal';
import { speciesOf, rtOf } from './internal';
import { wrapAngle } from './math';
import { emit } from './journal';
import type { Terrain } from './terrain';

const CELL = 16;

/**
 * Uniform grid over the valley. Rebuilt once per step; queries are the only
 * neighbour scans the rest of the sim is allowed to do.
 */
export class SpatialHash implements SpatialIndex {
  private readonly buckets = new Map<number, AgentState[]>();

  rebuild(agents: readonly AgentState[]): void {
    for (const bucket of this.buckets.values()) bucket.length = 0;
    for (const agent of agents) {
      if (!agent.alive) continue;
      const key = this.key(agent.pos.x, agent.pos.z);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(agent);
    }
  }

  query(x: number, z: number, radius: number, out: AgentState[]): AgentState[] {
    out.length = 0;
    const r2 = radius * radius;
    const i0 = Math.floor((x - radius) / CELL);
    const i1 = Math.floor((x + radius) / CELL);
    const j0 = Math.floor((z - radius) / CELL);
    const j1 = Math.floor((z + radius) / CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const bucket = this.buckets.get(i * 73856093 ^ j * 19349663);
        if (!bucket) continue;
        for (const agent of bucket) {
          const dx = agent.pos.x - x;
          const dz = agent.pos.z - z;
          if (dx * dx + dz * dz <= r2) out.push(agent);
        }
      }
    }
    return out;
  }

  private key(x: number, z: number): number {
    const i = Math.floor(x / CELL);
    const j = Math.floor(z / CELL);
    return i * 73856093 ^ j * 19349663;
  }
}

function daylightFactor(state: SimState): number {
  const phase = state.env.dayPhase;
  if (phase === 'day') return 1;
  if (phase === 'dawn' || phase === 'dusk') return 0.55;
  return 0;
}

function weatherSight(state: SimState): number {
  switch (state.env.weather) {
    case 'fog':
      return 0.38;
    case 'rain':
      return 0.62;
    case 'storm':
      return 0.48;
    case 'snow':
      return 0.72;
    default:
      return 1;
  }
}

/**
 * Staggered perception. A cheap threat probe still runs for everyone so a
 * predator at close range is not invisible between full updates.
 */
export function updatePerception(state: SimState, physDt: number): void {
  const now = state.physTime;
  const light = daylightFactor(state);
  const wx = Math.sin(state.env.wind.direction);
  const wz = Math.cos(state.env.wind.direction);
  const scratch = state.nearScratch;

  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const rt = rtOf(state, agent.id);
    const sp = speciesOf(state, agent);

    // Close threat probe every step (small radius, no FOV).
    const probe = Math.min(28, sp.antiPredator.fleeDistance);
    state.spatial.query(agent.pos.x, agent.pos.z, probe, scratch);
    let threat: AgentState | null = null;
    let threatD = Infinity;
    for (const other of scratch) {
      if (other.id === agent.id || !other.alive) continue;
      const pred = speciesOf(state, other).predation;
      if (!pred || !pred.prey.includes(agent.speciesId)) continue;
      const d = Math.hypot(other.pos.x - agent.pos.x, other.pos.z - agent.pos.z);
      if (d < threatD) {
        threatD = d;
        threat = other;
      }
    }
    if (threat && threatD < sp.antiPredator.fleeDistance) {
      const proximity = 1 - threatD / sp.antiPredator.fleeDistance;
      noteThreat(state, agent, threat, 0.2 + 0.55 * proximity);
    }

    if (now + 1e-9 < rt.nextPerceptionAt) continue;
    const pop = state.agents.length;
    const interval = pop > 220 ? 2.4 : pop > 80 ? 1.6 : 1.05;
    rt.nextPerceptionAt = now + interval + (agent.id % 5) * 0.08;

    const nightMix = 1 - light;
    const sight =
      sp.senses.sightRange * (light + nightMix * sp.senses.nightVision) * weatherSight(state);
    const fov = (sp.senses.sightFovDeg * Math.PI) / 180;
    const half = fov * 0.5;
    const full = fov >= Math.PI * 2 - 0.05;
    state.spatial.query(agent.pos.x, agent.pos.z, Math.max(sight, sp.senses.scentRange), scratch);

    const visible: number[] = [];
    for (const other of scratch) {
      if (other.id === agent.id || !other.alive) continue;
      const dx = other.pos.x - agent.pos.x;
      const dz = other.pos.z - agent.pos.z;
      const d = Math.hypot(dx, dz);
      const cover = state.terrain.coverAt(other.pos.x, other.pos.z);
      const sightHere = sight * (1 - cover * 0.62);
      let seen = false;
      if (d <= sightHere && d > 0.001) {
        if (full) seen = true;
        else {
          const ang = Math.atan2(dx, dz);
          let diff = ang - agent.heading;
          diff = wrapAngle(diff);
          if (Math.abs(diff) <= half) seen = true;
        }
      }
      // Hearing ignores FOV, attenuated a little by cover.
      if (!seen && d <= sp.senses.hearingRange * (1 - cover * 0.25)) seen = true;
      // Scent is stronger when the perceiver is downwind of the source.
      if (!seen && d > 0.001) {
        const down = ((agent.pos.x - other.pos.x) * wx + (agent.pos.z - other.pos.z) * wz) / d;
        const scent = sp.senses.scentRange * (down > 0 ? 0.55 + 0.9 * down : 0.28);
        if (d <= scent) seen = true;
      }
      if (!seen) continue;
      visible.push(other.id);
      const pred = speciesOf(state, other).predation;
      if (pred && pred.prey.includes(agent.speciesId)) {
        const proximity = Math.max(0, 1 - d / sp.antiPredator.fleeDistance);
        noteThreat(state, agent, other, 0.18 + 0.5 * proximity);
      }
    }
    visible.sort((a, b) => a - b);
    rt.visible = visible;

    if (state.terrain.forageAt(agent.pos.x, agent.pos.z) > 0.45) {
      agent.memory.food = { x: agent.pos.x, z: agent.pos.z };
    }
    if (agent.needs.thirst > 0.35) {
      const spot = nearestDrink(state, agent.pos.x, agent.pos.z, sp.locomotion.maxSlopeDeg);
      if (shouldRefreshWaterMemory(state.terrain, agent.memory.water, spot, agent.pos.x, agent.pos.z, sp.locomotion.maxSlopeDeg)) {
        agent.memory.water = spot;
      }
    }
  }
  void physDt;
}

function noteThreat(state: SimState, agent: AgentState, threat: AgentState, floor: number): void {
  agent.memory.lastThreatAt = state.env.time;
  agent.memory.lastThreatPos = { x: threat.pos.x, z: threat.pos.z };
  agent.memory.lastThreatId = threat.id;
  if (agent.needs.fear < floor) agent.needs.fear = Math.min(1, floor);
  const sp = speciesOf(state, agent);
  const rt = rtOf(state, agent.id);
  if (!sp.antiPredator.alarmCall || floor < 0.48) return;
  if (state.physTime - rt.lastAlarmAt < 12) return;
  const d = Math.hypot(threat.pos.x - agent.pos.x, threat.pos.z - agent.pos.z);
  if (d > sp.antiPredator.fleeDistance * 1.05) return;
  rt.lastAlarmAt = state.physTime;
  agent.vocalization = { kind: 'alarm', until: state.env.time + state.config.clockScale * 3 };
  emit(state, 'alarm.raised', [agent.id, threat.id], { x: agent.pos.x, z: agent.pos.z }, { threat: threat.speciesId }, 0.65);
  state.spatial.query(agent.pos.x, agent.pos.z, sp.senses.hearingRange, state.nearScratch);
  for (const other of state.nearScratch) {
    if (other.id === agent.id || !other.alive || other.speciesId !== agent.speciesId) continue;
    if (other.needs.fear < 0.48) other.needs.fear = 0.48;
    other.memory.lastThreatAt = state.env.time;
    other.memory.lastThreatPos = { x: threat.pos.x, z: threat.pos.z };
    other.memory.lastThreatId = threat.id;
  }
}

export interface DrinkSpot {
  x: number;
  z: number;
}

/** Closest shore point that this species can safely stand on to drink. */
export function nearestAccessibleDrinkSpot(
  terrain: Terrain,
  spots: readonly DrinkSpot[],
  x: number,
  z: number,
  maxSlopeDeg: number,
): DrinkSpot | null {
  let best: DrinkSpot | null = null;
  let bestD2 = Infinity;
  for (const spot of spots) {
    if (!terrain.inBounds(spot.x, spot.z, 14) || !terrain.isWalkable(spot.x, spot.z, maxSlopeDeg, 0.35)) continue;
    const dx = spot.x - x;
    const dz = spot.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = spot;
    }
  }
  return best;
}

/** A stale water memory is replaced when it is unsafe or a meaningfully closer shore is known. */
export function shouldRefreshWaterMemory(
  terrain: Terrain,
  current: DrinkSpot | null,
  candidate: DrinkSpot | null,
  x: number,
  z: number,
  maxSlopeDeg: number,
  improvementMeters = 8,
): boolean {
  if (!candidate) return false;
  if (!current || !terrain.inBounds(current.x, current.z, 14) || !terrain.isWalkable(current.x, current.z, maxSlopeDeg, 0.35)) return true;
  const currentDistance = Math.hypot(current.x - x, current.z - z);
  const candidateDistance = Math.hypot(candidate.x - x, candidate.z - z);
  return candidateDistance + Math.max(0, improvementMeters) < currentDistance;
}

export function nearestDrink(
  state: SimState,
  x: number,
  z: number,
  maxSlopeDeg = 45,
): DrinkSpot | null {
  return nearestAccessibleDrinkSpot(state.terrain, state.drinkSpots, x, z, maxSlopeDeg);
}

/** Generate drinkable banks close enough for a creature's head / body reach. */
export function generateDrinkSpots(terrain: Terrain): DrinkSpot[] {
  const spots: DrinkSpot[] = [];
  const add = (point: DrinkSpot) => {
    if (!terrain.inBounds(point.x, point.z, 14)) return;
    // Keep feet on a shallow, stable bank. Species-specific slope limits are
    // applied again when a particular individual selects a point.
    if (!terrain.isWalkable(point.x, point.z, 50, 0.35)) return;
    spots.push(point);
  };

  let lastX = Infinity;
  let lastZ = Infinity;
  for (const sample of terrain.riverSamples) {
    // Sample more densely around bends and valley pinch points. Multiple
    // nearby banks let different body sizes / slope envelopes choose the
    // reachable side without forcing every animal to the same crossing.
    if (Math.hypot(sample.x - lastX, sample.z - lastZ) < 8) continue;
    const nearOffset = sample.halfWidth + 0.55;
    const outerOffset = sample.halfWidth + 1.2;
    const oxNear = Math.cos(sample.flowDir) * nearOffset;
    const ozNear = -Math.sin(sample.flowDir) * nearOffset;
    const oxOuter = Math.cos(sample.flowDir) * outerOffset;
    const ozOuter = -Math.sin(sample.flowDir) * outerOffset;
    add({ x: sample.x + oxNear, z: sample.z + ozNear });
    add({ x: sample.x - oxNear, z: sample.z - ozNear });
    add({ x: sample.x + oxOuter, z: sample.z + ozOuter });
    add({ x: sample.x - oxOuter, z: sample.z - ozOuter });
    lastX = sample.x;
    lastZ = sample.z;
  }

  for (const pool of terrain.pools) {
    // Raw geothermal sources above 36°C are not generic drinking pools.
    if (pool.kind === 'hot_spring' && pool.temperatureC > 36) continue;
    const n = 8;
    for (let k = 0; k < n; k++) {
      const angle = (k / n) * Math.PI * 2;
      add({
        x: pool.x + Math.cos(angle) * (pool.radius + 0.5),
        z: pool.z + Math.sin(angle) * (pool.radius + 0.5),
      });
    }
  }
  return spots;
}

export function buildDrinkSpots(state: SimState): void {
  state.drinkSpots = generateDrinkSpots(state.terrain);
}

export function buildPlaces(state: SimState): void {
  const places = [];
  for (const lm of state.terrain.landmarks.values()) {
    places.push({ id: lm.id, x: lm.x, z: lm.z, radius: lm.radius });
  }
  for (const pool of state.terrain.pools) {
    places.push({ id: pool.id, x: pool.x, z: pool.z, radius: pool.radius });
  }
  state.places = places;
  const spring = state.terrain.pools.find((p) => p.kind === 'hot_spring') ?? null;
  state.anchor = spring ? { x: spring.x, z: spring.z } : null;
}
