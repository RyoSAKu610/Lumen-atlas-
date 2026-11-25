import type { RegionLayout, SpeciesProfile } from '../data/schema';
import type { Season, Weather } from './ids';
import { applyOverrides } from './environment';
import { EMPTY_RELATIONSHIPS, type SimState } from './internal';
import { emit } from './journal';
import { createWorld } from './population';
import { SNAPSHOT_SCHEMA_VERSION, SnapshotError, migrateSnapshot, captureSnapshot, restoreWorld } from './snapshot';
import { stepState } from './step';
import type { AgentId, AgentState, CatchUpReport, Relationship, SimConfig, SimulationView, WorldSnapshot } from './types';

export { SNAPSHOT_SCHEMA_VERSION, SnapshotError, migrateSnapshot };

/** One game day is 24 real minutes at 1× (`clockScale` 60). */
export const DEFAULT_SIM_CONFIG: SimConfig = {
  seed: 1,
  fixedDt: 0.1,
  clockScale: 60,
  daysPerSeason: 4,
  /** About an hour after dawn. */
  startHour: 6.2,
  startSeason: 'spring',
  maxCatchUpGameSeconds: 10 * 24 * 3600,
};

const COARSE_PHYS = 5;

/**
 * Deterministic ecology simulation.
 *
 * The renderer should keep the returned object and, once per frame:
 * `const { alpha } = sim.advance(frameDt, timeScale)` then interpolate each
 * agent from `prevPos`/`prevHeading` to `pos`/`heading` by `alpha`.
 * `snapshot()` / `restore()` round-trip the world. `catchUp()` skips ahead
 * offline with coarse steps and `approximate` journal events.
 */
export class Simulation implements SimulationView {
  private readonly state: SimState;

  private constructor(state: SimState) {
    this.state = state;
  }

  static create(
    data: { region: RegionLayout; species: SpeciesProfile[] },
    config?: Partial<SimConfig>,
    onProgress?: (fraction: number, label: string) => void,
  ): Simulation {
    const merged: SimConfig = { ...DEFAULT_SIM_CONFIG, ...config };
    return new Simulation(createWorld(data, merged, onProgress));
  }

  static restore(
    snapshot: WorldSnapshot,
    data: { region: RegionLayout; species: SpeciesProfile[] },
    onProgress?: (fraction: number, label: string) => void,
  ): Simulation {
    return new Simulation(restoreWorld(snapshot, data, onProgress));
  }

  step(): void {
    stepState(this.state);
  }

  advance(realSeconds: number, speed: number, maxSteps = 30): { steps: number; alpha: number } {
    const dt = this.state.config.fixedDt;
    if (!(realSeconds > 0) || !(speed > 0) || !(dt > 0)) {
      return { steps: 0, alpha: alphaOf(this.state.accumulator, dt) };
    }
    this.state.accumulator += realSeconds * speed;
    let steps = 0;
    const cap = Math.max(0, maxSteps);
    while (this.state.accumulator >= dt - 1e-12 && steps < cap) {
      stepState(this.state);
      this.state.accumulator -= dt;
      steps += 1;
    }
    if (this.state.accumulator < 1e-9) this.state.accumulator = 0;
    return { steps, alpha: alphaOf(this.state.accumulator, dt) };
  }

  snapshot(savedAtWallClockMs = 0): WorldSnapshot {
    return captureSnapshot(this.state, savedAtWallClockMs);
  }

  catchUp(gameSeconds: number, onProgress?: (fraction: number, label: string) => void): CatchUpReport {
    const requested = Number.isFinite(gameSeconds) ? Math.max(0, gameSeconds) : 0;
    const max = this.state.config.maxCatchUpGameSeconds;
    const simulated = Math.min(requested, max);
    const truncated = requested - simulated > 1e-3;
    const births0 = this.state.births;
    const deaths0 = this.state.deaths;
    const seq0 = this.state.nextEventSeq;
    const phys0 = this.state.physTime;
    this.state.approximate = true;
    const target = simulated / this.state.config.clockScale;
    let guard = 0;
    while (this.state.physTime - phys0 < target - this.state.config.fixedDt * 0.5 && guard++ < 1_000_000) {
      const remain = target - (this.state.physTime - phys0);
      const want = Math.min(COARSE_PHYS, remain);
      const sub = Math.max(1, Math.round(want / this.state.config.fixedDt));
      const used = sub * this.state.config.fixedDt;
      stepState(this.state, used);
      if (onProgress && guard % 40 === 0) onProgress(Math.min(1, (this.state.physTime - phys0) / Math.max(target, 1e-9)), 'catch-up');
    }
    const simulatedGameSeconds = (this.state.physTime - phys0) * this.state.config.clockScale;
    emit(
      this.state,
      'system.catchup',
      [],
      this.state.anchor,
      {
        requested,
        simulated: Math.round(simulatedGameSeconds),
        births: this.state.births - births0,
        deaths: this.state.deaths - deaths0,
        truncated,
      },
      0.7,
    );
    this.state.approximate = false;
    onProgress?.(1, 'catch-up');
    return {
      requestedGameSeconds: requested,
      simulatedGameSeconds,
      truncated,
      births: this.state.births - births0,
      deaths: this.state.deaths - deaths0,
      events: this.state.nextEventSeq - seq0,
      approximations: [
        'coarse physical steps',
        'perception and interaction timing coarsened',
        'journal events flagged approximate',
      ],
    };
  }

  setOverrides(o: { season?: Season | null; weather?: Weather | null }): void {
    if ('season' in o) this.state.overrides.season = o.season ?? null;
    if ('weather' in o) this.state.overrides.weather = o.weather ?? null;
    applyOverrides(this.state);
  }

  get config(): Readonly<SimConfig> {
    return this.state.config;
  }
  get tick(): number {
    return this.state.tick;
  }
  get physTime(): number {
    return this.state.physTime;
  }
  get env() {
    return this.state.env;
  }
  get agents(): readonly AgentState[] {
    return this.state.agents;
  }
  get carcasses() {
    return this.state.carcasses;
  }
  get interactions() {
    return this.state.interactions;
  }
  get terrain() {
    return this.state.terrain;
  }
  get region() {
    return this.state.region;
  }
  get species() {
    return this.state.species;
  }
  get vegetation(): Float32Array {
    return this.state.vegetation;
  }
  get vegetationGridSize(): number {
    return this.state.vegetationGridSize;
  }

  getAgent(id: AgentId): AgentState | undefined {
    return this.state.agentById.get(id);
  }

  getRelationships(id: AgentId): ReadonlyMap<AgentId, Readonly<Relationship>> {
    return this.state.relationships.get(id) ?? EMPTY_RELATIONSHIPS;
  }

  recentEvents(limit = 50) {
    const n = Math.max(0, limit);
    return this.state.events.slice(Math.max(0, this.state.events.length - n));
  }

  onEvent(listener: (event: import('./types').SimEvent) => void): () => void {
    this.state.listeners.push(listener);
    return () => {
      const i = this.state.listeners.indexOf(listener);
      if (i >= 0) this.state.listeners.splice(i, 1);
    };
  }
}

function alphaOf(accumulator: number, dt: number): number {
  if (!(dt > 0)) return 0;
  const a = accumulator / dt;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}
