import type { RegionLayout, SpeciesProfile } from '../data/schema';
import type { RngState } from './rng';
import { Rng } from './rng';
import type { Terrain } from './terrain';
import type { AgentState, Relationship, SimConfig, WorldSnapshot } from './types';
import { checksumOf } from './journal';
import { terrainFor } from './population';
import { SpatialHash, buildDrinkSpots, buildPlaces } from './spatial';
import type { AgentRuntime, HuntState, SimState } from './internal';

export const SNAPSHOT_SCHEMA_VERSION = 1;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** v1 snapshots are already in the current shape. */
export function migrateSnapshot(raw: unknown): WorldSnapshot {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SnapshotError('snapshot must be an object');
  }
  const snap = raw as WorldSnapshot;
  if (snap.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotError(`unsupported snapshot schema version: ${String(snap.schemaVersion)}`);
  }
  if (typeof snap.regionId !== 'string' || snap.config == null || typeof snap.config !== 'object') {
    throw new SnapshotError('snapshot is missing regionId or config');
  }
  return snap;
}

export function captureSnapshot(state: SimState, savedAtWallClockMs = 0): WorldSnapshot {
  const body = serialize(state);
  const checksum = checksumOf(body);
  return { ...body, checksum, savedAtWallClockMs } as unknown as WorldSnapshot;
}

export function restoreWorld(
  raw: unknown,
  data: { region: RegionLayout; species: SpeciesProfile[] },
  onProgress?: (fraction: number, label: string) => void,
): SimState {
  const snap = migrateSnapshot(raw);
  if (snap.regionId !== data.region.id) {
    throw new SnapshotError(`snapshot region ${String(snap.regionId)} does not match ${data.region.id}`);
  }
  const record = snap as Record<string, unknown>;
  const checksum = record.checksum;
  const savedAt = record.savedAtWallClockMs;
  if (typeof checksum !== 'number' || !Number.isFinite(checksum)) throw new SnapshotError('snapshot checksum missing');
  const { checksum: _c, savedAtWallClockMs: _s, ...rest } = record;
  void _c;
  void _s;
  void savedAt;
  if (checksumOf(rest) !== checksum) throw new SnapshotError('snapshot checksum mismatch');
  const config = rest.config as SimConfig;
  if (!config || typeof config.seed !== 'number' || typeof config.fixedDt !== 'number') {
    throw new SnapshotError('snapshot config is invalid');
  }
  const agents = rest.agents;
  if (!Array.isArray(agents)) throw new SnapshotError('snapshot agents are invalid');
  onProgress?.(0.1, 'terrain');
  const terrain = terrainFor(data.region, config.seed, (fraction, label) => onProgress?.(0.1 + fraction * 0.6, label));
  const species = new Map(data.species.map((s) => [s.id, s]));
  for (const agent of agents as AgentState[]) {
    if (!agent || typeof agent.id !== 'number' || typeof agent.speciesId !== 'string') throw new SnapshotError('snapshot agent is invalid');
    if (!species.has(agent.speciesId)) throw new SnapshotError(`snapshot agent has unknown species ${agent.speciesId}`);
    if (!Number.isFinite(agent.pos?.x) || !Number.isFinite(agent.pos?.y) || !Number.isFinite(agent.pos?.z)) {
      throw new SnapshotError(`snapshot agent ${agent.id} has a non-finite position`);
    }
  }
  const state = rehydrate(rest, config, data.region, species, terrain);
  onProgress?.(1, 'restored');
  return state;
}

