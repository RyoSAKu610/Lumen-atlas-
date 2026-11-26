import { Rng } from './rng';
import type { CauseOfDeath, Sex } from './ids';
import type { AgentState, Carcass } from './types';
import { ensureRel, rtOf, speciesOf, type AgentRuntime, type SimState } from './internal';
import { emit } from './journal';
import { evaluateAgent } from './ai';

const DAY = 86400;

export function updateLifecycle(state: SimState, gameDt: number): void {
  if (gameDt <= 0) return;
  // Copy the list: births append, deaths only flag.
  const living = state.agents.slice();
  for (const agent of living) {
    if (!agent.alive) continue;
    const sp = speciesOf(state, agent);
    const ageDays = (state.env.time - agent.bornAt) / DAY;
    if (agent.lifeStage === 'juvenile') {
      const t = Math.max(0, Math.min(1, ageDays / sp.lifeCycle.maturityDays));
      agent.scale = sp.lifeCycle.juvenileScale + (1 - sp.lifeCycle.juvenileScale) * t;
      if (ageDays >= sp.lifeCycle.maturityDays) {
        agent.lifeStage = 'adult';
        agent.scale = 1;
        emit(state, 'agent.matured', [agent.id], { x: agent.pos.x, z: agent.pos.z }, { species: agent.speciesId }, 0.4);
      }
    } else if (agent.lifeStage === 'adult' && ageDays >= sp.lifeCycle.elderDays) {
      agent.lifeStage = 'elder';
      emit(state, 'agent.elder', [agent.id], { x: agent.pos.x, z: agent.pos.z }, { species: agent.speciesId, ageDays: round1(ageDays) }, 0.45);
    } else {
      agent.scale = 1;
    }
    if (ageDays >= sp.lifeCycle.maxAgeDays) {
      killAgent(state, agent, 'old_age');
      continue;
    }
    if (agent.pregnancy && state.env.time >= agent.pregnancy.dueAt) giveBirth(state, agent);
  }
}

export function killAgent(state: SimState, agent: AgentState, cause: CauseOfDeath): void {
  if (!agent.alive) return;
  agent.alive = false;
  agent.diedAt = state.env.time;
  agent.causeOfDeath = cause;
  agent.posture = 'dead';
  agent.behavior = 'idle';
  agent.speed = 0;
  agent.flightMode = null;
  agent.velocity.x = 0;
  agent.velocity.y = 0;
  agent.velocity.z = 0;
  agent.pregnancy = null;
  agent.interaction = null;
  const rt = state.runtime.get(agent.id);
  if (rt) rt.lock = 'none';
  state.counts.set(agent.speciesId, Math.max(0, (state.counts.get(agent.speciesId) ?? 1) - 1));
  state.deaths += 1;

  for (const inter of state.interactions) {
    if (inter.initiator === agent.id || inter.responder === agent.id) inter.interruptReason = inter.interruptReason ?? 'partner dead';
  }
  state.hunts = state.hunts.filter((h) => h.predatorId !== agent.id && h.preyId !== agent.id);

  const carcass: Carcass = {
    id: state.nextCarcassId++,
    speciesId: agent.speciesId,
    agentId: agent.id,
    pos: { x: agent.pos.x, y: agent.pos.y, z: agent.pos.z },
    heading: agent.heading,
    remaining: 1,
    createdAt: state.env.time,
  };
  state.carcasses.push(carcass);
  emit(
    state,
    'agent.died',
    [agent.id],
    { x: agent.pos.x, z: agent.pos.z },
    {
      species: agent.speciesId,
      cause,
      stage: agent.lifeStage,
      behavior: agent.behavior,
      decision: agent.decision?.chosen ?? null,
      thirst: round3(agent.needs.thirst),
      hunger: round3(agent.needs.hunger),
      fatigue: round3(agent.needs.fatigue),
      health: round3(agent.needs.health),
      fear: round3(agent.needs.fear),
      waterX: agent.memory.water?.x ?? null,
      waterZ: agent.memory.water?.z ?? null,
      targetX: agent.intent.target?.x ?? null,
      targetZ: agent.intent.target?.z ?? null,
      homeId: agent.homeId,
      threatX: agent.memory.lastThreatPos?.x ?? null,
      threatZ: agent.memory.lastThreatPos?.z ?? null,
    },
    cause === 'predation' ? 0.95 : 0.85,
  );
}

