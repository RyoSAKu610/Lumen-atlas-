/**
 * Runtime state contracts shared by the simulation core, renderer and UI.
 *
 * Time model:
 * - The simulation advances in fixed physical steps of `SimConfig.fixedDt` seconds. Movement,
 *   interaction phases and animation run on this physical clock so creatures move at natural speed.
 * - The world clock (day/night, seasons, needs, ecology, ageing) runs `SimConfig.clockScale` times faster.
 *   `EnvironmentState.time` is in game seconds.
 *
 * The renderer and UI must treat everything here as read-only.
 */
import type { RegionLayout, SpeciesProfile } from '../data/schema';
import type {
  BehaviorId,
  CauseOfDeath,
  DayPhase,
  EventType,
  FlightMode,
  InteractionKind,
  InteractionOutcome,
  InteractionPhase,
  LifeStage,
  Posture,
  Season,
  Sex,
  Vocalization,
  Weather,
} from './ids';
import type { Terrain } from './terrain';

/** Persistent, never-reused individual id. */
export type AgentId = number;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Needs {
  hunger: number;
  thirst: number;
  fatigue: number;
  cold: number;
  heat: number;
  social: number;
  fear: number;
  curiosity: number;
  stamina: number;
  health: number;
  breeding: number;
}

export interface Intent {
  behavior: BehaviorId;
  /** Movement destination on the ground plane, if any. */
  target: { x: number; z: number } | null;
  targetAgent: AgentId | null;
  /** Landmark / pool id the intent refers to. */
  place: string | null;
}

export interface Consideration {
  name: string;
  /** Raw normalised input (0..1). */
  input: number;
  /** Curve output (0..1) that multiplies the score. */
  output: number;
}

export interface DecisionOption {
  behavior: BehaviorId;
  targetAgent: AgentId | null;
  score: number;
  considerations: Consideration[];
}

/** Explainable Utility AI trace for the debug view. */
export interface DecisionTrace {
  /** Game time of the evaluation. */
  at: number;
  chosen: BehaviorId;
  /** Sorted by score, highest first; at most ~8 entries. */
  options: DecisionOption[];
  /** Why re-evaluation happened, e.g. "behaviour complete", "threat perceived". */
  reason: string;
}

export interface AgentInteractionRef {
  id: number;
  kind: InteractionKind;
  role: 'initiator' | 'responder';
  phase: InteractionPhase;
  partnerId: AgentId;
}

export interface AgentStats {
  meals: number;
  huntsAttempted: number;
  huntsSucceeded: number;
  interactions: number;
  offspring: number;
  distance: number;
  baths: number;
}

export interface AgentMemory {
  lastThreatAt: number | null;
  lastThreatPos: { x: number; z: number } | null;
  lastThreatId: AgentId | null;
  /** Remembered good feeding spot. */
  food: { x: number; z: number } | null;
  /** Remembered water access point. */
  water: { x: number; z: number } | null;
}

export interface AgentState {
  readonly id: AgentId;
  readonly speciesId: string;
  readonly sex: Sex;
  /** Game time of birth (negative for the founding population). */
  readonly bornAt: number;
  lifeStage: LifeStage;
  alive: boolean;
  diedAt: number | null;
  causeOfDeath: CauseOfDeath | null;

  // Kinematics (metres / radians). prev* = state at the previous fixed step, for render interpolation.
  pos: Vec3;
  prevPos: Vec3;
  heading: number;
  prevHeading: number;
  velocity: Vec3;
  /** Horizontal speed (m/s, physical time). */
  speed: number;
  posture: Posture;
  flightMode: FlightMode | null;
  /** Bank angle for flyers (rad, positive = right wing down). */
  bank: number;

  /** Body scale relative to an adult (growth). */
  scale: number;
  needs: Needs;

  behavior: BehaviorId;
  behaviorStartedAt: number;
  intent: Intent;
  decision: DecisionTrace | null;
  interaction: AgentInteractionRef | null;

  groupId: number | null;
  /** Landmark id of the den / nest / roost this individual returns to. */
  homeId: string | null;
  motherId: AgentId | null;
  fatherId: AgentId | null;
  mateId: AgentId | null;
  territory: { x: number; z: number; radius: number } | null;
  pregnancy: { mateId: AgentId; dueAt: number } | null;
  memory: AgentMemory;

  /** Where the head should look (world space), or null for neutral. */
  lookAt: Vec3 | null;
  vocalization: { kind: Vocalization; until: number } | null;
  stats: AgentStats;
}

