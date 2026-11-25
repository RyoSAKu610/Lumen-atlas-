import type { AgentState } from './types';
import type { SpeciesProfile } from '../data/schema';
import { rtOf, speciesOf, type HuntState, type SimState } from './internal';
import { emit } from './journal';
import { killAgent, removeSpentCarcasses } from './lifecycle';
import { distXZ } from './math';

const HUNGER_TO_HUNT = 0.62;
const MAX_HUNTS_PER_DAY = 2;
const DAY = 86400;

/**
 * Search → stalk (crouch, downwind) → chase → seeded strike.
 * Herd adults can abort. About 1–3 hunt starts per game day.
 */
export function updatePredation(state: SimState, physDt: number): void {
  if (state.huntDay !== state.env.day) {
    state.huntDay = state.env.day;
    state.huntsToday = 0;
  }
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const rt = rtOf(state, agent.id);
    if (rt.lock === 'feed' && state.physTime >= rt.feedUntil) {
      rt.lock = 'none';
      if (agent.behavior === 'feed') agent.behavior = 'idle';
      rt.nextDecisionAt = state.physTime;
    }
  }

  const keep: HuntState[] = [];
  for (const hunt of state.hunts) {
    const pred = state.agentById.get(hunt.predatorId);
    const prey = state.agentById.get(hunt.preyId);
    if (!pred || !prey || !pred.alive || !prey.alive) {
      if (pred?.alive) releaseHunter(state, pred, false);
      continue;
    }
    const sp = speciesOf(state, pred);
    const huntSpec = sp.predation;
    if (!huntSpec) {
      releaseHunter(state, pred, false);
      continue;
    }
    const defender = findDefender(state, prey, pred);
    const gap = distXZ(pred.pos.x, pred.pos.z, prey.pos.x, prey.pos.z);
    if (defender && gap < 22) {
      emit(state, 'herd.defense', [defender.id, prey.id, pred.id], { x: prey.pos.x, z: prey.pos.z }, { prey: prey.speciesId }, 0.8);
      emit(state, 'hunt.aborted', [pred.id, prey.id], { x: pred.pos.x, z: pred.pos.z }, { reason: 'herd' }, 0.75);
      pred.needs.fear = Math.min(1, pred.needs.fear + 0.75);
      pred.memory.lastThreatAt = state.env.time;
      pred.memory.lastThreatId = defender.id;
      pred.memory.lastThreatPos = { x: defender.pos.x, z: defender.pos.z };
      defender.behavior = 'defend';
      defender.intent = { behavior: 'defend', target: { x: pred.pos.x, z: pred.pos.z }, targetAgent: pred.id, place: null };
      defender.posture = 'stand';
      const drt = rtOf(state, defender.id);
      drt.behaviorUntil = state.physTime + 6;
      drt.nextDecisionAt = state.physTime + 6;
      releaseHunter(state, pred, true);
      continue;
    }

    if (hunt.phase === 'stalk') {
      pred.behavior = 'stalk';
      pred.posture = 'crouch';
      const wx = Math.sin(state.env.wind.direction);
      const wz = Math.cos(state.env.wind.direction);
      const lead = gap > 10 ? Math.min(gap * 0.55, 14) : 0;
      pred.intent = {
        behavior: 'stalk',
        target: { x: prey.pos.x + wx * lead, z: prey.pos.z + wz * lead },
        targetAgent: prey.id,
        place: null,
      };
      pred.lookAt = { x: prey.pos.x, y: prey.pos.y + speciesOf(state, prey).body.headHeight * prey.scale, z: prey.pos.z };
      const cover = state.terrain.coverAt(pred.pos.x, pred.pos.z);
      const preySp = speciesOf(state, prey);
      const detect = preySp.antiPredator.fleeDistance * (0.42 + 0.5 * (1 - cover * 0.65));
      const stalkedFor = state.physTime - hunt.startedPhys;
      if (gap < detect || gap < huntSpec.attackRange * 1.45) {
        beginChase(state, hunt, pred, prey);
      } else if (stalkedFor > 40 && gap > 25) {
        emit(state, 'hunt.failed', [pred.id, prey.id], { x: pred.pos.x, z: pred.pos.z }, { reason: 'lost' }, 0.5);
        releaseHunter(state, pred, false);
        continue;
      }
    }

    if (hunt.phase === 'chase') {
      pred.behavior = 'chase';
      pred.posture = 'stand';
      pred.intent = { behavior: 'chase', target: { x: prey.pos.x, z: prey.pos.z }, targetAgent: prey.id, place: null };
      pred.lookAt = { x: prey.pos.x, y: prey.pos.y + speciesOf(state, prey).body.headHeight * prey.scale, z: prey.pos.z };
      const chased = state.physTime - hunt.chaseStartPhys;
      if (gap <= huntSpec.attackRange && state.physTime - hunt.lastStrikePhys >= 0.75) {
        hunt.lastStrikePhys = state.physTime;
        if (strike(state, pred, prey, sp)) {
          succeed(state, pred, prey, sp);
          continue;
        }
        hunt.misses += 1;
        const giveUpStrikes = isIsolated(state, prey) && prey.lifeStage === 'juvenile' ? 6 : 2;
        if (hunt.misses >= giveUpStrikes) {
          emit(state, 'hunt.failed', [pred.id, prey.id], { x: pred.pos.x, z: pred.pos.z }, { reason: 'evaded' }, 0.5);
          releaseHunter(state, pred, false);
          continue;
        }
      }
      if (chased > huntSpec.chaseMaxSeconds || gap > huntSpec.giveUpDistance) {
        emit(state, 'hunt.failed', [pred.id, prey.id], { x: pred.pos.x, z: pred.pos.z }, { reason: chased > huntSpec.chaseMaxSeconds ? 'timeout' : 'distance' }, 0.5);
        releaseHunter(state, pred, false);
        continue;
      }
    }
    keep.push(hunt);
  }
  state.hunts = keep;

  if (state.huntsToday >= MAX_HUNTS_PER_DAY) {
    void physDt;
    return;
  }
  const hunting = new Set(state.hunts.map((h) => h.predatorId));
  const hunted = new Set(state.hunts.map((h) => h.preyId));
  for (const pred of state.agents) {
    if (state.huntsToday >= MAX_HUNTS_PER_DAY) break;
    if (!pred.alive || hunting.has(pred.id) || pred.interaction) continue;
    const sp = speciesOf(state, pred);
    if (!sp.predation) continue;
    if (pred.needs.hunger < HUNGER_TO_HUNT) continue;
    const rt = rtOf(state, pred.id);
    if (rt.lock !== 'none') continue;
    if (state.env.time < rt.huntCooldownUntil) continue;
    const prey = selectPrey(state, pred, sp, hunted);
    if (!prey) continue;
    const hunt: HuntState = {
      predatorId: pred.id,
      preyId: prey.id,
      phase: 'stalk',
      startedPhys: state.physTime,
      chaseStartPhys: state.physTime,
      lastStrikePhys: -999,
      misses: 0,
    };
    state.hunts.push(hunt);
    hunting.add(pred.id);
    hunted.add(prey.id);
    rt.lock = 'hunt';
    pred.behavior = 'stalk';
    pred.posture = 'crouch';
    pred.stats.huntsAttempted += 1;
    state.huntsToday += 1;
    emit(state, 'hunt.stalk_started', [pred.id, prey.id], { x: pred.pos.x, z: pred.pos.z }, { prey: prey.speciesId }, 0.55);
  }
  void physDt;
}

