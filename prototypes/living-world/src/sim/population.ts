import type { RegionLayout, SpeciesProfile } from '../data/schema';
import type { LandmarkKind, Sex } from './ids';
import { Rng } from './rng';
import { Terrain } from './terrain';
import type { AgentState, Needs, SimConfig } from './types';
import { evaluateAgent } from './ai';
import { initEnvironment } from './environment';
import { initVegetation } from './ecology';
import { emit } from './journal';
import { ensureRel, type AgentRuntime, type SimState } from './internal';
import { SpatialHash, buildDrinkSpots, buildPlaces } from './spatial';

const terrainCache = new Map<string, Terrain>();

/** Terrain is pure in (region, seed) and expensive; sims that share both share the mesh. */
export function terrainFor(region: RegionLayout, seed: number, onProgress?: (fraction: number, label: string) => void): Terrain {
  const key = `${region.id}|${seed}|${region.size}|${region.resolution}`;
  const hit = terrainCache.get(key);
  if (hit) {
    onProgress?.(1, 'terrain ready');
    return hit;
  }
  const built = Terrain.build(region, seed, (fraction, stage) => onProgress?.(fraction, stage));
  terrainCache.set(key, built);
  return built;
}

export function createWorld(
  data: { region: RegionLayout; species: SpeciesProfile[] },
  config: SimConfig,
  onProgress?: (fraction: number, label: string) => void,
): SimState {
  const terrain = terrainFor(data.region, config.seed, (fraction, label) => onProgress?.(fraction * 0.75, label));
  onProgress?.(0.8, 'population');
  const species = new Map(data.species.map((s) => [s.id, s]));
  const state = blankState(config, data.region, species, terrain);
  initEnvironment(state);
  initVegetation(state);
  buildDrinkSpots(state);
  buildPlaces(state);
  spawnFounders(state);
  state.spatial.rebuild(state.agents);
  for (const agent of state.agents) evaluateAgent(state, agent, 'scheduled');
  emit(
    state,
    'system.world_created',
    [],
    state.anchor,
    {
      seed: config.seed,
      agents: state.agents.length,
      season: state.env.season,
      weather: state.env.weather,
      day: state.env.day,
    },
    1,
  );
  onProgress?.(1, 'ready');
  return state;
}

function blankState(config: SimConfig, region: RegionLayout, species: Map<string, SpeciesProfile>, terrain: Terrain): SimState {
  return {
    config,
    tick: 0,
    physTime: 0,
    accumulator: 0,
    env: {
      time: 0,
      day: 1,
      timeOfDay: config.startHour,
      dayPhase: 'dawn',
      season: config.startSeason,
      seasonProgress: 0,
      year: 1,
      weather: 'clear',
      weatherIntensity: 0.6,
      temperatureC: 10,
      wind: { direction: region.wind.direction, speed: region.wind.speed },
      sun: { direction: { x: 0, y: 1, z: 0 }, elevation: 0 },
      moon: { direction: { x: 0, y: -1, z: 0 }, phase: 0 },
    },
    agents: [],
    agentById: new Map(),
    carcasses: [],
    interactions: [],
    terrain,
    region,
    species,
    vegetation: new Float32Array(0),
    vegetationGridSize: 64,
    vegCap: new Float32Array(0),
    relationships: new Map(),
    events: [],
    listeners: [],
    runtime: new Map(),
    spatial: new SpatialHash(),
    hunts: [],
    overrides: { season: null, weather: null },
    naturalWeather: 'clear',
    naturalSeason: config.startSeason,
    weatherUntil: 0,
    prevDay: 1,
    prevPhase: 'dawn',
    prevSeason: config.startSeason,
    prevWeather: 'clear',
    huntDay: 1,
    huntsToday: 0,
    nextAgentId: 1,
    nextInteractionId: 1,
    nextCarcassId: 1,
    nextEventSeq: 1,
    births: 0,
    deaths: 0,
    approximate: false,
    drinkSpots: [],
    places: [],
    springEmitAt: new Map(),
    counts: new Map(),
    centroids: new Map(),
    nearScratch: [],
    rngWeather: Rng.stream(config.seed, 'weather'),
    rngEcology: Rng.stream(config.seed, 'ecology'),
    rngLife: Rng.stream(config.seed, 'life'),
    rngHunt: Rng.stream(config.seed, 'hunt'),
    anchor: null,
  };
}

