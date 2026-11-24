/**
 * Data-file contracts for the LIVING ATLAS vertical slice.
 *
 * Ownership (docs/AI_COLLABORATION.md):
 * - RegionLayout, ArtDirection, NarrationPack, ShotGrammar: Creative Direction (GPT) authors the values.
 * - SpeciesProfile: Simulation engineering (Claude) owns the numbers; creative identity lives in ArtDirection.
 *
 * Coordinates: metres, world origin at the region centre, +X east, +Z south, +Y up.
 * Headings: radians around +Y; forward = (sin h, 0, cos h).
 * Colours: "#rrggbb" sRGB hex strings.
 */
import { z } from 'zod';
import {
  ANATOMY_FAMILIES,
  BEHAVIOR_IDS,
  CAUSES_OF_DEATH,
  DAY_PHASES,
  ECOLOGICAL_ROLES,
  INTERACTION_KINDS,
  INTERACTION_OUTCOMES,
  INTERACTION_PHASES,
  LANDMARK_KINDS,
  LIFE_STAGES,
  NEED_IDS,
  POOL_KINDS,
  SEASONS,
  SEXES,
  WEATHERS,
  ZONE_KINDS,
} from '../sim/ids';

const Vec2 = z.tuple([z.number(), z.number()]);
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');
const Unit = z.number().min(0).max(1);
const Positive = z.number().positive();
const Localized = z.object({ ja: z.string().min(1), en: z.string().min(1) });
const StableId = z.string().regex(/^[a-z][a-z0-9_]*$/, 'lower_snake_case id');

// ---------------------------------------------------------------------------
// Region layout
// ---------------------------------------------------------------------------

export const RegionLayoutSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^REG_[a-z0-9_]+$/),
  name: Localized,
  /** This slice is an invented place. Real-world references must never be presented as this region. */
  fictional: z.literal(true),
  provenance: z.string().min(1),
  description: Localized,
  /** Square world extent in metres; coordinates span [-size/2, size/2]. */
  size: z.number().min(128).max(1024),
  /** Height-field samples per side (2^n + 1 recommended). */
  resolution: z.number().int().min(65).max(513),
  terrain: z.object({
    /**
     * Valley centre-line from upstream to downstream; `floor` = valley-floor height (m) at that point.
     * A sharp drop of `floor` between two close points creates a cliff lip across the floor (waterfall).
     * Optional `halfWidth` overrides `floorHalfWidth` locally (narrow gorges, wide basins).
     */
    axis: z.array(z.object({ p: Vec2, floor: z.number(), halfWidth: Positive.optional() })).min(2),
    /** Default half-width of the flat valley floor (m). */
    floorHalfWidth: Positive,
    /** Horizontal distance over which the floor rises to the ridges (m). */
    ridgeFalloff: Positive,
    /** Height of the surrounding ridges above the floor (m). */
    ridgeHeight: Positive,
    /** fBm amplitude on the valley floor (m). */
    floorRoughness: z.number().min(0).max(6),
    /** Ridged-noise amplitude on the ridges (m). */
    ridgeRoughness: z.number().min(0).max(90),
    /** Organic wobble of the valley edge (0 = straight, 1 = strongly meandering). */
    edgeWarp: Unit,
    features: z
      .array(
        z.object({
          id: StableId,
          /** plateau = flat-topped cliff block, mound = smooth hill, basin = smooth depression */
          kind: z.enum(['plateau', 'mound', 'basin']),
          center: Vec2,
          radius: Positive,
          /** Height added (plateau/mound) or removed (basin), metres. */
          height: Positive,
          /** Width of the transition band; small = steep cliff. */
          falloff: Positive,
        }),
      )
      .default([]),
  }),
  river: z
    .object({
      /** Upstream → downstream. Water flows from points[0] to the last point. */
      points: z.array(Vec2).min(2),
      halfWidth: Positive,
      depth: Positive,
    })
    .nullable(),
  pools: z.array(
    z.object({
      id: StableId,
      kind: z.enum(POOL_KINDS),
      name: Localized,
      center: Vec2,
      radius: Positive,
      depth: Positive,
      /** Water temperature in °C. Hot springs drive thermoregulation behaviour. */
      temperatureC: z.number().min(-2).max(98),
      /** How many large-bodied animals can bathe comfortably at once; competition beyond this. */
      capacity: z.number().int().min(1).max(40),
    }),
  ),
  landmarks: z.array(
    z.object({
      id: StableId,
      kind: z.enum(LANDMARK_KINDS),
      name: Localized,
      center: Vec2,
      radius: Positive,
      note: z.string().default(''),
    }),
  ),
  zones: z.array(
    z.object({
      id: StableId,
      kind: z.enum(ZONE_KINDS),
      center: Vec2,
      /** Ellipse radii (m) and rotation (rad). */
      radiusX: Positive,
      radiusZ: Positive,
      rotation: z.number().default(0),
      density: Unit,
    }),
  ),
  spawns: z.array(
    z.object({
      speciesId: StableId,
      count: z.number().int().min(1).max(200),
      /** Landmark or zone id to spawn near. */
      near: StableId,
      spread: Positive,
      groups: z.number().int().min(1).default(1),
    }),
  ),
  wind: z.object({ direction: z.number(), speed: z.number().min(0).max(30) }),
  climate: z.object({
    seasonalMeanC: z.object({ spring: z.number(), summer: z.number(), autumn: z.number(), winter: z.number() }),
    diurnalRangeC: z.number().min(0).max(30),
    /** Relative weather weights per season (normalised at runtime). */
    weather: z.record(z.enum(SEASONS), z.record(z.enum(WEATHERS), z.number().min(0))),
  }),
  cameraViewpoints: z
    .array(
      z.object({
        id: StableId,
        name: Localized,
        position: Vec3,
        target: Vec3,
        fovDeg: z.number().min(10).max(100),
      }),
    )
    .default([]),
});
export type RegionLayout = z.infer<typeof RegionLayoutSchema>;