function beginChase(state: SimState, hunt: HuntState, pred: AgentState, prey: AgentState): void {
  if (hunt.phase === 'chase') return;
  hunt.phase = 'chase';
  hunt.chaseStartPhys = state.physTime;
  hunt.lastStrikePhys = -999;
  pred.behavior = 'chase';
  emit(state, 'hunt.chase_started', [pred.id, prey.id], { x: pred.pos.x, z: pred.pos.z }, { prey: prey.speciesId }, 0.7);
  prey.needs.fear = Math.min(1, prey.needs.fear + 0.85);
  prey.memory.lastThreatAt = state.env.time;
  prey.memory.lastThreatId = pred.id;
  prey.memory.lastThreatPos = { x: pred.pos.x, z: pred.pos.z };
  const psp = speciesOf(state, prey);
  if (psp.antiPredator.alarmCall) {
    prey.vocalization = { kind: 'alarm', until: state.env.time + state.config.clockScale * 3 };
    const rt = rtOf(state, prey.id);
    if (state.physTime - rt.lastAlarmAt > 8) {
      rt.lastAlarmAt = state.physTime;
      emit(state, 'alarm.raised', [prey.id, pred.id], { x: prey.pos.x, z: prey.pos.z }, { threat: pred.speciesId }, 0.65);
    }
  }
}