function spawnFounders(state: SimState): void {
  const rng = Rng.stream(state.config.seed, 'spawn');
  let groupSerial = 1;
  for (const spawn of state.region.spawns) {
    const sp = state.species.get(spawn.speciesId);
    if (!sp) continue;
    const anchor = resolveAnchor(state.region, spawn.near);
    const sizes = splitCount(spawn.count, spawn.groups);
    if (sp.social.model === 'solitary_territorial') {
      const pair = placeOpposite(state, anchor, spawn.spread, sp.locomotion.maxSlopeDeg, rng);
      const leaders: AgentState[] = [];
      sizes.forEach((n, g) => {
        const center = pair[g % pair.length];
        const groupId = groupSerial++;
        const members: AgentState[] = [];
        const plan = planGroup(n, rng);
        for (let i = 0; i < n; i++) {
          const pos = i === 0 ? center : findStand(state, center.x, center.z, Math.max(6, spawn.spread * 0.35), sp.locomotion.maxSlopeDeg, rng);
          const agent = makeAgent(state, sp, rng, pos, groupId, plan[i].juvenile, plan[i].sex);
          agent.territory = { x: pos.x, z: pos.z, radius: sp.social.territoryRadius };
          members.push(agent);
        }
        finishGroup(state, members, rng, anchor);
        if (members[0]) leaders.push(members[0]);
      });
      if (leaders.length >= 2) {
        const a = leaders[0];
        const b = leaders[1];
        const ab = ensureRel(state, a.id, b.id);
        const ba = ensureRel(state, b.id, a.id);
        ab.familiarity = ba.familiarity = 0.16;
        ab.trust = ba.trust = 0.12;
        ab.rivalry = ba.rivalry = 0.62;
        ab.dominance = 0.15;
        ba.dominance = -0.15;
      }
      continue;
    }
    sizes.forEach((n, g) => {
      const ang = g * 2.2;
      const ax = anchor.x + Math.sin(ang) * spawn.spread * 0.28;
      const az = anchor.z + Math.cos(ang) * spawn.spread * 0.28;
      const groupId = groupSerial++;
      const members: AgentState[] = [];
      const plan = planGroup(n, rng);
      for (let i = 0; i < n; i++) {
        const pos = findStand(state, ax, az, spawn.spread * (spawn.groups > 1 ? 0.72 : 1), sp.locomotion.maxSlopeDeg, rng);
        members.push(makeAgent(state, sp, rng, pos, groupId, plan[i].juvenile, plan[i].sex));
      }
      finishGroup(state, members, rng, anchor);
    });
  }
  impregnate(state, rng);
}

function finishGroup(state: SimState, members: AgentState[], rng: Rng, anchor: { x: number; z: number }): void {
  if (members.length === 0) return;
  const sp = state.species.get(members[0].speciesId)!;
  const kind = homeKind(sp);
  const home = kind ? nearestLandmark(state, kind, anchor.x, anchor.z) : null;
  for (const agent of members) agent.homeId = home?.id ?? null;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const fam = 0.55 + rng.next() * 0.4;
      const ab = ensureRel(state, members[i].id, members[j].id);
      const ba = ensureRel(state, members[j].id, members[i].id);
      ab.familiarity = ba.familiarity = fam;
      ab.trust = ba.trust = 0.48;
      ab.affection = ba.affection = 0.34;
      ab.dominance = 0.06;
      ba.dominance = -0.06;
    }
  }
  const juveniles = members.filter((m) => m.lifeStage === 'juvenile');
  const mothers = members.filter((m) => m.lifeStage !== 'juvenile' && m.sex === 'female');
  juveniles.forEach((child, index) => {
    const mother = mothers[index % mothers.length];
    if (!mother) return;
    child.motherId = mother.id;
    const ab = ensureRel(state, mother.id, child.id);
    const ba = ensureRel(state, child.id, mother.id);
    ab.kin = 'offspring';
    ba.kin = 'parent';
    ab.familiarity = ba.familiarity = 1;
    ab.affection = ba.affection = 0.9;
    ab.trust = ba.trust = 0.86;
  });
}