// ---------------------------------------------------------------------------
// Species simulation profile (engineering-owned numbers)
// ---------------------------------------------------------------------------

export const SpeciesProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableId,
  family: z.enum(ANATOMY_FAMILIES),
  ecologicalRole: z.enum(ECOLOGICAL_ROLES),
  /** Physical size of a healthy adult. The renderer scales art proportions to these numbers. */
  body: z.object({
    /** Snout tip to tail base (m). */
    length: Positive,
    shoulderHeight: Positive,
    massKg: Positive,
    /** Collision / personal-space radius (m). */
    radius: Positive,
    /** Horizontal distance from body origin to snout tip at rest (m). Used for contact validation. */
    headReach: Positive,
    /** Snout height above ground at rest (m). */
    headHeight: Positive,
  }),
  locomotion: z.object({
    walkSpeed: Positive,
    trotSpeed: Positive,
    runSpeed: Positive,
    sprintSpeed: Positive,
    acceleration: Positive,
    /** rad/s at walking speed. */
    turnRate: Positive,
    /** Stride length at walk (m); the renderer derives cadence from speed / stride. */
    strideLength: Positive,
    maxSlopeDeg: z.number().min(5).max(80),
    canSwim: z.boolean(),
    swimSpeed: z.number().min(0),
    flight: z
      .object({
        cruiseSpeed: Positive,
        minSpeed: Positive,
        climbRate: Positive,
        sinkRate: Positive,
        /** Climb rate inside a thermal (m/s). */
        soarClimbRate: Positive,
        cruiseAltitude: Positive,
        maxAltitude: Positive,
        takeoffDistance: Positive,
      })
      .nullable(),
  }),
  senses: z.object({
    sightRange: Positive,
    sightFovDeg: z.number().min(30).max(360),
    nightVision: Unit,
    hearingRange: Positive,
    scentRange: Positive,
  }),
  diet: z.object({
    vegetation: Unit,
    meat: Unit,
    carrion: Unit,
    /** Hunger reduced per game hour of uninterrupted feeding on a good patch. */
    feedRatePerHour: Positive,
  }),
  /** Activity propensity per day phase (0..1). */
  activity: z.object({ night: Unit, dawn: Unit, day: Unit, dusk: Unit }),
  thermal: z.object({
    comfortMinC: z.number(),
    comfortMaxC: z.number(),
    insulation: Unit,
    hotSpringAffinity: Unit,
  }),
  /** Need drift per game hour (urgency units / hour). */
  needsRates: z.object({
    hungerPerHour: Positive,
    thirstPerHour: Positive,
    fatiguePerHour: Positive,
    recoveryPerHour: Positive,
    socialPerHour: Positive,
    curiosityPerHour: Positive,
  }),
  social: z.object({
    model: z.enum(['herd', 'family', 'solitary_territorial', 'loose_flock']),
    cohesion: Unit,
    greetingStyle: z.enum(['nuzzle', 'sniff', 'call', 'display', 'preen']),
    territorial: z.boolean(),
    territoryRadius: z.number().min(0),
    aggression: Unit,
    boldness: Unit,
    playfulness: Unit,
  }),
  lifeCycle: z.object({
    maturityDays: Positive,
    elderDays: Positive,
    maxAgeDays: Positive,
    breedingSeasons: z.array(z.enum(SEASONS)),
    gestationDays: Positive,
    litterSize: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    reproduction: z.enum(['live_birth', 'eggs']),
    parentalCareDays: Positive,
    /** Newborn body scale relative to adult. */
    juvenileScale: z.number().min(0.15).max(0.9),
  }),
  predation: z
    .object({
      prey: z.array(StableId).min(1),
      attackRange: Positive,
      baseSuccess: Unit,
      stalkSpeedFactor: Unit,
      chaseMaxSeconds: Positive,
      giveUpDistance: Positive,
      preferVulnerable: Unit,
      /** Hunger removed by consuming a whole carcass of an adult prey. */
      mealSize: Positive,
    })
    .nullable(),
  antiPredator: z.object({
    alarmCall: z.boolean(),
    herdDefense: z.boolean(),
    fleeDistance: Positive,
    vigilance: Unit,
  }),
  behaviors: z.array(z.enum(BEHAVIOR_IDS)).min(3),
  utilityWeights: z.partialRecord(z.enum(BEHAVIOR_IDS), z.number().min(0).max(4)).default({}),
  /** Soft population ceiling for density-dependent breeding in this region. */
  carryingCapacity: z.number().int().min(1),
  animationSet: z.string().min(1),
});
export type SpeciesProfile = z.infer<typeof SpeciesProfileSchema>;