function selectPrey(state: SimState, pred: AgentState, sp: SpeciesProfile, hunted: Set<number>): AgentState | null {
  const spec = sp.predation;
  if (!spec) return null;
  const found: AgentState[] = [];
  state.spatial.query(pred.pos.x, pred.pos.z, sp.senses.sightRange, state.nearScratch);
  for (const other of state.nearScratch) found.push(other);
  found.sort((a, b) => a.id - b.id);
  let best: AgentState | null = null;
  let bestScore = 0.15;
  for (const other of found) {
    if (!other.alive || other.id === pred.id || hunted.has(other.id)) continue;
    if (!spec.prey.includes(other.speciesId)) continue;
    const d = distXZ(pred.pos.x, pred.pos.z, other.pos.x, other.pos.z);
    let score = 1 - d / sp.senses.sightRange;
    if (other.lifeStage === 'juvenile') score += spec.preferVulnerable;
    if (other.needs.health < 0.5) score += 0.25;
    if (findDefender(state, other, pred)) score -= 0.55;
    if (score > bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

function findDefender(state: SimState, prey: AgentState, pred: AgentState): AgentState | null {
  state.spatial.query(prey.pos.x, prey.pos.z, 16, state.nearScratch);
  let best: AgentState | null = null;
  let bestD = Infinity;
  for (const other of state.nearScratch) {
    if (!other.alive || other.id === pred.id || other.id === prey.id) continue;
    if (other.lifeStage === 'juvenile') continue;
    const sp = speciesOf(state, other);
    if (!sp.antiPredator.herdDefense) continue;
    const d = distXZ(other.pos.x, other.pos.z, pred.pos.x, pred.pos.z);
    if (d > 28) continue;
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function strike(state: SimState, pred: AgentState, prey: AgentState, sp: SpeciesProfile): boolean {
  const spec = sp.predation;
  if (!spec) return false;
  let p = spec.baseSuccess;
  if (prey.lifeStage === 'juvenile') p += 0.12 * spec.preferVulnerable;
  if (prey.needs.health < 0.45) p += 0.08;
  if (isIsolated(state, prey)) p += 0.52;
  if (prey.speciesId === 'giant_grazer') p *= prey.lifeStage === 'juvenile' ? 0.4 : 0.12;
  if (p < 0.04) p = 0.04;
  if (p > 0.96) p = 0.96;
  return rtOf(state, pred.id).rng.next() < p;
}

function isIsolated(state: SimState, prey: AgentState): boolean {
  state.spatial.query(prey.pos.x, prey.pos.z, 16, state.nearScratch);
  for (const other of state.nearScratch) {
    if (other.id === prey.id || !other.alive) continue;
    const sp = speciesOf(state, other);
    if (sp.antiPredator.herdDefense && other.lifeStage !== 'juvenile') return false;
    if (other.speciesId === prey.speciesId && other.lifeStage !== 'juvenile' && distXZ(other.pos.x, other.pos.z, prey.pos.x, prey.pos.z) < 8) {
      return false;
    }
  }
  return true;
}

function succeed(state: SimState, pred: AgentState, prey: AgentState, sp: SpeciesProfile): void {
  const spec = sp.predation!;
  killAgent(state, prey, 'predation');
  pred.needs.hunger = Math.max(0, pred.needs.hunger - spec.mealSize);
  pred.stats.huntsSucceeded += 1;
  pred.stats.meals += 1;
  pred.behavior = 'feed';
  pred.posture = 'crouch';
  pred.intent = { behavior: 'feed', target: { x: prey.pos.x, z: prey.pos.z }, targetAgent: null, place: null };
  const rt = rtOf(state, pred.id);
  rt.lock = 'feed';
  rt.feedUntil = state.physTime + 12;
  rt.huntCooldownUntil = state.env.time + 0.5 * DAY;
  const carcass = state.carcasses.find((c) => c.agentId === prey.id);
  if (carcass) carcass.remaining = Math.max(0.15, carcass.remaining - 0.35);
  emit(state, 'hunt.succeeded', [pred.id, prey.id], { x: prey.pos.x, z: prey.pos.z }, { prey: prey.speciesId, cause: 'predation' }, 0.95);
}

function releaseHunter(state: SimState, pred: AgentState, flee: boolean): void {
  const rt = rtOf(state, pred.id);
  rt.lock = 'none';
  rt.huntCooldownUntil = state.env.time + (flee ? 0.2 : 0.12) * DAY;
  pred.behavior = flee ? 'flee' : 'idle';
  pred.posture = 'stand';
  pred.intent = { behavior: pred.behavior, target: pred.memory.lastThreatPos, targetAgent: pred.memory.lastThreatId, place: null };
  rt.nextDecisionAt = state.physTime;
  rt.behaviorUntil = state.physTime + (flee ? 5 : 2);
}

export function updateScavenge(state: SimState, gameDt: number): void {
  const hours = gameDt / 3600;
  for (const carcass of state.carcasses) carcass.remaining -= 0.02 * hours;
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const sp = speciesOf(state, agent);
    if (sp.diet.carrion < 0.25 || agent.needs.hunger < 0.4) continue;
    if (agent.behavior === 'flee' || agent.behavior === 'chase' || agent.behavior === 'stalk') continue;
    const rt = rtOf(state, agent.id);
    if (rt.lock === 'hunt') continue;
    let best: (typeof state.carcasses)[number] | null = null;
    let bestD = 14;
    for (const carcass of state.carcasses) {
      if (carcass.remaining < 0.04 || carcass.agentId === agent.id) continue;
      const d = distXZ(agent.pos.x, agent.pos.z, carcass.pos.x, carcass.pos.z);
      if (d < bestD) {
        bestD = d;
        best = carcass;
      }
    }
    if (!best) continue;
    if (bestD > 1.7) {
      if (agent.needs.hunger > 0.55 && (agent.behavior === 'forage' || agent.behavior === 'wander' || agent.behavior === 'feed' || agent.behavior === 'soar' || agent.behavior === 'glide' || agent.behavior === 'idle')) {
        agent.behavior = 'feed';
        agent.posture = 'stand';
        agent.intent = { behavior: 'feed', target: { x: best.pos.x, z: best.pos.z }, targetAgent: null, place: null };
      }
      continue;
    }
    agent.behavior = 'feed';
    agent.posture = 'crouch';
    agent.speed = 0;
    const bite = Math.min(best.remaining, (0.35 + sp.diet.carrion) * hours);
    best.remaining -= bite;
    agent.needs.hunger = Math.max(0, agent.needs.hunger - bite * (0.8 + sp.diet.feedRatePerHour));
    if (!rt.scavenged.includes(best.id)) {
      rt.scavenged.push(best.id);
      agent.stats.meals += 1;
      emit(state, 'carcass.scavenged', [agent.id], { x: best.pos.x, z: best.pos.z }, { species: best.speciesId, carcass: best.id }, 0.45);
    }
  }
  removeSpentCarcasses(state);
}
