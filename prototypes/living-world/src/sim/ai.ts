import type { BehaviorId, Posture } from './ids';
import type { AgentState, Consideration, DecisionOption } from './types';
import type { SpeciesProfile } from '../data/schema';
import { familiarity, rtOf, sampleVeg, speciesOf, type AgentRuntime, type SimState } from './internal';
import { nearestDrink } from './spatial';
import { findDrinkRoute } from './water-navigation';
import { clamp, clamp01, distXZ } from './math';

interface Built {
  considerations: Consideration[];
  /** Multiplier outside the consideration product (activity, gates that are not 0..1 curves). */
  activity: number;
  targetAgent: number | null;
}

interface Cand {
  behavior: BehaviorId;
  score: number;
  considerations: Consideration[];
  targetAgent: number | null;
}

const SURVIVAL = new Set<BehaviorId>(['drink', 'graze', 'forage', 'feed', 'bathe', 'flee', 'stalk', 'chase', 'defend']);

const DURATIONS: Partial<Record<BehaviorId, number>> = {
  idle: 6,
  wander: 16,
  graze: 26,
  forage: 22,
  drink: 14,
  rest: 18,
  sleep: 80,
  bathe: 48,
  seek_company: 12,
  follow: 10,
  socialize: 9,
  play: 11,
  warn: 8,
  court: 12,
  care: 14,
  patrol: 18,
  vigilance: 7,
  flee: 5,
  defend: 7,
  stalk: 18,
  chase: 8,
  feed: 16,
  return_home: 46,
  soar: 24,
  glide: 14,
  perch: 30,
};

/**
 * Utility score = weight × activity × noise × Π curves.
 * Re-evaluated on completion, on a 1–3s stagger, or when an urgent need interrupts.
 */
export function updateDecisions(state: SimState, _physDt: number): void {
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const rt = rtOf(state, agent.id);
    if (rt.lock !== 'none') continue;
    if (agent.interaction || agent.behavior === 'interact') continue;
    const fearNow = agent.needs.fear > 0.62 && agent.behavior !== 'flee' && agent.behavior !== 'defend';
    const urgent =
      fearNow ||
      (agent.needs.cold > 0.62 && agent.behavior !== 'bathe') ||
      (agent.needs.thirst > 0.48 && agent.behavior !== 'drink') ||
      (agent.needs.hunger > 0.9 &&
        agent.behavior !== 'graze' &&
        agent.behavior !== 'forage' &&
        agent.behavior !== 'feed' &&
        agent.behavior !== 'stalk' &&
        agent.behavior !== 'chase') ||
      (agent.needs.social > 0.92 &&
        !SURVIVAL.has(agent.behavior) &&
        agent.behavior !== 'socialize' &&
        agent.behavior !== 'play' &&
        agent.behavior !== 'return_home' &&
        agent.behavior !== 'follow');
    let reason: string | null = null;
    if (fearNow) reason = 'threat perceived';
    else if (urgent && state.physTime >= rt.nextUrgentAt) reason = 'urgent need';
    else if (complete(state, agent, rt)) reason = 'behaviour complete';
    else if (state.physTime + 1e-9 >= rt.nextDecisionAt) reason = 'scheduled';
    if (!reason) continue;
    if (reason === 'urgent need' || reason === 'threat perceived') rt.nextUrgentAt = state.physTime + 1.15;
    evaluateAgent(state, agent, reason);
  }
}

function complete(state: SimState, agent: AgentState, rt: AgentRuntime): boolean {
  const target = agent.intent.target;
  const arrived = target ? distXZ(agent.pos.x, agent.pos.z, target.x, target.z) < 1.8 : false;
  switch (agent.behavior) {
    case 'graze':
    case 'forage':
      return agent.needs.hunger < 0.2 || state.physTime >= rt.behaviorUntil;
    case 'drink': {
      const atWater = target !== null && distXZ(agent.pos.x, agent.pos.z, target.x, target.z) < 1.8;
      return agent.needs.thirst < 0.12 || (state.physTime >= rt.behaviorUntil && !atWater);
    }
    case 'bathe':
      return agent.needs.cold < 0.14 || state.physTime >= rt.behaviorUntil;
    case 'sleep':
      return agent.needs.fatigue < 0.2 && state.env.dayPhase === 'day';
    case 'rest':
      return agent.needs.fatigue < 0.3 || state.physTime >= rt.behaviorUntil;
    case 'flee':
      return agent.needs.fear < 0.22 || state.physTime >= rt.behaviorUntil;
    case 'wander':
    case 'patrol':
    case 'seek_company':
    case 'return_home':
    case 'follow':
      return arrived || state.physTime >= rt.behaviorUntil;
    default:
      return state.physTime >= rt.behaviorUntil;
  }
}