// ---------------------------------------------------------------------------
// Art direction (Creative Director-owned values)
// ---------------------------------------------------------------------------

export const LightingKeySchema = z.object({
  /** Hour of day 0..24 at which this key applies; renderer interpolates between keys. */
  hour: z.number().min(0).max(24),
  sunColor: Color,
  sunIntensity: z.number().min(0).max(12),
  hemiSky: Color,
  hemiGround: Color,
  hemiIntensity: z.number().min(0).max(6),
  skyZenith: Color,
  skyHorizon: Color,
  /** Colour of the sun halo / glow on the sky dome. */
  sunGlow: Color,
  fogColor: Color,
  /** Exponential fog density (per metre). Typical 0.0005..0.01. */
  fogDensity: z.number().min(0).max(0.05),
  exposure: z.number().min(0.1).max(4),
  starsOpacity: Unit,
});

const LegSpecSchema = z.object({
  /** Lengths are fractions of body length. */
  upper: Positive,
  lower: Positive,
  foot: Positive,
  radiusTop: Positive,
  radiusBottom: Positive,
  /** Lateral distance between left and right feet, fraction of body length. */
  stanceWidth: Positive,
  digitigrade: z.boolean(),
  footStyle: z.enum(['hoof', 'pad', 'talon', 'column']),
});

