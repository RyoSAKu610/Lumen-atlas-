/**
 * Mutable simulation state shared by subsystems. Not part of the public API.
 * Subsystems import this type only; the orchestrator in `step.ts` calls them in order.
 */
import type { RegionLayout, SpeciesProfile } from '../data/schema';
import type { DayPhase, Season, Weather } from './ids';
import type { Rng } from './rng';
import type { Terrain } from './terrain';
import type {
  AgentId,
  AgentState,
  Carcass,
  EnvironmentState,
  InteractionState,
  Relationship,
  SimConfig,
  SimEvent,
} from './types';

export interface AgentRuntime {
  rng: Rng;
  /** Physical time when utility AI may re-evaluate. */
  nextDecisionAt: number;
  nextPerceptionAt: number;
  /** Physical time when the current behaviour is allowed to complete. */
  behaviorUntil: number;
  /** 0..1, raises cold loss. */
  wetness: number;
  /** Metres above the ground for flyers. */
  altitude: number;
  homeReported: boolean;
  wasAwayFromHome: boolean;
  inSpringId: string | null;
  /** Game time before this predator may start another hunt. */
  huntCooldownUntil: number;
  lock: 'none' | 'hunt' | 'feed';
  feedUntil: number;
  /** Physical time of the last alarm this agent raised. */
  lastAlarmAt: number;
  scavenged: number[];
  /** Physical seconds spent unable to make progress. */
  stuck: number;
  /** Derived, transient route to a safe drink bank; rebuilt after restore if needed. */
  waterPath?: Array<{ x: number; z: number }>;
  waterPathIndex?: number;
  /** Physical time before another urgent re-evaluation. */
  nextUrgentAt: number;
  /** Orbit phase for soaring (rad). */
  circle: number;
  /** True after flight.soaring has been emitted for the current flight. */
  soarAnnounced: boolean;
  /** Last perception result (agent ids), sorted. */
  visible: number[];
}

export interface HuntState {
  predatorId: number;
  preyId: number;
  phase: 'stalk' | 'chase';
  startedPhys: number;
  chaseStartPhys: number;
  lastStrikePhys: number;
  misses: number;
}

export interface PlaceRef {
  id: string;
  x: number;
  z: number;
  radius: number;
}

/** Narrow spatial index so this module does not import the hash implementation. */
export interface SpatialIndex {
  rebuild(agents: readonly AgentState[]): void;
  query(x: number, z: number, radius: number, out: AgentState[]): AgentState[];
}

export interface SimState {
  config: SimConfig;
  tick: number;
  physTime: number;
  accumulator: number;
  env: EnvironmentState;
  agents: AgentState[];
  agentById: Map<AgentId, AgentState>;
  carcasses: Carcass[];
  interactions: InteractionState[];
  terrain: Terrain;
  region: RegionLayout;
  species: Map<string, SpeciesProfile>;
  vegetation: Float32Array;
  vegetationGridSize: number;
  vegCap: Float32Array;
  relationships: Map<AgentId, Map<AgentId, Relationship>>;
  events: SimEvent[];
  listeners: Array<(event: SimEvent) => void>;
  runtime: Map<AgentId, AgentRuntime>;
  spatial: SpatialIndex;
  hunts: HuntState[];
  overrides: { season: Season | null; weather: Weather | null };
  naturalWeather: Weather;
  naturalSeason: Season;
  weatherUntil: number;
  prevDay: number;
  prevPhase: DayPhase;
  prevSeason: Season;
  prevWeather: Weather;
  huntDay: number;
  huntsToday: number;
  nextAgentId: number;
  nextInteractionId: number;
  nextCarcassId: number;
  nextEventSeq: number;
  births: number;
  deaths: number;
  approximate: boolean;
  drinkSpots: Array<{ x: number; z: number }>;
  places: PlaceRef[];
  /** agentId:poolId → game time of the last hotspring.entered emit. */
  springEmitAt: Map<string, number>;
  counts: Map<string, number>;
  centroids: Map<number, { x: number; z: number; n: number }>;
  nearScratch: AgentState[];
  rngWeather: Rng;
  rngEcology: Rng;
  rngLife: Rng;
  rngHunt: Rng;
  anchor: { x: number; z: number } | null;
}

export function speciesOf(state: SimState, agent: AgentState): SpeciesProfile {
  const sp = state.species.get(agent.speciesId);
  if (!sp) throw new Error(`missing species ${agent.speciesId}`);
  return sp;
}

export function rtOf(state: SimState, id: AgentId): AgentRuntime {
  const rt = state.runtime.get(id);
  if (!rt) throw new Error(`missing runtime ${id}`);
  return rt;
}

export function blankRelationship(now: number): Relationship {
  return {
    familiarity: 0,
    trust: 0.2,
    affection: 0,
    fear: 0,
    dominance: 0,
    rivalry: 0,
    kin: 'none',
    lastSeen: now,
    interactions: 0,
  };
}

export function ensureRel(state: SimState, a: AgentId, b: AgentId): Relationship {
  let row = state.relationships.get(a);
  if (!row) {
    row = new Map();
    state.relationships.set(a, row);
  }
  let rel = row.get(b);
  if (!rel) {
    rel = blankRelationship(state.env.time);
    row.set(b, rel);
  }
  return rel;
}

export function familiarity(state: SimState, a: AgentId, b: AgentId): number {
  return state.relationships.get(a)?.get(b)?.familiarity ?? 0;
}

export function vegIndex(state: SimState, x: number, z: number): number {
  const g = state.vegetationGridSize;
  const size = state.terrain.size;
  const half = state.terrain.half;
  const i = Math.min(g - 1, Math.max(0, Math.floor(((x + half) / size) * g)));
  const j = Math.min(g - 1, Math.max(0, Math.floor(((z + half) / size) * g)));
  return j * g + i;
}

export function sampleVeg(state: SimState, x: number, z: number): number {
  return state.vegetation[vegIndex(state, x, z)] ?? 0;
}

export const EMPTY_RELATIONSHIPS: ReadonlyMap<AgentId, Relationship> = new Map();