function serialize(state: SimState): Record<string, unknown> {
  const relationships: Array<{ a: number; b: number } & Relationship> = [];
  const aids = [...state.relationships.keys()].sort((a, b) => a - b);
  for (const a of aids) {
    const row = state.relationships.get(a)!;
    const bids = [...row.keys()].sort((x, y) => x - y);
    for (const b of bids) relationships.push({ a, b, ...row.get(b)! });
  }
  const runtimes = [...state.runtime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, rt]) => ({ id, ...runtimePlain(rt) }));
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    config: clone(state.config),
    regionId: state.region.id,
    tick: state.tick,
    physTime: state.physTime,
    accumulator: state.accumulator,
    env: clone(state.env),
    agents: clone(state.agents),
    carcasses: clone(state.carcasses),
    interactions: clone(state.interactions),
    relationships,
    events: clone(state.events.slice(-500)),
    vegetation: Array.from(state.vegetation),
    vegetationGridSize: state.vegetationGridSize,
    vegCap: Array.from(state.vegCap),
    runtimes,
    hunts: clone(state.hunts),
    overrides: clone(state.overrides),
    naturalWeather: state.naturalWeather,
    naturalSeason: state.naturalSeason,
    weatherUntil: state.weatherUntil,
    prevDay: state.prevDay,
    prevPhase: state.prevPhase,
    prevSeason: state.prevSeason,
    prevWeather: state.prevWeather,
    huntDay: state.huntDay,
    huntsToday: state.huntsToday,
    nextAgentId: state.nextAgentId,
    nextInteractionId: state.nextInteractionId,
    nextCarcassId: state.nextCarcassId,
    nextEventSeq: state.nextEventSeq,
    births: state.births,
    deaths: state.deaths,
    approximate: state.approximate,
    springEmitAt: [...state.springEmitAt.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    rngWeather: state.rngWeather.getState(),
    rngEcology: state.rngEcology.getState(),
    rngLife: state.rngLife.getState(),
    rngHunt: state.rngHunt.getState(),
  };
}

function runtimePlain(rt: AgentRuntime): Record<string, unknown> {
  return {
    rng: rt.rng.getState(),
    nextDecisionAt: rt.nextDecisionAt,
    nextPerceptionAt: rt.nextPerceptionAt,
    behaviorUntil: rt.behaviorUntil,
    wetness: rt.wetness,
    altitude: rt.altitude,
    homeReported: rt.homeReported,
    wasAwayFromHome: rt.wasAwayFromHome,
    inSpringId: rt.inSpringId,
    huntCooldownUntil: rt.huntCooldownUntil,
    lock: rt.lock,
    feedUntil: rt.feedUntil,
    lastAlarmAt: rt.lastAlarmAt,
    scavenged: rt.scavenged.slice(),
    stuck: rt.stuck,
    nextUrgentAt: rt.nextUrgentAt,
    circle: rt.circle,
    soarAnnounced: rt.soarAnnounced,
    visible: rt.visible.slice(),
  };
}