/**
 * Procedural morphology. All lengths/radii are FRACTIONS OF BODY LENGTH (unitless),
 * so the renderer can scale them to SpeciesProfile.body.length.
 */
export const CreatureMorphologySchema = z.object({
  torso: z.object({
    /** Hip joint to shoulder joint. */
    length: Positive,
    girthFront: Positive,
    girthMid: Positive,
    girthRear: Positive,
    /** Vertical / horizontal radius ratio (1 = round, >1 deep-chested, <1 flat). */
    depthRatio: z.number().min(0.4).max(2),
    /** Extra dorsal height over the shoulders. */
    hump: z.number().min(0).max(0.5),
    /** Radians; positive = shoulders higher than hips. */
    backSlope: z.number().min(-0.6).max(0.6),
  }),
  neck: z.object({ length: Positive, radius: Positive, pitchDeg: z.number().min(-60).max(85) }),
  head: z.object({
    length: Positive,
    width: Positive,
    height: Positive,
    snoutLength: z.number().min(0),
    /** 0 = blunt box, 1 = sharp taper. */
    snoutTaper: Unit,
    jaw: z.enum(['blunt', 'tapered', 'beaked']),
    ears: z.object({ style: z.enum(['none', 'pointed', 'round', 'long', 'feathered', 'frill']), length: z.number().min(0) }),
    horns: z.object({
      style: z.enum(['none', 'antlers', 'crystal_branches', 'curved', 'single_spike', 'crest']),
      length: z.number().min(0),
      spread: z.number().min(0),
    }),
    /** Eye radius relative to head height. */
    eyeSize: z.number().min(0.04).max(0.45),
    /** 0 = side-facing (prey), 1 = forward-facing (predator). */
    eyeForward: Unit,
  }),
  tail: z.object({
    length: z.number().min(0),
    baseRadius: z.number().min(0),
    tipRadius: z.number().min(0),
    segments: z.number().int().min(2).max(16),
    style: z.enum(['taper', 'bushy', 'fan', 'whip', 'club', 'plume']),
    /** Resting upward curl in radians across the whole tail. */
    restCurve: z.number().min(-2).max(2),
  }),
  legs: z.object({
    /** 1 = biped stance (e.g. a flyer on the ground), 2 = quadruped. */
    pairs: z.union([z.literal(1), z.literal(2)]),
    front: LegSpecSchema.nullable(),
    hind: LegSpecSchema,
  }),
  wings: z
    .object({
      span: Positive,
      chord: Positive,
      style: z.enum(['membrane', 'feathered', 'leaf']),
      /** Length of the folded wing along the body. */
      foldedLength: Positive,
      /** Number of primary fingers / feather fingers at the tip. */
      fingers: z.number().int().min(0).max(10),
    })
    .nullable(),
  dorsal: z.object({
    style: z.enum(['none', 'moss_mantle', 'spines', 'plates', 'mane', 'crystal_ridge', 'frill']),
    height: z.number().min(0),
    /** Fraction of the spine covered, from the shoulders backwards. */
    coverage: Unit,
    count: z.number().int().min(0).max(40),
  }),
});
export type CreatureMorphology = z.infer<typeof CreatureMorphologySchema>;

export const CreatureMaterialSchema = z.object({
  base: Color,
  belly: Color,
  accent: Color,
  pattern: z.enum(['none', 'stripes', 'spots', 'dapples', 'rosettes', 'gradient', 'bands']),
  patternColor: Color,
  /** Pattern frequency; 1 = a few large marks, 8 = many small marks. */
  patternScale: z.number().min(0.5).max(12),
  roughness: Unit,
  /** Soft fur/feather rim sheen. */
  sheen: Unit,
  dorsalColor: Color,
  hornColor: Color,
  eye: Color,
  /** Optional bioluminescence (shown more strongly at night). */
  emissive: Color.nullable(),
  emissiveIntensity: z.number().min(0).max(4),
  emissiveWhere: z.enum(['none', 'markings', 'horns', 'dorsal', 'eyes', 'wings']),
});