export interface InteractionState {
  readonly id: number;
  readonly kind: InteractionKind;
  readonly initiator: AgentId;
  readonly responder: AgentId;
  phase: InteractionPhase;
  /** Physical seconds spent in the current phase and planned duration of the phase. */
  phaseTime: number;
  phaseDuration: number;
  startedAt: number;
  response: 'accept' | 'ignore' | 'reject' | 'counter' | null;
  outcome: InteractionOutcome | null;
  interruptReason: string | null;
  /** World-space point both heads reach toward during `contact`. */
  contactPoint: Vec3 | null;
}

export interface Carcass {
  readonly id: number;
  readonly speciesId: string;
  readonly agentId: AgentId;
  pos: Vec3;
  heading: number;
  /** Remaining edible fraction 0..1. */
  remaining: number;
  createdAt: number;
}

export interface EnvironmentState {
  /** Game seconds since world creation. */
  time: number;
  /** 1-based day counter. */
  day: number;
  /** Hours 0..24. */
  timeOfDay: number;
  dayPhase: DayPhase;
  season: Season;
  /** 0..1 progress through the current season. */
  seasonProgress: number;
  year: number;
  weather: Weather;
  weatherIntensity: number;
  /** Ambient air temperature at the valley floor (°C). */
  temperatureC: number;
  /** Direction the wind blows TOWARD (rad) and speed (m/s). */
  wind: { direction: number; speed: number };
  /** Unit vector toward the sun and its elevation (rad, negative below horizon). */
  sun: { direction: Vec3; elevation: number };
  moon: { direction: Vec3; phase: number };
}

export interface SimEvent {
  readonly seq: number;
  /** Game time. */
  readonly time: number;
  readonly day: number;
  readonly timeOfDay: number;
  readonly type: EventType;
  readonly actors: readonly AgentId[];
  readonly pos: { x: number; z: number } | null;
  readonly place: string | null;
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
  /** 0..1, used by the journal filter and the documentary camera. */
  readonly importance: number;
  /** True when produced by offline catch-up (aggregate approximation). */
  readonly approximate: boolean;
}

export interface Relationship {
  familiarity: number;
  trust: number;
  affection: number;
  fear: number;
  /** -1..1; positive = this individual dominates the other. */
  dominance: number;
  rivalry: number;
  kin: 'none' | 'parent' | 'offspring' | 'sibling' | 'mate';
  lastSeen: number;
  interactions: number;
}

export interface SimConfig {
  seed: number;
  fixedDt: number;
  clockScale: number;
  daysPerSeason: number;
  /** Hour of day at world creation. */
  startHour: number;
  startSeason: Season;
  /** Maximum game seconds simulated by offline catch-up. */
  maxCatchUpGameSeconds: number;
}

export interface CatchUpReport {
  requestedGameSeconds: number;
  simulatedGameSeconds: number;
  truncated: boolean;
  births: number;
  deaths: number;
  events: number;
  approximations: string[];
}

export interface WorldSnapshot {
  schemaVersion: number;
  savedAtWallClockMs: number;
  config: SimConfig;
  regionId: string;
  [key: string]: unknown;
}

/** Read-only view of the running world consumed by the renderer and UI. */
export interface SimulationView {
  readonly config: Readonly<SimConfig>;
  readonly tick: number;
  /** Physical seconds simulated so far (tick * fixedDt). */
  readonly physTime: number;
  readonly env: Readonly<EnvironmentState>;
  /** Living agents plus recently dead ones still lying in the world. */
  readonly agents: readonly AgentState[];
  readonly carcasses: readonly Carcass[];
  readonly interactions: readonly InteractionState[];
  readonly terrain: Terrain;
  readonly region: RegionLayout;
  readonly species: ReadonlyMap<string, SpeciesProfile>;
  /** Vegetation biomass 0..1 on a `vegetationGridSize`² grid covering the region. */
  readonly vegetation: Float32Array;
  readonly vegetationGridSize: number;
  getAgent(id: AgentId): AgentState | undefined;
  getRelationships(id: AgentId): ReadonlyMap<AgentId, Readonly<Relationship>>;
  /** Most recent events, newest last. */
  recentEvents(limit?: number): readonly SimEvent[];
  /** Subscribe to new journal events; returns an unsubscribe function. */
  onEvent(listener: (event: SimEvent) => void): () => void;
}