function impregnate(state: SimState, rng: Rng): void {
  const seen = new Set<string>();
  const picks: AgentState[] = [];
  for (const agent of state.agents) {
    if (agent.sex !== 'female' || agent.lifeStage !== 'adult') continue;
    const sp = state.species.get(agent.speciesId);
    if (!sp || !sp.lifeCycle.breedingSeasons.includes(state.config.startSeason)) continue;
    if (seen.has(agent.speciesId)) continue;
    seen.add(agent.speciesId);
    picks.push(agent);
    if (picks.length >= 2) break;
  }
  for (const female of picks) {
    const sp = state.species.get(female.speciesId)!;
    const mate = state.agents.find(
      (m) => m.speciesId === female.speciesId && m.sex === 'male' && m.groupId === female.groupId && m.lifeStage !== 'juvenile',
    );
    const frac = 0.5 + rng.next() * 0.35;
    female.pregnancy = { mateId: mate?.id ?? female.id, dueAt: sp.lifeCycle.gestationDays * 86400 * frac };
    if (!mate) continue;
    female.mateId = mate.id;
    mate.mateId = female.id;
    const ab = ensureRel(state, female.id, mate.id);
    const ba = ensureRel(state, mate.id, female.id);
    if (ab.kin === 'none') ab.kin = 'mate';
    if (ba.kin === 'none') ba.kin = 'mate';
    ab.familiarity = Math.max(ab.familiarity, 0.82);
    ba.familiarity = Math.max(ba.familiarity, 0.82);
    ab.affection = Math.max(ab.affection, 0.6);
    ba.affection = Math.max(ba.affection, 0.6);
  }
}

function planGroup(total: number, rng: Rng): Array<{ juvenile: boolean; sex: Sex }> {
  const juvs = juvenileCount(total);
  const plan = Array.from({ length: total }, (_, i) => ({
    juvenile: i >= total - juvs,
    sex: (rng.chance(0.5) ? 'female' : 'male') as Sex,
  }));
  const adults = plan.filter((p) => !p.juvenile);
  if (plan.some((p) => p.juvenile) && adults.length > 0 && !adults.some((p) => p.sex === 'female')) adults[0].sex = 'female';
  return plan;
}

function makeAgent(
  state: SimState,
  sp: SpeciesProfile,
  rng: Rng,
  pos: { x: number; z: number },
  groupId: number,
  juvenile: boolean,
  sex: Sex,
): AgentState {
  const id = state.nextAgentId++;
  const life = sp.lifeCycle;
  const ageDays = juvenile
    ? life.maturityDays * (0.28 + rng.next() * 0.42)
    : life.maturityDays + (life.elderDays - life.maturityDays) * (0.18 + rng.next() * 0.45);
  const scale = juvenile ? life.juvenileScale + (1 - life.juvenileScale) * (ageDays / life.maturityDays) : 1;
  const y = state.terrain.heightAt(pos.x, pos.z);
  const heading = rng.next() * Math.PI * 2;
  const inSeason = life.breedingSeasons.includes(state.config.startSeason);
  const needs: Needs = {
    hunger: 0.16 + rng.next() * 0.2,
    thirst: 0.12 + rng.next() * 0.18,
    fatigue: 0.05 + rng.next() * 0.12,
    cold: 0.04,
    heat: 0,
    social: 0.18 + rng.next() * 0.22,
    fear: 0,
    curiosity: 0.15 + rng.next() * 0.25,
    stamina: 0.75 + rng.next() * 0.25,
    health: 0.92 + rng.next() * 0.08,
    breeding: !juvenile && inSeason ? 0.12 + rng.next() * 0.22 : 0,
  };
  const drink = state.drinkSpots.length ? nearestSpot(state.drinkSpots, pos.x, pos.z) : null;
  const agent: AgentState = {
    id,
    speciesId: sp.id,
    sex,
    bornAt: -ageDays * 86400,
    lifeStage: juvenile ? 'juvenile' : 'adult',
    alive: true,
    diedAt: null,
    causeOfDeath: null,
    pos: { x: pos.x, y, z: pos.z },
    prevPos: { x: pos.x, y, z: pos.z },
    heading,
    prevHeading: heading,
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    posture: 'stand',
    flightMode: null,
    bank: 0,
    scale,
    needs,
    behavior: 'idle',
    behaviorStartedAt: 0,
    intent: { behavior: 'idle', target: null, targetAgent: null, place: null },
    decision: null,
    interaction: null,
    groupId,
    homeId: null,
    motherId: null,
    fatherId: null,
    mateId: null,
    territory: null,
    pregnancy: null,
    memory: {
      lastThreatAt: null,
      lastThreatPos: null,
      lastThreatId: null,
      food: state.terrain.forageAt(pos.x, pos.z) > 0.35 ? { x: pos.x, z: pos.z } : null,
      water: drink,
    },
    lookAt: null,
    vocalization: null,
    stats: { meals: 0, huntsAttempted: 0, huntsSucceeded: 0, interactions: 0, offspring: 0, distance: 0, baths: 0 },
  };
  const runtime: AgentRuntime = {
    rng: Rng.stream(state.config.seed, 'agent', id),
    nextDecisionAt: 0,
    nextPerceptionAt: (id % 8) * 0.12,
    behaviorUntil: 4,
    wetness: 0,
    altitude: 0,
    homeReported: false,
    wasAwayFromHome: false,
    inSpringId: null,
    huntCooldownUntil: 0,
    lock: 'none',
    feedUntil: 0,
    lastAlarmAt: -100,
    scavenged: [],
    stuck: 0,
    nextUrgentAt: 0,
    circle: id * 0.37,
    soarAnnounced: false,
    visible: [],
  };
  state.agents.push(agent);
  state.agentById.set(id, agent);
  state.runtime.set(id, runtime);
  state.counts.set(sp.id, (state.counts.get(sp.id) ?? 0) + 1);
  return agent;
}