export const CreatureLookSchema = z.object({
  speciesId: StableId,
  displayName: Localized,
  /** Invented binomial; must not be a real taxon. */
  scientificName: z.string().min(1),
  tagline: Localized,
  description: Localized,
  silhouette: z.string().min(1),
  morphology: CreatureMorphologySchema,
  material: CreatureMaterialSchema,
  juvenile: z.object({
    headScale: z.number().min(1).max(1.8),
    legScale: z.number().min(0.6).max(1.4),
    tailScale: z.number().min(0.3).max(1.5),
    coat: Color.nullable(),
  }),
  maleVariant: z.object({ scale: z.number().min(0.8).max(1.3), hornScale: z.number().min(0).max(2) }),
  /** How each behaviour / interaction should read on screen; guidance for animation. */
  behaviorExpression: z.record(z.string(), z.string()),
  vocal: z.object({ call: z.string(), alarm: z.string() }),
});
export type CreatureLook = z.infer<typeof CreatureLookSchema>;

const SeasonLookSchema = z.object({
  grassBase: Color,
  grassTip: Color,
  /** Mixed into grass tips (flower dots); null for none. */
  flowerAccent: Color.nullable(),
  cedar: Color,
  sakuraCanopy: Color,
  mapleCanopy: Color,
  pine: Color,
  /** Falling petals/leaves per 100 m² per second (0 = none). */
  petalRate: z.number().min(0).max(5),
  petalColor: Color,
  ground: Color,
  /** 0..1 snow cover on upward-facing surfaces. */
  snowCover: Unit,
  waterTint: Color,
});

const WeatherLookSchema = z.object({
  fogMultiplier: z.number().min(0.2).max(12),
  lightMultiplier: z.number().min(0.05).max(1.5),
  saturation: z.number().min(0).max(1.5),
  tint: Color,
  cloudCover: Unit,
});

export const ArtDirectionSchema = z.object({
  schemaVersion: z.literal(1),
  regionId: z.string(),
  provenance: z.object({ author: z.string(), date: z.string(), notes: z.string() }),
  lighting: z.array(LightingKeySchema).min(4),
  seasons: z.record(z.enum(SEASONS), SeasonLookSchema),
  weather: z.record(z.enum(WEATHERS), WeatherLookSchema),
  terrain: z.object({
    meadow: Color,
    meadowDry: Color,
    moss: Color,
    rock: Color,
    cliff: Color,
    sinter: Color,
    sulfur: Color,
    riverbed: Color,
    forestFloor: Color,
    marsh: Color,
    snow: Color,
  }),
  water: z.object({
    shallow: Color,
    deep: Color,
    hotSpringShallow: Color,
    hotSpringDeep: Color,
    foam: Color,
    steam: Color,
  }),
  atmosphere: z.object({
    fireflyColor: Color,
    /** Fireflies per hectare at summer night peak. */
    fireflyDensity: z.number().min(0).max(400),
    steamOpacity: Unit,
    godRays: Unit,
    bloom: z.number().min(0).max(2),
    /** Painterly grading: 0 = neutral, 1 = strongly stylised. */
    painterly: Unit,
  }),
  creatures: z.record(StableId, CreatureLookSchema),
  ui: z.object({
    accent: Color,
    accentSoft: Color,
    ink: Color,
    paper: Color,
    danger: Color,
    calm: Color,
    displayFont: z.string(),
    bodyFont: z.string(),
  }),
});
export type ArtDirection = z.infer<typeof ArtDirectionSchema>;
export type LightingKey = z.infer<typeof LightingKeySchema>;

// ---------------------------------------------------------------------------
// Narration (documentary voice for the field journal)
// ---------------------------------------------------------------------------