export function evaluateAgent(state: SimState, agent: AgentState, reason: string): void {
  const sp = speciesOf(state, agent);
  const rt = rtOf(state, agent.id);
  const nearby = gather(state, agent, 48);
  const cands: Cand[] = [];
  for (const behavior of sp.behaviors) {
    if (behavior === 'interact') continue;
    const noise = 0.9 + rt.rng.next() * 0.2;
    const built = scoreBehavior(state, agent, sp, behavior, nearby);
    let score = (sp.utilityWeights[behavior] ?? 1) * built.activity * noise;
    for (const c of built.considerations) score *= c.output;
    if (!Number.isFinite(score) || score < 0) score = 0;
    if (!SURVIVAL.has(behavior)) {
      const pressure = Math.max(
        0,
        (agent.needs.thirst - 0.28) / 0.4,
        (agent.needs.hunger - 0.42) / 0.45,
        (agent.needs.cold - 0.55) / 0.4,
      );
      score *= clamp(1 - pressure, 0.04, 1);
    }
    if (behavior === agent.behavior && reason === 'scheduled') score *= 1.3;
    cands.push({ behavior, score: round4(score), considerations: built.considerations, targetAgent: built.targetAgent });
  }
  if (cands.length === 0) {
    cands.push({ behavior: 'idle', score: 0.1, considerations: [c('baseline', 1, 1)], targetAgent: null });
  }
  cands.sort((a, b) => b.score - a.score || (a.behavior < b.behavior ? -1 : a.behavior > b.behavior ? 1 : 0));
  const best = cands[0];
  const options: DecisionOption[] = cands.slice(0, 8).map((cand) => ({
    behavior: cand.behavior,
    targetAgent: cand.targetAgent,
    score: cand.score,
    considerations: cand.considerations,
  }));
  agent.decision = { at: state.env.time, chosen: best.behavior, options, reason };
  applyBehavior(state, agent, sp, best);
  rt.nextDecisionAt = state.physTime + 1 + rt.rng.next() * 2;
}

