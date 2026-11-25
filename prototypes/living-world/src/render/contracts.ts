/**
 * Contracts between the scene integration (WorldRenderer / main), the environment layer
 * and the creature layer. Layers own their THREE objects and add them to `ctx.scene`.
 */
import type * as THREE from 'three';
import type { ArtDirection, RegionLayout, SpeciesProfile } from '../data/schema';
import type { Terrain } from '../sim/terrain';
import type { AgentId, AgentState, EnvironmentState, InteractionState, SimulationView } from '../sim/types';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly terrain: Terrain;
  readonly region: RegionLayout;
  readonly art: ArtDirection;
  readonly species: ReadonlyMap<string, SpeciesProfile>;
  readonly quality: QualityLevel;
}

export interface FrameState {
  /** Real seconds since the previous rendered frame (clamped to <= 0.1). */
  readonly dt: number;
  /** Real seconds since start, for shader animation. */
  readonly elapsed: number;
  /** Interpolation factor between the previous and current fixed simulation step (0..1). */
  readonly alpha: number;
  /** Simulation speed multiplier (0 when paused). Animation playback rate should follow it. */
  readonly timeScale: number;
  readonly env: Readonly<EnvironmentState>;
  /** Null inside labs that run without the simulation. */
  readonly sim: SimulationView | null;
}

export type ProgressFn = (fraction: number, label: string) => void;

export interface EnvironmentLayer {
  init(ctx: RenderContext, onProgress?: ProgressFn): Promise<void>;
  update(frame: FrameState): void;
  /** Key light (sun or moon) shared with the creature layer. */
  readonly sun: THREE.DirectionalLight;
  /** Current wind for secondary motion: direction (rad) and strength 0..1. */
  getWind(): { direction: number; strength: number };
  setQuality?(quality: QualityLevel): void;
  dispose(): void;
}

export interface CreatureAnchor {
  readonly position: THREE.Vector3;
  readonly heading: number;
  /** Rendered shoulder height and body length in metres (scaled for growth). */
  readonly height: number;
  readonly length: number;
}

export interface CreatureDebugFlags {
  skeleton?: boolean;
  footTargets?: boolean;
  contactPoints?: boolean;
}

export interface CreatureLayer {
  init(ctx: RenderContext, onProgress?: ProgressFn): Promise<void>;
  /**
   * Called every rendered frame. `agents` comes from the simulation (or a lab driver);
   * `interactions` lets paired animation read the shared phase clock and contact point.
   */
  update(frame: FrameState, agents: readonly AgentState[], interactions: readonly InteractionState[]): void;
  pick(raycaster: THREE.Raycaster): AgentId | null;
  getAnchor(id: AgentId): CreatureAnchor | null;
  setHighlight(id: AgentId | null): void;
  setDebug(flags: CreatureDebugFlags): void;
  dispose(): void;
}