function giveBirth(state: SimState, mother: AgentState): void {
  const sp = speciesOf(state, mother);
  const mateId = mother.pregnancy?.mateId ?? mother.mateId ?? mother.id;
  mother.pregnancy = null;
  mother.needs.breeding = 0;
  const pop = state.counts.get(mother.speciesId) ?? 0;
  if (pop >= sp.carryingCapacity) return;
  const rt = rtOf(state, mother.id);
  let n = rt.rng.int(sp.lifeCycle.litterSize[0], sp.lifeCycle.litterSize[1]);
  const room = sp.carryingCapacity - pop;
  if (n > room) n = room;
  if (pop > sp.carryingCapacity * 0.85) n = Math.max(0, n - 1);
  for (let i = 0; i < n; i++) {
    const child = spawnOffspring(state, mother, mateId, i);
    state.agents.push(child);
    state.agentById.set(child.id, child);
    evaluateAgent(state, child, 'scheduled');
    state.counts.set(mother.speciesId, (state.counts.get(mother.speciesId) ?? 0) + 1);
    mother.stats.offspring += 1;
    const childRt = state.runtime.get(child.id);
    if (childRt) {
      const relM = ensureRel(state, mother.id, child.id);
      const relC = ensureRel(state, child.id, mother.id);
      relM.kin = 'offspring';
      relC.kin = 'parent';
      relM.familiarity = relC.familiarity = 1;
      relM.affection = relC.affection = 0.85;
      relM.trust = relC.trust = 0.8;
      if (mateId !== mother.id) {
        const relF = ensureRel(state, mateId, child.id);
        const relCF = ensureRel(state, child.id, mateId);
        relF.kin = 'offspring';
        relCF.kin = 'parent';
        relF.familiarity = relCF.familiarity = 0.7;
        relF.affection = relCF.affection = 0.45;
      }
    }
    emit(
      state,
      'agent.born',
      [child.id, mother.id],
      { x: child.pos.x, z: child.pos.z },
      { species: child.speciesId, mother: mother.id, sex: child.sex, litter: n },
      0.75,
    );
    state.births += 1;
  }
  // Siblings.
  const kids = state.agents.filter((a) => a.motherId === mother.id && a.bornAt === state.env.time);
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const a = ensureRel(state, kids[i].id, kids[j].id);
      const b = ensureRel(state, kids[j].id, kids[i].id);
      a.kin = b.kin = 'sibling';
      a.familiarity = b.familiarity = 0.9;
      a.affection = b.affection = 0.6;
    }
  }
}

function spawnOffspring(state: SimState, mother: AgentState, mateId: number, index: number): AgentState {
  const sp = speciesOf(state, mother);
  const id = state.nextAgentId++;
  const rng = Rng.stream(state.config.seed, 'agent', id);
  const sex: Sex = rng.chance(0.5) ? 'female' : 'male';
  const ang = (index + 1) * 1.7 + mother.heading;
  const dist = sp.body.radius * 1.4 + 0.6;
  let x = mother.pos.x + Math.sin(ang) * dist;
  let z = mother.pos.z + Math.cos(ang) * dist;
  const clamped = state.terrain.clampToBounds(x, z, 4);
  x = clamped.x;
  z = clamped.z;
  const y = state.terrain.heightAt(x, z);
  const agent: AgentState = {
    id,
    speciesId: mother.speciesId,
    sex,
    bornAt: state.env.time,
    lifeStage: 'juvenile',
    alive: true,
    diedAt: null,
    causeOfDeath: null,
    pos: { x, y, z },
    prevPos: { x, y, z },
    heading: mother.heading,
    prevHeading: mother.heading,
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    posture: 'stand',
    flightMode: null,
    bank: 0,
    scale: sp.lifeCycle.juvenileScale,
    needs: {
      hunger: 0.25,
      thirst: 0.2,
      fatigue: 0.1,
      cold: mother.needs.cold * 0.5,
      heat: 0,
      social: 0.2,
      fear: 0,
      curiosity: 0.4,
      stamina: 1,
      health: 1,
      breeding: 0,
    },
    behavior: 'follow',
    behaviorStartedAt: state.env.time,
    intent: { behavior: 'follow', target: { x: mother.pos.x, z: mother.pos.z }, targetAgent: mother.id, place: mother.homeId },
    decision: null,
    interaction: null,
    groupId: mother.groupId,
    homeId: mother.homeId,
    motherId: mother.id,
    fatherId: mateId === mother.id ? null : mateId,
    mateId: null,
    territory: null,
    pregnancy: null,
    memory: { lastThreatAt: null, lastThreatPos: null, lastThreatId: null, food: mother.memory.food, water: mother.memory.water },
    lookAt: null,
    vocalization: null,
    stats: { meals: 0, huntsAttempted: 0, huntsSucceeded: 0, interactions: 0, offspring: 0, distance: 0, baths: 0 },
  };
  const runtime: AgentRuntime = {
    rng,
    nextDecisionAt: state.physTime + 0.4,
    nextPerceptionAt: state.physTime + (id % 7) * 0.1,
    behaviorUntil: state.physTime + 8,
    wetness: 0,
    altitude: 0,
    homeReported: false,
    wasAwayFromHome: false,
    inSpringId: null,
    huntCooldownUntil: 0,
    lock: 'none',
    feedUntil: 0,
    lastAlarmAt: -100,
    scavenged: [],
    stuck: 0,
    nextUrgentAt: 0,
    circle: id * 0.4,
    soarAnnounced: false,
    visible: [],
  };
  state.runtime.set(id, runtime);
  // Kin familiarity with the mother's group, lightly.
  const row = state.relationships.get(mother.id);
  if (row) {
    for (const [otherId, rel] of row) {
      if (rel.kin === 'offspring') continue;
      if (rel.familiarity < 0.3) continue;
      const a = ensureRel(state, id, otherId);
      const b = ensureRel(state, otherId, id);
      a.familiarity = b.familiarity = Math.min(0.7, rel.familiarity);
      a.trust = b.trust = 0.4;
    }
  }
  return agent;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Drop carcasses that have rotted away, and the bodies that went with them. */
export function removeSpentCarcasses(state: SimState): void {
  const gone = new Set<number>();
  state.carcasses = state.carcasses.filter((c) => {
    if (c.remaining > 0.02) return true;
    gone.add(c.agentId);
    return false;
  });
  if (gone.size === 0) return;
  for (const id of gone) {
    state.agentById.delete(id);
    state.runtime.delete(id);
    state.relationships.delete(id);
    for (const row of state.relationships.values()) row.delete(id);
  }
  state.agents = state.agents.filter((a) => !gone.has(a.id));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
