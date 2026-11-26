import { INTERACTION_PHASES, type InteractionKind, type InteractionOutcome, type InteractionPhase, type Vocalization } from './ids';
import type { AgentState, InteractionState } from './types';
import type { SpeciesProfile } from '../data/schema';
import { ensureRel, familiarity, speciesOf, type SimState } from './internal';
import { emit } from './journal';
import { distXZ } from './math';

const PHASE_TIME: Record<InteractionPhase, number> = {
  approach: 7,
  orient: 0.55,
  signal: 0.7,
  response: 0.4,
  contact: 1.7,
  resolve: 0.35,
  cooldown: 0.55,
  separate: 0.75,
};

/** Approach → orient → signal → response → contact → resolve → cooldown → separate. */
export function updateInteractions(state: SimState, physDt: number): void {
  const remove = new Set<number>();
  for (const inter of state.interactions) {
    const a = state.agentById.get(inter.initiator);
    const b = state.agentById.get(inter.responder);
    if (!a || !b || !a.alive || !b.alive) {
      interrupt(state, inter, !a || !b ? 'missing' : 'partner dead');
      remove.add(inter.id);
      continue;
    }
    if (a.needs.fear >= 0.72 || b.needs.fear >= 0.72) {
      interrupt(state, inter, 'threat');
      remove.add(inter.id);
      continue;
    }
    if (a.needs.thirst >= 0.8 || b.needs.thirst >= 0.8 || a.needs.hunger >= 0.9 || b.needs.hunger >= 0.9) {
      interrupt(state, inter, 'need');
      remove.add(inter.id);
      continue;
    }
    let budget = physDt;
    let guard = 0;
    while (budget > 1e-6 && guard++ < 8 && !remove.has(inter.id)) {
      applyPhaseMotion(state, inter, a, b);
      syncRefs(state, inter, a, b);
      if (inter.phase === 'approach') {
        const reach = meetDistance(state, a, b);
        const d = distXZ(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
        const step = Math.min(budget, Math.max(0, inter.phaseDuration - inter.phaseTime));
        inter.phaseTime += step;
        budget -= step;
        if (d <= reach || inter.phaseTime >= inter.phaseDuration - 1e-6) {
          if (advance(state, inter, a, b)) remove.add(inter.id);
          continue;
        }
        break;
      }
      const need = inter.phaseDuration - inter.phaseTime;
      if (budget < need) {
        inter.phaseTime += budget;
        break;
      }
      budget -= Math.max(0, need);
      if (advance(state, inter, a, b)) remove.add(inter.id);
    }
  }
  if (remove.size) state.interactions = state.interactions.filter((i) => !remove.has(i.id));
  maybeStart(state);
}

function maybeStart(state: SimState): void {
  const busy = new Set<number>();
  for (const inter of state.interactions) {
    busy.add(inter.initiator);
    busy.add(inter.responder);
  }
  for (const agent of state.agents) {
    if (!agent.alive || busy.has(agent.id) || agent.interaction) continue;
    const rt = state.runtime.get(agent.id);
    if (rt && rt.lock !== 'none') continue;
    if (agent.needs.thirst > 0.42 || agent.needs.hunger > 0.55 || agent.needs.cold > 0.6) continue;
    const kind = kindFor(state, agent);
    if (!kind) continue;
    const tid = agent.intent.targetAgent;
    if (tid == null || tid === agent.id || busy.has(tid)) continue;
    const other = state.agentById.get(tid);
    if (!other || !other.alive || other.interaction) continue;
    if (other.behavior === 'flee' || other.behavior === 'chase' || other.behavior === 'stalk') continue;
    if (other.needs.fear >= 0.7) continue;
    const same = other.speciesId === agent.speciesId;
    if (!same && kind !== 'warn') continue;
    if (kind === 'nurse') {
      const kin = state.relationships.get(other.id)?.get(agent.id)?.kin;
      if (kin !== 'parent' && kin !== 'offspring') continue;
    }
    const d = distXZ(agent.pos.x, agent.pos.z, other.pos.x, other.pos.z);
    const reach = meetDistance(state, agent, other);
    if (d > Math.max(8, reach * 3.2)) continue;
    const inter: InteractionState = {
      id: state.nextInteractionId++,
      kind,
      initiator: agent.id,
      responder: other.id,
      phase: 'approach',
      phaseTime: 0,
      phaseDuration: PHASE_TIME.approach,
      startedAt: state.env.time,
      response: null,
      outcome: null,
      interruptReason: null,
      contactPoint: null,
    };
    state.interactions.push(inter);
    busy.add(agent.id);
    busy.add(other.id);
    agent.behavior = 'interact';
    other.behavior = 'interact';
    syncRefs(state, inter, agent, other);
    emit(state, 'interaction.started', [agent.id, other.id], midpoint(agent, other), { kind }, 0.4);
  }
}

function kindFor(state: SimState, agent: AgentState): InteractionKind | null {
  switch (agent.behavior) {
    case 'seek_company':
      return agent.intent.targetAgent != null ? 'greet' : null;
    case 'socialize': {
      const otherId = agent.intent.targetAgent;
      if (otherId == null) return 'greet';
      const fam = familiarity(state, agent.id, otherId);
      return fam > 0.62 && agent.needs.fatigue > 0.55 ? 'groom' : 'greet';
    }
    case 'play':
      return 'play';
    case 'court':
      return 'court';
    case 'warn':
      return 'warn';
    case 'care':
      return 'nurse';
    default:
      return null;
  }
}

function meetDistance(state: SimState, a: AgentState, b: AgentState): number {
  const sa = speciesOf(state, a);
  const sb = speciesOf(state, b);
  return Math.max(1.05, sa.body.radius * a.scale * 0.55 + sb.body.radius * b.scale * 0.55 + 0.55);
}

/** @returns true when the interaction has ended. */
function advance(state: SimState, inter: InteractionState, a: AgentState, b: AgentState): boolean {
  const order = INTERACTION_PHASES;
  let i = order.indexOf(inter.phase) + 1;
  if ((inter.response === 'ignore' || inter.response === 'reject') && order[i] === 'contact') i++;
  if (i >= order.length) {
    release(state, inter, a, b);
    return true;
  }
  enter(state, inter, order[i], a, b);
  return false;
}

function enter(state: SimState, inter: InteractionState, phase: InteractionPhase, a: AgentState, b: AgentState): void {
  inter.phase = phase;
  inter.phaseTime = 0;
  inter.phaseDuration = PHASE_TIME[phase];
  if (phase === 'signal') {
    const voice = voiceFor(inter.kind, speciesOf(state, a));
    const until = state.env.time + state.config.clockScale * 2;
    a.vocalization = { kind: voice, until };
    b.vocalization = { kind: voice, until };
  }
  if (phase === 'response') inter.response = chooseResponse(state, inter, a, b);
  if (phase === 'contact') {
    inter.contactPoint = contactPoint(state, a, b);
    emit(state, 'interaction.contact', [a.id, b.id], midpoint(a, b), { kind: inter.kind }, 0.5);
  }
  if (phase === 'resolve') {
    const outcome = settle(state, inter, a, b);
    inter.outcome = outcome;
    const resultData: Record<string, string | number | boolean | null> = { kind: inter.kind, outcome };
    if (inter.winnerId != null && inter.loserId != null) {
      resultData.winner = inter.winnerId;
      resultData.loser = inter.loserId;
      resultData.injury = inter.injury ?? 0;
    }
    emit(state, 'interaction.resolved', [a.id, b.id], midpoint(a, b), resultData, outcome === 'bonded' ? 0.8 : outcome === 'escalated' ? 0.82 : 0.6);
  }
  syncRefs(state, inter, a, b);
}

function chooseResponse(state: SimState, inter: InteractionState, a: AgentState, b: AgentState): 'accept' | 'ignore' | 'reject' | 'counter' {
  const fam = familiarity(state, b.id, a.id);
  const spB = speciesOf(state, b);
  switch (inter.kind) {
    case 'greet':
    case 'groom':
      if (fam >= 0.34) return 'accept';
      if (fam >= 0.18) return 'ignore';
      return 'reject';
    case 'play':
      if (fam < 0.2) return 'ignore';
      return spB.social.playfulness > 0.4 && b.needs.fear < 0.4 ? 'accept' : 'ignore';
    case 'warn':
      if (spB.social.boldness >= 0.6 && (spB.social.aggression >= 0.5 || (state.relationships.get(b.id)?.get(a.id)?.rivalry ?? 0) > 0.25)) {
        return 'counter';
      }
      return 'reject';
    case 'court': {
      const season = spB.lifeCycle.breedingSeasons.includes(state.env.season);
      const ok =
        season &&
        a.sex !== b.sex &&
        a.lifeStage !== 'juvenile' &&
        b.lifeStage !== 'juvenile' &&
        b.needs.breeding > 0.35 &&
        fam > 0.15 &&
        !b.pregnancy;
      return ok ? 'accept' : 'reject';
    }
    case 'nurse': {
      const kin = state.relationships.get(b.id)?.get(a.id)?.kin;
      return kin === 'parent' || kin === 'offspring' ? 'accept' : 'reject';
    }
    default:
      return 'ignore';
  }
}

function settle(state: SimState, inter: InteractionState, a: AgentState, b: AgentState): InteractionOutcome {
  let outcome: InteractionOutcome;
  if (inter.kind === 'warn') outcome = inter.response === 'counter' ? 'escalated' : 'retreated';
  else if (inter.response === 'accept' && inter.kind === 'court' && bond(state, a, b)) outcome = 'bonded';
  else if (inter.response === 'accept') outcome = 'accepted';
  else if (inter.response === 'ignore') outcome = 'ignored';
  else if (inter.response === 'counter') outcome = 'escalated';
  else outcome = 'rejected';

  const ab = ensureRel(state, a.id, b.id);
  const ba = ensureRel(state, b.id, a.id);
  ab.interactions += 1;
  ba.interactions += 1;
  ab.lastSeen = ba.lastSeen = state.env.time;
  a.stats.interactions += 1;
  b.stats.interactions += 1;
  if (outcome === 'accepted' || outcome === 'bonded') {
    ab.familiarity = Math.min(1, ab.familiarity + 0.06);
    ba.familiarity = Math.min(1, ba.familiarity + 0.06);
    ab.affection = Math.min(1, ab.affection + 0.05);
    ba.affection = Math.min(1, ba.affection + 0.05);
    ab.trust = Math.min(1, ab.trust + 0.04);
    ba.trust = Math.min(1, ba.trust + 0.04);
  } else if (outcome === 'rejected' || outcome === 'escalated') {
    ab.trust = Math.max(0, ab.trust - 0.04);
    ba.trust = Math.max(0, ba.trust - 0.04);
    if (outcome === 'escalated') resolveTerritorialContest(state, inter, a, b);
  } else if (outcome === 'retreated') {
    ba.fear = Math.min(1, ba.fear + 0.12);
    ab.dominance = Math.min(1, ab.dominance + 0.08);
    ba.dominance = Math.max(-1, ba.dominance - 0.08);
  }
  if (outcome === 'bonded') {
    ab.familiarity = Math.max(ab.familiarity, 0.8);
    ba.familiarity = Math.max(ba.familiarity, 0.8);
    ab.affection = Math.max(ab.affection, 0.7);
    ba.affection = Math.max(ba.affection, 0.7);
    if (ab.kin === 'none') ab.kin = 'mate';
    if (ba.kin === 'none') ba.kin = 'mate';
    a.mateId = b.id;
    b.mateId = a.id;
    const female = a.sex === 'female' ? a : b;
    const male = a.sex === 'male' ? a : b;
    const sp = speciesOf(state, female);
    const pop = state.counts.get(female.speciesId) ?? 0;
    if (!female.pregnancy && female.lifeStage !== 'juvenile' && pop < sp.carryingCapacity && sp.lifeCycle.breedingSeasons.includes(state.env.season)) {
      female.pregnancy = { mateId: male.id, dueAt: state.env.time + sp.lifeCycle.gestationDays * 86400 };
    }
    emit(state, 'courtship.bonded', [female.id, male.id], midpoint(a, b), { species: female.speciesId, mate: male.id }, 0.85);
  }
  return outcome;
}

/**
 * A countered warning becomes a short, non-lethal dominance contest.
 * The result uses anatomy-independent biological factors (condition, size, confidence)
 * plus the seeded ecology stream, so the same world seed produces the same winner.
 * This is a contest resolver, not a detailed combat / damage model.
 */
function resolveTerritorialContest(
  state: SimState,
  inter: InteractionState,
  a: AgentState,
  b: AgentState,
): void {
  const score = (agent: AgentState): number => {
    const sp = speciesOf(state, agent);
    const mass = Math.log2(Math.max(1, sp.body.massKg));
    const condition = 0.55 * agent.needs.stamina + 0.45 * agent.needs.health;
    const confidence = 0.55 * sp.social.boldness + 0.45 * sp.social.aggression;
    const size = Math.min(1, mass / 14);
    const jitter = 0.94 + state.rngEcology.next() * 0.12;
    return (0.52 * condition + 0.33 * confidence + 0.15 * size) * jitter;
  };
  const aScore = score(a);
  const bScore = score(b);
  // Exact ties are broken by persistent id, not iteration order.
  const winner = Math.abs(aScore - bScore) < 1e-8 ? (a.id < b.id ? a : b) : aScore > bScore ? a : b;
  const loser = winner.id === a.id ? b : a;
  const winnerToLoser = ensureRel(state, winner.id, loser.id);
  const loserToWinner = ensureRel(state, loser.id, winner.id);
  const margin = Math.min(1, Math.abs(aScore - bScore));
  const injury = Math.min(0.085, 0.025 + margin * 0.06);

  inter.winnerId = winner.id;
  inter.loserId = loser.id;
  inter.injury = injury;

  // A scuffle costs both animals energy; the loser receives a small, recoverable injury.
  winner.needs.stamina = Math.max(0, winner.needs.stamina - 0.16);
  winner.needs.fatigue = Math.min(1, winner.needs.fatigue + 0.08);
  loser.needs.stamina = Math.max(0, loser.needs.stamina - 0.32);
  loser.needs.fatigue = Math.min(1, loser.needs.fatigue + 0.16);
  loser.needs.health = Math.max(0.52, loser.needs.health - injury);
  loser.needs.fear = Math.min(1, loser.needs.fear + 0.22);
  winner.needs.fear = Math.min(1, winner.needs.fear + 0.04);

  winnerToLoser.dominance = Math.min(1, winnerToLoser.dominance + 0.2);
  loserToWinner.dominance = Math.max(-1, loserToWinner.dominance - 0.2);
  winnerToLoser.rivalry = Math.min(1, winnerToLoser.rivalry + 0.08);
  loserToWinner.rivalry = Math.min(1, loserToWinner.rivalry + 0.12);
  winnerToLoser.lastSeen = loserToWinner.lastSeen = state.env.time;
  loser.memory.lastThreatAt = state.env.time;
  loser.memory.lastThreatId = winner.id;
  loser.memory.lastThreatPos = { x: winner.pos.x, z: winner.pos.z };
  // Make the outcome visible to the AI in the next decision pass.
  const loserRuntime = state.runtime.get(loser.id);
  const winnerRuntime = state.runtime.get(winner.id);
  if (loserRuntime) loserRuntime.nextDecisionAt = state.physTime;
  if (winnerRuntime) winnerRuntime.nextDecisionAt = state.physTime;
}
 
function bond(state: SimState, a: AgentState, b: AgentState): boolean {
  if (a.sex === b.sex || a.lifeStage === 'juvenile' || b.lifeStage === 'juvenile') return false;
  if (a.needs.breeding < 0.55 || b.needs.breeding < 0.55) return false;
  if (familiarity(state, a.id, b.id) < 0.25) return false;
  const female = a.sex === 'female' ? a : b;
  const sp = speciesOf(state, female);
  if (!sp.lifeCycle.breedingSeasons.includes(state.env.season)) return false;
  if ((state.counts.get(female.speciesId) ?? 0) >= sp.carryingCapacity) return false;
  return !female.pregnancy;
}

function interrupt(state: SimState, inter: InteractionState, reason: string): void {
  inter.outcome = 'interrupted';
  inter.interruptReason = reason;
  const a = state.agentById.get(inter.initiator);
  const b = state.agentById.get(inter.responder);
  for (const agent of [a, b]) {
    if (!agent) continue;
    agent.interaction = null;
    if (!agent.alive) continue;
    agent.behavior = agent.needs.fear >= 0.5 ? 'flee' : 'idle';
    agent.intent = { ...agent.intent, behavior: agent.behavior, targetAgent: agent.memory.lastThreatId };
    const rt = state.runtime.get(agent.id);
    if (rt) rt.nextDecisionAt = state.physTime;
  }
  const pos = a ? { x: a.pos.x, z: a.pos.z } : b ? { x: b.pos.x, z: b.pos.z } : null;
  emit(state, 'interaction.interrupted', [inter.initiator, inter.responder], pos, { kind: inter.kind, reason }, 0.7);
}

function release(state: SimState, inter: InteractionState, a: AgentState, b: AgentState): void {
  for (const agent of [a, b]) {
    agent.interaction = null;
    if (!agent.alive) continue;
    if (inter.kind === 'warn' && inter.outcome === 'escalated' && inter.winnerId != null && inter.loserId != null) {
      if (agent.id === inter.loserId) {
        const winner = state.agentById.get(inter.winnerId);
        const dx = winner ? agent.pos.x - winner.pos.x : 0;
        const dz = winner ? agent.pos.z - winner.pos.z : 1;
        const length = Math.hypot(dx, dz) || 1;
        agent.behavior = 'flee';
        agent.posture = 'crouch';
        agent.intent = {
          behavior: 'flee',
          target: { x: agent.pos.x + (dx / length) * 24, z: agent.pos.z + (dz / length) * 24 },
          targetAgent: inter.winnerId,
          place: null,
        };
      } else if (agent.id === inter.winnerId) {
        agent.behavior = 'vigilance';
        agent.posture = 'stand';
        agent.intent = { behavior: 'vigilance', target: null, targetAgent: inter.loserId, place: null };
      }
    } else if (agent.behavior === 'interact') {
      agent.behavior = 'idle';
      agent.intent = { behavior: 'idle', target: null, targetAgent: null, place: null };
      agent.posture = 'stand';
    }
    const rt = state.runtime.get(agent.id);
    if (rt) rt.nextDecisionAt = state.physTime;
  }
}

function syncRefs(state: SimState, inter: InteractionState, a: AgentState, b: AgentState): void {
  a.interaction = { id: inter.id, kind: inter.kind, role: 'initiator', phase: inter.phase, partnerId: b.id };
  b.interaction = { id: inter.id, kind: inter.kind, role: 'responder', phase: inter.phase, partnerId: a.id };
  void state;
}

function applyPhaseMotion(state: SimState, inter: InteractionState, a: AgentState, b: AgentState): void {
  a.behavior = 'interact';
  b.behavior = 'interact';
  a.intent.behavior = 'interact';
  b.intent.behavior = 'interact';
  a.intent.targetAgent = b.id;
  b.intent.targetAgent = a.id;
  if (inter.phase === 'separate') {
    const dx = a.pos.x - b.pos.x;
    const dz = a.pos.z - b.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    a.intent.target = { x: a.pos.x + (dx / d) * 3.5, z: a.pos.z + (dz / d) * 3.5 };
    b.intent.target = { x: b.pos.x - (dx / d) * 3.5, z: b.pos.z - (dz / d) * 3.5 };
  } else {
    a.intent.target = { x: b.pos.x, z: b.pos.z };
    b.intent.target = { x: a.pos.x, z: a.pos.z };
  }
  const ha = head(state, a);
  const hb = head(state, b);
  if (inter.phase === 'contact') {
    inter.contactPoint = { x: (ha.x + hb.x) / 2, y: (ha.y + hb.y) / 2, z: (ha.z + hb.z) / 2 };
    a.lookAt = inter.contactPoint;
    b.lookAt = inter.contactPoint;
  } else {
    a.lookAt = hb;
    b.lookAt = ha;
  }
  if (inter.phase !== 'separate') {
    a.posture = 'stand';
    b.posture = 'stand';
  }
}

function head(state: SimState, agent: AgentState): { x: number; y: number; z: number } {
  const sp = speciesOf(state, agent);
  const reach = sp.body.headReach * agent.scale;
  return {
    x: agent.pos.x + Math.sin(agent.heading) * reach,
    y: agent.pos.y + sp.body.headHeight * agent.scale,
    z: agent.pos.z + Math.cos(agent.heading) * reach,
  };
}

function contactPoint(state: SimState, a: AgentState, b: AgentState): { x: number; y: number; z: number } {
  const ha = head(state, a);
  const hb = head(state, b);
  return { x: (ha.x + hb.x) / 2, y: (ha.y + hb.y) / 2, z: (ha.z + hb.z) / 2 };
}

function midpoint(a: AgentState, b: AgentState): { x: number; z: number } {
  return { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 };
}

function voiceFor(kind: InteractionKind, sp: SpeciesProfile): Vocalization {
  if (kind === 'warn') return 'growl';
  if (kind === 'court') return 'call';
  if (kind === 'play') return 'chirp';
  if (kind === 'nurse') return 'rumble';
  switch (sp.social.greetingStyle) {
    case 'nuzzle':
      return 'rumble';
    case 'call':
      return 'call';
    case 'display':
      return 'growl';
    default:
      return 'chirp';
  }
}