function c(name: string, input: number, output: number): Consideration {
  return { name, input: round4(clamp01(input)), output: round4(clamp01(output)) };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function gather(state: SimState, agent: AgentState, radius: number): AgentState[] {
  const out: AgentState[] = [];
  state.spatial.query(agent.pos.x, agent.pos.z, radius, state.nearScratch);
  for (const other of state.nearScratch) {
    if (other.id !== agent.id && other.alive) out.push(other);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function motherOf(state: SimState, agent: AgentState): AgentState | null {
  if (agent.motherId == null) return null;
  const m = state.agentById.get(agent.motherId);
  return m && m.alive ? m : null;
}

function nearestOf(agent: AgentState, list: readonly AgentState[], pred: (o: AgentState) => boolean, max = Infinity): AgentState | null {
  let best: AgentState | null = null;
  let bestD = max;
  for (const other of list) {
    if (!pred(other)) continue;
    const d = distXZ(agent.pos.x, agent.pos.z, other.pos.x, other.pos.z);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

/**
 * Family groups maintain a compact home range around their den. The radius is
 * intentionally species-model driven rather than a per-creature hard-coded
 * target: the small Reedbrush Kit stays close to its den, while herd and flock
 * species are allowed to range more widely.
 */
export function homeRangeRadius(sp: SpeciesProfile): number {
  if (sp.social.model === 'family') return 90;
  if (sp.social.model === 'herd') return 170;
  if (sp.social.model === 'loose_flock') return 260;
  return Number.POSITIVE_INFINITY;
}

export function homeRangePressure(distance: number, radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(distance)) return 0;
  return clamp01((distance - radius * 0.75) / (radius * 0.25));
}

/** Keep exploration goals inside the animal's home range; if already outside, send it home. */
export function constrainHomeRangeTarget(
  home: { x: number; z: number },
  origin: { x: number; z: number },
  target: { x: number; z: number },
  radius: number,
): { x: number; z: number } {
  if (!Number.isFinite(radius) || radius <= 0) return target;
  const originDistance = distXZ(origin.x, origin.z, home.x, home.z);
  if (originDistance > radius) return { x: home.x, z: home.z };
  const dx = target.x - home.x;
  const dz = target.z - home.z;
  const targetDistance = Math.hypot(dx, dz);
  const limit = radius * 0.92;
  if (targetDistance <= limit || targetDistance < 1e-6) return target;
  const scale = limit / targetDistance;
  return { x: home.x + dx * scale, z: home.z + dz * scale };
}

function nightFactor(state: SimState): number {
  switch (state.env.dayPhase) {
    case 'night':
      return 1;
    case 'dusk':
      return 0.92;
    case 'dawn':
      return 0.28;
    default:
      return 0.08;
  }
}

function scoreBehavior(state: SimState, agent: AgentState, sp: SpeciesProfile, behavior: BehaviorId, nearby: readonly AgentState[]): Built {
  const phaseAct = 0.22 + 0.78 * sp.activity[state.env.dayPhase];
  const fear = agent.needs.fear;
  const calm = 1 - fear;
  const mother = motherOf(state, agent);
  switch (behavior) {
    case 'idle':
      return { considerations: [c('baseline', 1, 1), c('calm', calm, 0.35 + 0.65 * calm)], activity: phaseAct * 0.22, targetAgent: null };
    case 'wander': {
      const home = agent.homeId ? state.terrain.getLandmark(agent.homeId) : undefined;
      const range = home ? homeRangeRadius(sp) : Number.POSITIVE_INFINITY;
      const distance = home ? distXZ(agent.pos.x, agent.pos.z, home.x, home.z) : 0;
      const rangePressure = home ? homeRangePressure(distance, range) : 0;
      return {
        considerations: [
          c('curiosity', agent.needs.curiosity, 0.2 + 0.8 * agent.needs.curiosity),
          c('rested', agent.needs.fatigue, 1 - agent.needs.fatigue * 0.75),
          c('calm', fear, calm),
          c('home_range', rangePressure, 1 - rangePressure),
        ],
        activity: phaseAct,
        targetAgent: null,
      };
    }
    case 'graze': {
      if (sp.diet.vegetation < 0.35) return zero(behavior);
      return {
        considerations: [
          c('hunger', agent.needs.hunger, clamp01(0.12 + 0.88 * agent.needs.hunger)),
          c('forage', sampleVeg(state, agent.pos.x, agent.pos.z), 0.35 + 0.65 * sampleVeg(state, agent.pos.x, agent.pos.z)),
          c('calm', fear, 0.25 + 0.75 * calm),
        ],
        activity: phaseAct,
        targetAgent: null,
      };
    }
    case 'forage':
      return {
        considerations: [
          c('hunger', agent.needs.hunger, clamp01(0.1 + 0.9 * agent.needs.hunger)),
          c('diet', sp.diet.vegetation + sp.diet.carrion, clamp01(0.3 + 0.7 * Math.max(sp.diet.vegetation, sp.diet.carrion))),
          c('calm', fear, 0.3 + 0.7 * calm),
        ],
        activity: phaseAct,
        targetAgent: null,
      };
    case 'drink':
      return {
        considerations: [c('thirst', agent.needs.thirst, clamp01((agent.needs.thirst - 0.18) / 0.42)), c('calm', fear, 0.55 + 0.45 * calm)],
        activity: 1.25,
        targetAgent: null,
      };
    case 'rest':
      return {
        considerations: [c('fatigue', agent.needs.fatigue, clamp01((agent.needs.fatigue - 0.28) / 0.72)), c('calm', fear, 0.3 + 0.7 * calm)],
        activity: 0.5 + 0.5 * (1 - phaseAct * 0.3),
        targetAgent: null,
      };
    case 'sleep': {
      const night = state.env.dayPhase === 'night' ? 1 : state.env.dayPhase === 'dusk' ? 0.65 : agent.needs.fatigue;
      return {
        considerations: [c('fatigue', agent.needs.fatigue, clamp01(agent.needs.fatigue * 0.55 + night * 0.45)), c('calm', fear, 0.2 + 0.8 * calm)],
        activity: 0.45 + 0.55 * (1 - sp.activity[state.env.dayPhase]),
        targetAgent: null,
      };
    }
    case 'bathe': {
      if (sp.thermal.hotSpringAffinity <= 0.05) return zero(behavior);
      const spring = nearestSpring(state, agent.pos.x, agent.pos.z);
      return {
        considerations: [
          c('cold', agent.needs.cold, agent.needs.cold),
          c('affinity', sp.thermal.hotSpringAffinity, sp.thermal.hotSpringAffinity),
          c('reachable', spring ? 1 : 0, spring ? 1 : 0),
          c('calm', fear, agent.needs.cold > 0.72 ? 0.74 + 0.26 * calm : 0.4 + 0.6 * calm),
        ],
        activity: 0.7 + 0.3 * phaseAct,
        targetAgent: null,
      };
    }
    case 'seek_company': {
      const pal = nearestOf(agent, nearby, (o) => o.groupId != null && o.groupId === agent.groupId, 40);
      return {
        considerations: [c('social', agent.needs.social, agent.needs.social), c('company', pal ? 1 : 0.25, pal ? 1 : 0.25), c('calm', fear, calm)],
        activity: phaseAct,
        targetAgent: pal?.id ?? null,
      };
    }
    case 'follow': {
      if (agent.lifeStage !== 'juvenile' || !mother) return zero(behavior);
      const d = distXZ(agent.pos.x, agent.pos.z, mother.pos.x, mother.pos.z);
      const pull = clamp01(d / 7);
      return {
        considerations: [c('juvenile', 1, 1), c('distance', pull, 0.82 + 0.18 * pull), c('calm', fear, 0.7 + 0.3 * calm)],
        activity: 2.15,
        targetAgent: mother.id,
      };
    }
    case 'socialize': {
      const pal = nearestOf(
        agent,
        nearby,
        (o) => o.speciesId === agent.speciesId && o.lifeStage !== 'juvenile' && o.behavior !== 'flee' && o.behavior !== 'chase',
        22,
      );
      const fam = pal ? familiarity(state, agent.id, pal.id) : 0;
      return {
        considerations: [
          c('social', agent.needs.social, agent.needs.social),
          c('partner', pal ? 1 : 0, pal ? 0.55 + 0.45 * fam : 0),
          c('calm', fear, calm),
        ],
        activity: phaseAct,
        targetAgent: pal?.id ?? null,
      };
    }
    case 'play': {
      const pal = nearestOf(agent, nearby, (o) => o.speciesId === agent.speciesId && (o.lifeStage === 'juvenile' || speciesOf(state, o).social.playfulness > 0.5), 18);
      const youth = agent.lifeStage === 'juvenile' ? 1 : 0.38;
      return {
        considerations: [
          c('playful', sp.social.playfulness, sp.social.playfulness),
          c('youth', youth, youth),
          c('partner', pal ? 1 : 0.2, pal ? 1 : 0.2),
          c('calm', fear, calm),
        ],
        activity: phaseAct,
        targetAgent: pal?.id ?? null,
      };
    }
    case 'warn': {
      if (!sp.social.territorial || !agent.territory) return zero(behavior);
      const intruder = nearestOf(agent, nearby, (o) => {
        if (o.speciesId !== agent.speciesId || o.groupId === agent.groupId) return false;
        const d = distXZ(o.pos.x, o.pos.z, agent.territory!.x, agent.territory!.z);
        return d < agent.territory!.radius;
      }, agent.territory.radius);
      return {
        considerations: [c('intruder', intruder ? 1 : 0, intruder ? 1 : 0), c('aggression', sp.social.aggression, 0.25 + 0.75 * sp.social.aggression)],
        activity: 0.8 + 0.2 * phaseAct,
        targetAgent: intruder?.id ?? null,
      };
    }
    case 'court': {
      const mate = nearestOf(
        agent,
        nearby,
        (o) => o.speciesId === agent.speciesId && o.sex !== agent.sex && o.lifeStage !== 'juvenile' && o.needs.breeding > 0.25,
        28,
      );
      const ready = agent.lifeStage === 'juvenile' ? 0 : clamp01((agent.needs.breeding - 0.3) / 0.7);
      return {
        considerations: [c('breeding', agent.needs.breeding, ready), c('suitor', mate ? 1 : 0, mate ? 1 : 0), c('calm', fear, calm)],
        activity: phaseAct,
        targetAgent: mate?.id ?? null,
      };
    }
    case 'care': {
      const young = nearestOf(agent, nearby, (o) => o.motherId === agent.id && o.lifeStage === 'juvenile', 16);
      const mom = agent.lifeStage === 'juvenile' ? mother : null;
      const target = young ?? mom;
      return {
        considerations: [c('dependent', target ? 1 : 0, target ? 1 : 0), c('bond', target ? 1 : 0, target ? 0.85 : 0)],
        activity: 1,
        targetAgent: target?.id ?? null,
      };
    }
    case 'patrol':
      return {
        considerations: [
          c('territory', sp.social.territorial ? 1 : 0, sp.social.territorial ? 1 : 0),
          c('sated', agent.needs.hunger, 1 - agent.needs.hunger * 0.8),
          c('calm', fear, 0.4 + 0.6 * calm),
        ],
        activity: phaseAct,
        targetAgent: null,
      };
    case 'vigilance': {
      const recent = agent.memory.lastThreatAt != null && state.env.time - agent.memory.lastThreatAt < 2000 ? 1 : 0.2;
      return {
        considerations: [c('vigilance', sp.antiPredator.vigilance, sp.antiPredator.vigilance), c('alert', Math.max(fear, recent), Math.max(fear, recent * 0.55))],
        activity: 0.6 + 0.4 * phaseAct,
        targetAgent: agent.memory.lastThreatId,
      };
    }
    case 'flee': {
      const withMother = agent.lifeStage === 'juvenile' && mother != null;
      return {
        considerations: [c('fear', fear, fear * fear * (withMother ? 0.4 : 1))],
        activity: withMother ? 0.7 : 1.15,
        targetAgent: agent.memory.lastThreatId,
      };
    }
    case 'defend': {
      // Defensive cohesion is important, but a herd member at physiological
      // limits must yield the line and seek water / food. Otherwise adults can
      // keep re-selecting defend while dehydrating in front of a predator.
      const lifeCritical =
        agent.needs.thirst >= 0.82 ||
        agent.needs.hunger >= 0.96 ||
        agent.needs.health <= 0.28 ||
        agent.needs.stamina <= 0.12;
      const can =
        sp.antiPredator.herdDefense &&
        agent.lifeStage !== 'juvenile' &&
        fear > 0.22 &&
        !lifeCritical
          ? 1
          : 0;
      return {
        considerations: [
          c('duty', can, can),
          c('fear', fear, fear),
          c('physical_condition', lifeCritical ? 0 : 1, lifeCritical ? 0 : 1),
        ],
        activity: 1,
        targetAgent: agent.memory.lastThreatId,
      };
    }
    case 'stalk': {
      if (!sp.predation) return zero(behavior);
      const prey = nearestPrey(state, agent, sp, nearby);
      const eager = clamp01((agent.needs.hunger - 0.35) / 0.65);
      return {
        considerations: [c('hunger', agent.needs.hunger, eager), c('prey', prey ? 1 : 0, prey ? 1 : 0)],
        activity: 0.55 + 0.45 * phaseAct,
        targetAgent: prey?.id ?? null,
      };
    }
    case 'chase':
      return zero(behavior);
    case 'feed': {
      const carcass = nearestCarcass(state, agent, 30);
      const like = Math.max(sp.diet.carrion, sp.diet.meat);
      return {
        considerations: [
          c('hunger', agent.needs.hunger, agent.needs.hunger),
          c('carcass', carcass ? 1 : 0, carcass ? 1 : 0),
          c('carrion', like, like),
        ],
        activity: phaseAct,
        targetAgent: null,
      };
    }
    case 'return_home': {
      const home = agent.homeId ? state.terrain.getLandmark(agent.homeId) : undefined;
      if (!home) return zero(behavior);
      const d = distXZ(agent.pos.x, agent.pos.z, home.x, home.z);
      const range = homeRangeRadius(sp);
      const away = homeRangePressure(d, range);
      const night = nightFactor(state);
      const socialEncounterNearby = agent.needs.social > 0.3 && nearby.some((other) =>
        other.alive &&
        other.speciesId === agent.speciesId &&
        distXZ(agent.pos.x, agent.pos.z, other.pos.x, other.pos.z) < 12,
      );
      // A family member temporarily defers returning home to assess nearby
      // conspecific encounters, including strangers. Consent / familiarity
      // still determines whether contact is accepted. Nightfall gathers the
      // group back to its den after the encounter resolves.
      const urgency = socialEncounterNearby ? night : Math.max(away, night);
      return {
        considerations: [
          c('home_range', urgency, 0.25 + 0.75 * urgency),
          c('calm', fear, 0.55 + 0.45 * calm),
        ],
        activity: 0.85 + 0.15 * urgency,
        targetAgent: null,
      };
    }
    case 'soar': {
      if (!sp.locomotion.flight) return zero(behavior);
      return {
        considerations: [
          c('light', sp.activity[state.env.dayPhase], 0.25 + 0.75 * sp.activity[state.env.dayPhase]),
          c('calm', fear, calm),
          c('hunger', agent.needs.hunger, 1 - agent.needs.hunger * 0.65),
        ],
        activity: phaseAct,
        targetAgent: null,
      };
    }
    case 'glide': {
      if (!sp.locomotion.flight) return zero(behavior);
      return {
        considerations: [c('fatigue', agent.needs.fatigue, 0.35 + 0.65 * agent.needs.fatigue), c('calm', fear, calm)],
        activity: phaseAct * 0.65,
        targetAgent: null,
      };
    }
    case 'perch': {
      if (!sp.locomotion.flight) return zero(behavior);
      const night = nightFactor(state);
      return {
        considerations: [c('night', night, 0.25 + 0.75 * night), c('fatigue', agent.needs.fatigue, 0.3 + 0.7 * agent.needs.fatigue)],
        activity: 0.4 + 0.6 * (1 - sp.activity[state.env.dayPhase]),
        targetAgent: null,
      };
    }
    default:
      return zero(behavior);
  }
}

function zero(_behavior: BehaviorId): Built {
  return { considerations: [c('available', 0, 0)], activity: 1, targetAgent: null };
}

function nearestPrey(state: SimState, agent: AgentState, sp: SpeciesProfile, nearby: readonly AgentState[]): AgentState | null {
  const prey = sp.predation?.prey ?? [];
  let best: AgentState | null = null;
  let bestD = sp.senses.sightRange;
  const ids = new Set(nearby.map((o) => o.id));
  for (const id of rtOf(state, agent.id).visible) ids.add(id);
  for (const id of ids) {
    const other = state.agentById.get(id);
    if (!other || !other.alive || !prey.includes(other.speciesId)) continue;
    const d = distXZ(agent.pos.x, agent.pos.z, other.pos.x, other.pos.z);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function nearestCarcass(state: SimState, agent: AgentState, max: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = max;
  for (const carcass of state.carcasses) {
    if (carcass.remaining < 0.05 || carcass.agentId === agent.id) continue;
    const d = distXZ(agent.pos.x, agent.pos.z, carcass.pos.x, carcass.pos.z);
    if (d < bestD) {
      bestD = d;
      best = { x: carcass.pos.x, z: carcass.pos.z };
    }
  }
  return best;
}

function nearestSpring(state: SimState, x: number, z: number) {
  let best: (typeof state.terrain.pools)[number] | null = null;
  let bestD = Infinity;
  for (const pool of state.terrain.pools) {
    if (pool.kind !== 'hot_spring') continue;
    const d = distXZ(x, z, pool.x, pool.z);
    if (d < bestD) {
      bestD = d;
      best = pool;
    }
  }
  return best;
}

const POSTURE: Record<BehaviorId, Posture> = {
  idle: 'stand',
  wander: 'stand',
  graze: 'stand',
  forage: 'stand',
  drink: 'stand',
  rest: 'lie',
  sleep: 'sleep',
  bathe: 'bathe',
  seek_company: 'stand',
  follow: 'stand',
  socialize: 'stand',
  play: 'stand',
  warn: 'stand',
  court: 'stand',
  care: 'stand',
  patrol: 'stand',
  vigilance: 'stand',
  flee: 'stand',
  defend: 'stand',
  stalk: 'crouch',
  chase: 'stand',
  feed: 'crouch',
  return_home: 'stand',
  soar: 'airborne',
  glide: 'airborne',
  perch: 'perch',
  interact: 'stand',
};

function applyBehavior(state: SimState, agent: AgentState, sp: SpeciesProfile, best: Cand): void {
  const rt = rtOf(state, agent.id);
  const behavior = best.behavior;
  if (behavior !== 'drink') {
    rt.waterPath = [];
    rt.waterPathIndex = 0;
  }
  agent.behavior = behavior;
  agent.behaviorStartedAt = state.env.time;
  agent.posture = POSTURE[behavior];
  rt.behaviorUntil = state.physTime + (DURATIONS[behavior] ?? 12);
  const targetAgent = best.targetAgent;
  let target: { x: number; z: number } | null = null;
  let place: string | null = null;

  if (behavior === 'follow' && targetAgent != null) {
    const m = state.agentById.get(targetAgent);
    if (m) target = { x: m.pos.x, z: m.pos.z };
  } else if (behavior === 'flee') {
    const t = agent.memory.lastThreatPos;
    if (t) {
      const dx = agent.pos.x - t.x;
      const dz = agent.pos.z - t.z;
      const d = Math.hypot(dx, dz) || 1;
      target = { x: agent.pos.x + (dx / d) * 24, z: agent.pos.z + (dz / d) * 24 };
    }
  } else if (behavior === 'defend' && agent.memory.lastThreatPos) {
    target = { x: agent.memory.lastThreatPos.x, z: agent.memory.lastThreatPos.z };
  } else if (behavior === 'graze' || behavior === 'forage') {
    target = forageTarget(state, agent);
  } else if (behavior === 'drink') {
    if (sp.locomotion.flight) {
      // Flyers travel directly to a safe bank, then make a controlled descent.
      const bankSlope = Math.min(sp.locomotion.maxSlopeDeg, 40);
      const nearest = nearestDrink(state, agent.pos.x, agent.pos.z, bankSlope);
      const remembered = agent.memory.water;
      target = nearest ?? (
        remembered && state.terrain.isWalkable(remembered.x, remembered.z, bankSlope, 0.35)
          ? remembered
          : null
      );
      rt.waterPath = target ? [target] : [];
      rt.waterPathIndex = 0;
      if (target) {
        agent.memory.water = target;
        const distance = distXZ(agent.pos.x, agent.pos.z, target.x, target.z);
        if (rt.altitude > 0.35 || distance > sp.locomotion.flight.takeoffDistance * 1.5) {
          agent.posture = 'airborne';
          agent.flightMode = rt.altitude < 2.2 ? 'takeoff' : 'flap';
        }
      }
    } else {
      const route = findDrinkRoute(
        state.terrain,
        state.drinkSpots,
        { x: agent.pos.x, z: agent.pos.z },
        sp.locomotion.maxSlopeDeg,
        sp.body.radius * agent.scale,
      );
      if (route) {
        target = route.target;
        agent.memory.water = route.target;
        rt.waterPath = route.waypoints;
        rt.waterPathIndex = 0;
      } else {
        const nearest = nearestDrink(state, agent.pos.x, agent.pos.z, sp.locomotion.maxSlopeDeg);
        const remembered = agent.memory.water;
        target = nearest ?? (
          remembered && state.terrain.isWalkable(remembered.x, remembered.z, sp.locomotion.maxSlopeDeg, 0.35)
            ? remembered
            : null
        );
        rt.waterPath = [];
        rt.waterPathIndex = 0;
        if (target) agent.memory.water = target;
      }
    }
  } else if (behavior === 'bathe') {
    const spring = nearestSpring(state, agent.pos.x, agent.pos.z);
    if (spring) {
      const ang = (agent.id * 1.7) % (Math.PI * 2);
      target = { x: spring.x + Math.sin(ang) * spring.radius * 0.42, z: spring.z + Math.cos(ang) * spring.radius * 0.42 };
      place = spring.id;
    }
  } else if (behavior === 'return_home' || behavior === 'sleep' || behavior === 'rest') {
    const home = agent.homeId ? state.terrain.getLandmark(agent.homeId) : undefined;
    if (home && (behavior === 'return_home' || state.env.dayPhase === 'dusk' || state.env.dayPhase === 'night')) {
      target = { x: home.x, z: home.z };
      place = home.id;
    }
  } else if (behavior === 'patrol' && agent.territory) {
    const ang = agent.heading + 0.9 + (agent.id % 5) * 0.3;
    const rad = agent.territory.radius * 0.45;
    target = { x: agent.territory.x + Math.sin(ang) * rad, z: agent.territory.z + Math.cos(ang) * rad };
  } else if (behavior === 'wander' || behavior === 'seek_company') {
    if (behavior === 'seek_company' && targetAgent != null) {
      const pal = state.agentById.get(targetAgent);
      if (pal) target = { x: pal.pos.x, z: pal.pos.z };
    }
    if (!target) {
      const angle = agent.heading + 0.7 + (agent.id % 8) * 0.35;
      const distance = 8 + (agent.id % 5) * 2.5;
      target = { x: agent.pos.x + Math.sin(angle) * distance, z: agent.pos.z + Math.cos(angle) * distance };
    }
    const home = agent.homeId ? state.terrain.getLandmark(agent.homeId) : undefined;
    if (home) {
      target = constrainHomeRangeTarget(home, agent.pos, target, homeRangeRadius(sp));
      if (distXZ(target.x, target.z, home.x, home.z) < 1.5) place = home.id;
    }
  } else if (behavior === 'stalk' && targetAgent != null) {
    const prey = state.agentById.get(targetAgent);
    if (prey) target = { x: prey.pos.x, z: prey.pos.z };
  } else if (behavior === 'feed') {
    target = nearestCarcass(state, agent, 40);
  } else if (behavior === 'soar' || behavior === 'glide' || behavior === 'perch') {
    const spring = nearestSpring(state, agent.pos.x, agent.pos.z);
    const roost = agent.homeId ? state.terrain.getLandmark(agent.homeId) : undefined;
    if (behavior === 'perch' && roost) {
      target = { x: roost.x, z: roost.z };
      place = roost.id;
      agent.posture = rt.altitude > 1.5 ? 'airborne' : 'perch';
    } else if (spring) {
      target = { x: spring.x, z: spring.z };
      place = spring.id;
    } else if (roost) {
      target = { x: roost.x, z: roost.z };
      place = roost.id;
    }
    if (behavior !== 'perch') {
      agent.posture = 'airborne';
      agent.flightMode = rt.altitude < 2 ? 'takeoff' : 'flap';
    }
  } else if (targetAgent != null) {
    const other = state.agentById.get(targetAgent);
    if (other) target = { x: other.pos.x, z: other.pos.z };
  }

  if (target) {
    const clamped = state.terrain.clampToBounds(target.x, target.z, 4);
    target = clamped;
  }
  agent.intent = { behavior, target, targetAgent, place };
  if (targetAgent != null) {
    const other = state.agentById.get(targetAgent);
    if (other) {
      const osp = speciesOf(state, other);
      agent.lookAt = {
        x: other.pos.x,
        y: other.pos.y + osp.body.headHeight * other.scale,
        z: other.pos.z,
      };
    }
  } else if (target) {
    agent.lookAt = { x: target.x, y: agent.pos.y + sp.body.headHeight * agent.scale, z: target.z };
  } else agent.lookAt = null;

  if (behavior === 'warn') agent.vocalization = { kind: 'growl', until: state.env.time + state.config.clockScale * 2 };
  else if (behavior === 'court') agent.vocalization = { kind: 'call', until: state.env.time + state.config.clockScale * 2 };
  else if (behavior === 'play') agent.vocalization = { kind: 'chirp', until: state.env.time + state.config.clockScale * 1.5 };
}

function forageTarget(state: SimState, agent: AgentState): { x: number; z: number } | null {
  const here = sampleVeg(state, agent.pos.x, agent.pos.z);
  if (here > 0.4) {
    agent.memory.food = { x: agent.pos.x, z: agent.pos.z };
    return null;
  }
  let best = agent.memory.food;
  let bestV = best ? sampleVeg(state, best.x, best.z) : here;
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const x = agent.pos.x + Math.sin(ang) * 9;
    const z = agent.pos.z + Math.cos(ang) * 9;
    if (!state.terrain.inBounds(x, z, 4)) continue;
    const v = sampleVeg(state, x, z);
    if (v > bestV) {
      bestV = v;
      best = { x, z };
    }
  }
  if (best && bestV > here + 0.05) {
    agent.memory.food = best;
    return best;
  }
  return best;
}
