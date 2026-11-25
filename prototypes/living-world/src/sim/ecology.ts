import type { AgentState } from './types';
import { speciesOf, rtOf, vegIndex, type SimState } from './internal';
import { emit } from './journal';
import { distXZ } from './math';

export const VEG_GRID = 64;

export function initVegetation(state: SimState): void {
  const g = VEG_GRID;
  const n = g * g;
  state.vegetationGridSize = g;
  state.vegetation = new Float32Array(n);
  state.vegCap = new Float32Array(n);
  const size = state.terrain.size;
  const half = state.terrain.half;
  const rng = state.rngEcology;
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const x = ((i + 0.5) / g) * size - half;
      const z = ((j + 0.5) / g) * size - half;
      const cap = state.terrain.forageAt(x, z);
      const idx = j * g + i;
      state.vegCap[idx] = cap;
      state.vegetation[idx] = cap * (0.72 + 0.28 * rng.next());
    }
  }
}

export function updateEcology(state: SimState, gameDt: number): void {
  const hours = gameDt / 3600;
  if (hours <= 0) return;
  const season = state.env.season;
  const boost = season === 'spring' || season === 'summer' ? 1 : season === 'autumn' ? 0.55 : 0.22;
  const regen = 0.05 * boost * hours;
  const veg = state.vegetation;
  const cap = state.vegCap;
  for (let i = 0; i < veg.length; i++) {
    const room = cap[i] - veg[i];
    if (room > 0) veg[i] += room * regen;
    if (veg[i] < 0) veg[i] = 0;
    if (veg[i] > cap[i]) veg[i] = cap[i];
  }
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    if (agent.behavior !== 'graze' && agent.behavior !== 'forage') continue;
    const sp = speciesOf(state, agent);
    if (agent.speed > sp.locomotion.trotSpeed) continue;
    const idx = vegIndex(state, agent.pos.x, agent.pos.z);
    const bite = sp.diet.vegetation * (sp.body.massKg > 400 ? 0.5 : 0.1) * agent.scale * hours;
    veg[idx] = Math.max(0, veg[idx] - bite);
  }
}

/** Hot-spring capacity and dusk returns. Runs after steering so positions are current. */
export function updateSpringsAndHomes(state: SimState): void {
  const buckets = new Map<string, AgentState[]>();
  for (const pool of state.terrain.pools) {
    if (pool.kind === 'hot_spring') buckets.set(pool.id, []);
  }
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const rt = rtOf(state, agent.id);
    if (agent.behavior !== 'bathe' && agent.posture !== 'bathe') {
      rt.inSpringId = null;
      continue;
    }
    let pool: (typeof state.terrain.pools)[number] | null = null;
    let best = Infinity;
    for (const candidate of state.terrain.pools) {
      if (candidate.kind !== 'hot_spring') continue;
      const d = distXZ(agent.pos.x, agent.pos.z, candidate.x, candidate.z);
      if (d < best) {
        best = d;
        pool = candidate;
      }
    }
    if (!pool || best > pool.radius + 0.6) {
      rt.inSpringId = null;
      continue;
    }
    buckets.get(pool.id)?.push(agent);
  }

  for (const pool of state.terrain.pools) {
    if (pool.kind !== 'hot_spring') continue;
    const list = buckets.get(pool.id) ?? [];
    if (list.length > pool.capacity) {
      list.sort((a, b) => {
        const da = speciesOf(state, a).thermal.hotSpringAffinity - speciesOf(state, b).thermal.hotSpringAffinity;
        if (da !== 0) return da;
        return a.id - b.id;
      });
      while (list.length > pool.capacity) {
        const victim = list.shift();
        if (!victim) break;
        const rt = rtOf(state, victim.id);
        rt.inSpringId = null;
        rt.nextDecisionAt = state.physTime + 10;
        rt.nextUrgentAt = state.physTime + 10;
        rt.behaviorUntil = state.physTime + 10;
        victim.behavior = 'wander';
        victim.posture = 'stand';
        const ang = (victim.id % 7) * 0.9;
        victim.intent = {
          behavior: 'wander',
          target: {
            x: pool.x + Math.sin(ang) * (pool.radius + 8),
            z: pool.z + Math.cos(ang) * (pool.radius + 8),
          },
          targetAgent: null,
          place: pool.id,
        };
        emit(state, 'hotspring.displaced', [victim.id], { x: victim.pos.x, z: victim.pos.z }, { pool: pool.id }, 0.55);
      }
    }
    for (const agent of list) {
      const rt = rtOf(state, agent.id);
      if (rt.inSpringId === pool.id) continue;
      rt.inSpringId = pool.id;
      const key = `${agent.id}:${pool.id}`;
      const last = state.springEmitAt.get(key) ?? -1e12;
      if (state.env.time - last < 1800) continue;
      state.springEmitAt.set(key, state.env.time);
      agent.stats.baths += 1;
      emit(state, 'hotspring.entered', [agent.id], { x: agent.pos.x, z: agent.pos.z }, { pool: pool.id, temperature: pool.temperatureC }, 0.6);
    }
  }

  const dusk = state.env.dayPhase === 'dusk' || state.env.dayPhase === 'night';
  for (const agent of state.agents) {
    if (!agent.alive || !agent.homeId) continue;
    const home = state.terrain.getLandmark(agent.homeId);
    if (!home) continue;
    const d = distXZ(agent.pos.x, agent.pos.z, home.x, home.z);
    const rt = rtOf(state, agent.id);
    if (d > home.radius + 4) {
      rt.wasAwayFromHome = true;
      rt.homeReported = false;
    } else if (dusk && rt.wasAwayFromHome && !rt.homeReported && d <= home.radius + 2) {
      rt.homeReported = true;
      emit(state, 'home.returned', [agent.id], { x: agent.pos.x, z: agent.pos.z }, { home: home.id }, 0.4);
    }
  }
}