function homeKind(sp: SpeciesProfile): LandmarkKind | null {
  if (sp.locomotion.flight) return 'roost';
  switch (sp.social.model) {
    case 'family':
      return 'den';
    case 'solitary_territorial':
      return 'lookout';
    case 'herd':
      return 'salt_lick';
    default:
      return null;
  }
}

function nearestLandmark(state: SimState, kind: LandmarkKind, x: number, z: number) {
  let best: ReturnType<Terrain['getLandmark']> | null = null;
  let bestD = Infinity;
  for (const lm of state.terrain.landmarks.values()) {
    if (lm.kind !== kind) continue;
    const d = (lm.x - x) ** 2 + (lm.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = lm;
    }
  }
  return best;
}

function resolveAnchor(region: RegionLayout, near: string): { x: number; z: number } {
  const zone = region.zones.find((z) => z.id === near);
  if (zone) return { x: zone.center[0], z: zone.center[1] };
  const landmark = region.landmarks.find((l) => l.id === near);
  if (landmark) return { x: landmark.center[0], z: landmark.center[1] };
  const pool = region.pools.find((p) => p.id === near);
  if (pool) return { x: pool.center[0], z: pool.center[1] };
  return { x: 0, z: 0 };
}

function splitCount(count: number, groups: number): number[] {
  const g = Math.max(1, Math.min(groups, count));
  const base = Math.floor(count / g);
  let rem = count % g;
  const out: number[] = [];
  for (let i = 0; i < g; i++) {
    const n = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    if (n > 0) out.push(n);
  }
  return out;
}

function juvenileCount(total: number): number {
  if (total < 4) return 0;
  const n = total < 6 ? 1 : Math.max(1, Math.round(total * 0.22));
  return Math.min(n, total - 2);
}

function findStand(state: SimState, x: number, z: number, spread: number, slope: number, rng: Rng): { x: number; z: number } {
  const terrain = state.terrain;
  for (let k = 0; k < 26; k++) {
    const ang = rng.next() * Math.PI * 2;
    const rad = spread * Math.sqrt(rng.next());
    const px = x + Math.sin(ang) * rad;
    const pz = z + Math.cos(ang) * rad;
    if (terrain.isWalkable(px, pz, slope, 0.45)) return { x: px, z: pz };
  }
  for (let r = 2; r < spread + 46; r += 3) {
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2 + r * 0.17;
      const px = x + Math.sin(ang) * r;
      const pz = z + Math.cos(ang) * r;
      if (terrain.isWalkable(px, pz, slope, 0.45)) return { x: px, z: pz };
    }
  }
  return terrain.clampToBounds(x, z, 4);
}

function placeOpposite(
  state: SimState,
  anchor: { x: number; z: number },
  spread: number,
  slope: number,
  rng: Rng,
): Array<{ x: number; z: number }> {
  let bestA = anchor;
  let bestB = anchor;
  let bestD = -1;
  for (let k = 0; k < 36; k++) {
    const ang = rng.next() * Math.PI * 2;
    const rad = spread * (0.62 + 0.38 * rng.next());
    const a = { x: anchor.x + Math.sin(ang) * rad, z: anchor.z + Math.cos(ang) * rad };
    const b = { x: anchor.x - Math.sin(ang) * rad, z: anchor.z - Math.cos(ang) * rad };
    if (!state.terrain.isWalkable(a.x, a.z, slope, 0.45) || !state.terrain.isWalkable(b.x, b.z, slope, 0.45)) continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d > bestD) {
      bestD = d;
      bestA = a;
      bestB = b;
    }
  }
  if (bestD < 0) return [findStand(state, anchor.x, anchor.z, spread, slope, rng), findStand(state, anchor.x, anchor.z, spread, slope, rng)];
  return [bestA, bestB];
}

function nearestSpot(spots: Array<{ x: number; z: number }>, x: number, z: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (const spot of spots) {
    const d = (spot.x - x) ** 2 + (spot.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = spot;
    }
  }
  return best;
}