/**
 * Template keys: an EventType, optionally suffixed `:<kind>` and `:<outcome>`, e.g.
 * `interaction.resolved:greet:bonded`. The most specific key wins. Placeholders:
 * {actor} {target} (nickname + species), {actorName} {targetName}, {actorSpecies} {targetSpecies},
 * {place}, {count}, {season}, {weather}, {time}, {cause}, {temperature}, {kind}, {outcome}, {day}.
 */
export const NarrationPackSchema = z.object({
  schemaVersion: z.literal(1),
  locale: z.literal('ja'),
  provenance: z.string(),
  templates: z.record(z.string(), z.array(z.string().min(1)).min(1)),
  labels: z.object({
    behaviors: z.record(z.enum(BEHAVIOR_IDS), z.string().min(1)),
    /** Present-progressive phrases for the dossier, e.g. "湯に浸かって体を温めている". */
    behaviorPhrases: z.record(z.enum(BEHAVIOR_IDS), z.string().min(1)),
    needs: z.record(z.enum(NEED_IDS), z.string().min(1)),
    interactionKinds: z.record(z.enum(INTERACTION_KINDS), z.string().min(1)),
    interactionPhases: z.record(z.enum(INTERACTION_PHASES), z.string().min(1)),
    outcomes: z.record(z.enum(INTERACTION_OUTCOMES), z.string().min(1)),
    seasons: z.record(z.enum(SEASONS), z.string().min(1)),
    weathers: z.record(z.enum(WEATHERS), z.string().min(1)),
    dayPhases: z.record(z.enum(DAY_PHASES), z.string().min(1)),
    lifeStages: z.record(z.enum(LIFE_STAGES), z.string().min(1)),
    sexes: z.record(z.enum(SEXES), z.string().min(1)),
    causesOfDeath: z.record(z.enum(CAUSES_OF_DEATH), z.string().min(1)),
  }),
  /** Observer nicknames per species id; assigned deterministically by agent id. */
  nicknames: z.record(StableId, z.array(z.string().min(1)).min(16)),
});
export type NarrationPack = z.infer<typeof NarrationPackSchema>;

// ---------------------------------------------------------------------------
// Documentary camera shot grammar
// ---------------------------------------------------------------------------

export const ShotGrammarSchema = z.object({
  schemaVersion: z.literal(1),
  provenance: z.string(),
  shots: z
    .array(
      z.object({
        id: StableId,
        name: Localized,
        /** Event keys (`hunt.chase_started`, `interaction.started:greet`), `behavior:<id>`, or `idle`. */
        triggers: z.array(z.string().min(1)).min(1),
        priority: Unit,
        framing: z.enum([
          'establishing_wide',
          'two_shot',
          'single_medium',
          'close_up',
          'low_angle_hero',
          'telephoto_compressed',
          'aerial_follow',
          'tracking_side',
          'over_shoulder',
        ]),
        fovDeg: z.number().min(8).max(90),
        /** Camera distance in subject body lengths. */
        distance: Positive,
        /** Camera height in multiples of subject shoulder height (can be < 1 for low angles). */
        height: z.number().min(0.1).max(40),
        /** Degrees relative to subject heading: 0 = in front (seeing the face), 90 = subject's right side, 180 = behind. */
        azimuthDeg: z.number().min(-180).max(180),
        orbitDegPerSec: z.number().min(-30).max(30),
        durationSec: z.tuple([Positive, Positive]),
        subject: z.enum(['actor', 'pair_midpoint', 'group_centroid', 'landmark', 'event_position']),
        notes: z.string(),
      }),
    )
    .min(6),
  idleRotation: z.array(StableId).min(1),
  rules: z.array(z.string()).min(3),
});
export type ShotGrammar = z.infer<typeof ShotGrammarSchema>;

export interface GameData {
  region: RegionLayout;
  species: SpeciesProfile[];
  art: ArtDirection;
  narration: NarrationPack;
  shots: ShotGrammar;
}
