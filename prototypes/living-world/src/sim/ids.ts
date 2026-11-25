/**
 * Stable identifiers shared by the simulation, renderer, UI and data files.
 * Renaming or removing an entry is a schema change: update data files, narration
 * packs and snapshot migrations together.
 */

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ['clear', 'cloudy', 'rain', 'fog', 'snow', 'storm'] as const;
export type Weather = (typeof WEATHERS)[number];

export const DAY_PHASES = ['night', 'dawn', 'day', 'dusk'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

export const LIFE_STAGES = ['juvenile', 'adult', 'elder'] as const;
export type LifeStage = (typeof LIFE_STAGES)[number];

export const SEXES = ['female', 'male'] as const;
export type Sex = (typeof SEXES)[number];

/** Anatomy / locomotion families. Each maps to one procedural rig family in the renderer. */
export const ANATOMY_FAMILIES = ['quadruped_giant', 'quadruped_small', 'quadruped_predator', 'winged_flyer'] as const;
export type AnatomyFamily = (typeof ANATOMY_FAMILIES)[number];

export const ECOLOGICAL_ROLES = ['megafauna_grazer', 'social_omnivore', 'apex_predator', 'aerial_scavenger'] as const;
export type EcologicalRole = (typeof ECOLOGICAL_ROLES)[number];

/**
 * Needs are urgencies in [0, 1] where 0 = satisfied and 1 = critical,
 * except `stamina` and `health`, where 1 = full and 0 = depleted.
 */
export const NEED_IDS = [
  'hunger',
  'thirst',
  'fatigue',
  'cold',
  'heat',
  'social',
  'fear',
  'curiosity',
  'stamina',
  'health',
  'breeding',
] as const;
export type NeedId = (typeof NEED_IDS)[number];

/** Behaviours the Utility AI can select. `interact` means "engaged by the InteractionCoordinator". */
export const BEHAVIOR_IDS = [
  'idle',
  'wander',
  'graze',
  'forage',
  'drink',
  'rest',
  'sleep',
  'bathe',
  'seek_company',
  'follow',
  'socialize',
  'play',
  'warn',
  'court',
  'care',
  'patrol',
  'vigilance',
  'flee',
  'defend',
  'stalk',
  'chase',
  'feed',
  'return_home',
  'soar',
  'glide',
  'perch',
  'interact',
] as const;
export type BehaviorId = (typeof BEHAVIOR_IDS)[number];

export const INTERACTION_KINDS = ['greet', 'groom', 'play', 'warn', 'court', 'nurse'] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** Approach → Orient → Signal → Response → Contact → Resolve → Cooldown → Separate (docs/TECHNICAL_ARCHITECTURE.md). */
export const INTERACTION_PHASES = [
  'approach',
  'orient',
  'signal',
  'response',
  'contact',
  'resolve',
  'cooldown',
  'separate',
] as const;
export type InteractionPhase = (typeof INTERACTION_PHASES)[number];

export const INTERACTION_OUTCOMES = [
  'bonded',
  'accepted',
  'ignored',
  'rejected',
  'retreated',
  'escalated',
  'interrupted',
] as const;
export type InteractionOutcome = (typeof INTERACTION_OUTCOMES)[number];

/** Base body pose requested by the simulation. Gait (walk/trot/run) is derived by the renderer from speed. */
export const POSTURES = ['stand', 'crouch', 'sit', 'lie', 'sleep', 'bathe', 'swim', 'airborne', 'perch', 'dead'] as const;
export type Posture = (typeof POSTURES)[number];

export const FLIGHT_MODES = ['takeoff', 'flap', 'glide', 'soar', 'landing'] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export const VOCALIZATIONS = ['alarm', 'call', 'growl', 'chirp', 'rumble', 'cry'] as const;
export type Vocalization = (typeof VOCALIZATIONS)[number];

export const CAUSES_OF_DEATH = ['predation', 'starvation', 'dehydration', 'old_age', 'exposure', 'injury'] as const;
export type CauseOfDeath = (typeof CAUSES_OF_DEATH)[number];

/** Journal event types. Narration templates are keyed by these (optionally suffixed with `:kind[:outcome]`). */
export const EVENT_TYPES = [
  'system.world_created',
  'system.restored',
  'system.catchup',
  'world.dawn',
  'world.dusk',
  'world.day_started',
  'world.season_changed',
  'world.weather_changed',
  'world.override',
  'agent.born',
  'agent.matured',
  'agent.elder',
  'agent.died',
  'interaction.started',
  'interaction.contact',
  'interaction.resolved',
  'interaction.interrupted',
  'hunt.stalk_started',
  'hunt.chase_started',
  'hunt.succeeded',
  'hunt.failed',
  'hunt.aborted',
  'alarm.raised',
  'herd.defense',
  'hotspring.entered',
  'hotspring.displaced',
  'courtship.bonded',
  'home.returned',
  'flight.soaring',
  'carcass.scavenged',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const SURFACE_KINDS = [
  'meadow',
  'flower_field',
  'sakura_grove',
  'cedar_forest',
  'maple_wood',
  'reed_marsh',
  'moss_rocks',
  'rock',
  'cliff',
  'sinter',
  'riverbed',
  'river',
  'pool',
  'hot_spring',
] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const ZONE_KINDS = [
  'meadow',
  'flower_field',
  'sakura_grove',
  'cedar_forest',
  'maple_wood',
  'reed_marsh',
  'moss_rocks',
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const LANDMARK_KINDS = ['waterfall', 'roost', 'den', 'nest', 'lookout', 'grove_heart', 'ruin', 'salt_lick'] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export const POOL_KINDS = ['hot_spring', 'plunge_pool', 'pond'] as const;
export type PoolKind = (typeof POOL_KINDS)[number];

export const TREE_KINDS = ['sakura', 'cedar', 'maple', 'pine'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];