function rehydrate(
  rest: Record<string, unknown>,
  config: SimConfig,
  region: RegionLayout,
  species: Map<string, SpeciesProfile>,
  terrain: Terrain,
): SimState {
  const agents = clone(rest.agents) as AgentState[];
  const state: SimState = {
    config: clone(config),
    tick: num(rest.tick, 'tick'),
    physTime: num(rest.physTime, 'physTime'),
    accumulator: num(rest.accumulator, 'accumulator'),
    env: clone(rest.env) as SimState['env'],
    agents,
    agentById: new Map(agents.map((a) => [a.id, a])),
    carcasses: clone(rest.carcasses ?? []) as SimState['carcasses'],
    interactions: clone(rest.interactions ?? []) as SimState['interactions'],
    terrain,
    region,
    species,
    vegetation: floats(rest.vegetation, 'vegetation'),
    vegetationGridSize: num(rest.vegetationGridSize, 'vegetationGridSize'),
    vegCap: floats(rest.vegCap, 'vegCap'),
    relationships: new Map(),
    events: clone(rest.events ?? []) as SimState['events'],
    listeners: [],
    runtime: new Map(),
    spatial: new SpatialHash(),
    hunts: clone(rest.hunts ?? []) as HuntState[],
    overrides: clone(rest.overrides) as SimState['overrides'],
    naturalWeather: rest.naturalWeather as SimState['naturalWeather'],
    naturalSeason: rest.naturalSeason as SimState['naturalSeason'],
    weatherUntil: num(rest.weatherUntil, 'weatherUntil'),
    prevDay: num(rest.prevDay, 'prevDay'),
    prevPhase: rest.prevPhase as SimState['prevPhase'],
    prevSeason: rest.prevSeason as SimState['prevSeason'],
    prevWeather: rest.prevWeather as SimState['prevWeather'],
    huntDay: num(rest.huntDay, 'huntDay'),
    huntsToday: num(rest.huntsToday, 'huntsToday'),
    nextAgentId: num(rest.nextAgentId, 'nextAgentId'),
    nextInteractionId: num(rest.nextInteractionId, 'nextInteractionId'),
    nextCarcassId: num(rest.nextCarcassId, 'nextCarcassId'),
    nextEventSeq: num(rest.nextEventSeq, 'nextEventSeq'),
    births: num(rest.births, 'births'),
    deaths: num(rest.deaths, 'deaths'),
    approximate: Boolean(rest.approximate),
    drinkSpots: [],
    places: [],
    springEmitAt: new Map(),
    counts: new Map(),
    centroids: new Map(),
    nearScratch: [],
    rngWeather: new Rng(rest.rngWeather as RngState),
    rngEcology: new Rng(rest.rngEcology as RngState),
    rngLife: new Rng(rest.rngLife as RngState),
    rngHunt: new Rng(rest.rngHunt as RngState),
    anchor: null,
  };
  if (state.vegetation.length !== state.vegetationGridSize * state.vegetationGridSize) {
    throw new SnapshotError('snapshot vegetation has the wrong length');
  }
  const rels = rest.relationships;
  if (!Array.isArray(rels)) throw new SnapshotError('snapshot relationships are invalid');
  for (const rel of rels as Array<{ a: number; b: number } & Relationship>) {
    let row = state.relationships.get(rel.a);
    if (!row) {
      row = new Map();
      state.relationships.set(rel.a, row);
    }
    const { a: _a, b: _b, ...body } = rel;
    void _a;
    void _b;
    row.set(rel.b, body);
  }
  const runtimes = rest.runtimes;
  if (!Array.isArray(runtimes)) throw new SnapshotError('snapshot runtimes are invalid');
  for (const raw of runtimes as Array<Record<string, unknown> & { id: number }>) {
    if (!state.agentById.has(raw.id)) throw new SnapshotError(`runtime for unknown agent ${String(raw.id)}`);
    state.runtime.set(raw.id, {
      rng: new Rng(raw.rng as RngState),
      nextDecisionAt: num(raw.nextDecisionAt, 'nextDecisionAt'),
      nextPerceptionAt: num(raw.nextPerceptionAt, 'nextPerceptionAt'),
      behaviorUntil: num(raw.behaviorUntil, 'behaviorUntil'),
      wetness: num(raw.wetness, 'wetness'),
      altitude: num(raw.altitude, 'altitude'),
      homeReported: Boolean(raw.homeReported),
      wasAwayFromHome: Boolean(raw.wasAwayFromHome),
      inSpringId: (raw.inSpringId as string | null) ?? null,
      huntCooldownUntil: num(raw.huntCooldownUntil, 'huntCooldownUntil'),
      lock: (raw.lock as AgentRuntime['lock']) ?? 'none',
      feedUntil: num(raw.feedUntil, 'feedUntil'),
      lastAlarmAt: num(raw.lastAlarmAt, 'lastAlarmAt'),
      scavenged: Array.isArray(raw.scavenged) ? (raw.scavenged as number[]).slice() : [],
      stuck: num(raw.stuck, 'stuck'),
      nextUrgentAt: num(raw.nextUrgentAt, 'nextUrgentAt'),
      circle: num(raw.circle, 'circle'),
      soarAnnounced: Boolean(raw.soarAnnounced),
      visible: Array.isArray(raw.visible) ? (raw.visible as number[]).slice() : [],
    });
  }
  for (const agent of agents) {
    if (!state.runtime.has(agent.id)) throw new SnapshotError(`snapshot missing runtime for agent ${agent.id}`);
    if (agent.alive) state.counts.set(agent.speciesId, (state.counts.get(agent.speciesId) ?? 0) + 1);
  }
  const springs = rest.springEmitAt;
  if (Array.isArray(springs)) {
    for (const pair of springs as Array<[string, number]>) state.springEmitAt.set(pair[0], pair[1]);
  }
  buildDrinkSpots(state);
  buildPlaces(state);
  state.spatial.rebuild(state.agents);
  return state;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new SnapshotError(`snapshot field ${label} is not a finite number`);
  return value;
}

function floats(value: unknown, label: string): Float32Array {
  if (!Array.isArray(value)) throw new SnapshotError(`snapshot field ${label} is not an array`);
  return Float32Array.from(value as number[]);
}
