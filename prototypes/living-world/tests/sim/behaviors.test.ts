import { describe, expect, it } from 'vitest';
import { INTERACTION_PHASES } from '../../src/sim/ids';
import { Simulation } from '../../src/sim/Simulation';
import type { AgentState, SimEvent } from '../../src/sim/types';
import { bundle, farthestClearing, place, step } from './helpers';

function calm(agent: AgentState): void {
  agent.needs.hunger = 0.05;
  agent.needs.thirst = 0.05;
  agent.needs.fatigue = 0.08;
  agent.needs.cold = 0.05;
  agent.needs.heat = 0;
  agent.needs.fear = 0;
  agent.needs.curiosity = 0.05;
  agent.needs.breeding = 0;
  agent.needs.stamina = 1;
  agent.needs.health = 1;
  agent.needs.social = 1;
}

describe('behaviour', () => {
  it('plays greetings in phase order, without double booking, and wary of strangers', () => {
    const familiar = Simulation.create(bundle, { seed: 15 });
    const adults = familiar.agents.filter((a) => a.speciesId === 'kit_forager' && a.lifeStage === 'adult' && a.alive);
    const groups = new Map<number, AgentState[]>();
    for (const agent of adults) {
      if (agent.groupId == null) continue;
      const list = groups.get(agent.groupId) ?? [];
      list.push(agent);
      groups.set(agent.groupId, list);
    }
    const pair = [...groups.values()].find((g) => g.length >= 2);
    expect(pair).toBeTruthy();
    const [a, b] = pair!;
    expect(familiar.getRelationships(a.id).get(b.id)?.familiarity ?? 0).toBeGreaterThanOrEqual(0.34);
    const spot = farthestClearing(familiar);
    place(familiar, a, spot.x, spot.z);
    place(familiar, b, spot.x + 2.2, spot.z + 0.4);
    calm(a);
    calm(b);
    const phases: string[] = [];
    let last = '';
    const resolved: SimEvent[] = [];
    familiar.onEvent((e) => {
      if (e.type === 'interaction.resolved' && e.actors.includes(a.id)) resolved.push(e);
    });
    let booked = true;
    for (let i = 0; i < 350 && resolved.length === 0; i++) {
      familiar.step();
      const ids = familiar.interactions.flatMap((inter) => [inter.initiator, inter.responder]);
      if (new Set(ids).size !== ids.length) booked = false;
      const inter = familiar.interactions.find((x) => x.initiator === a.id || x.responder === a.id);
      if (inter && inter.phase !== last) {
        phases.push(inter.phase);
        last = inter.phase;
      }
    }
    expect(booked).toBe(true);
    expect(phases[0]).toBe('approach');
    for (let i = 1; i < phases.length; i++) {
      expect(INTERACTION_PHASES.indexOf(phases[i] as (typeof INTERACTION_PHASES)[number])).toBeGreaterThan(
        INTERACTION_PHASES.indexOf(phases[i - 1] as (typeof INTERACTION_PHASES)[number]),
      );
    }
    expect(phases).toContain('contact');
    expect(phases).toContain('resolve');
    expect(resolved[0]?.data.kind).toBe('greet');
    expect(resolved[0]?.data.outcome).toBe('accepted');

    const strangers = Simulation.create(bundle, { seed: 15 });
    const kits = strangers.agents.filter((agent) => agent.speciesId === 'kit_forager' && agent.lifeStage === 'adult');
    const g0 = kits.find((agent) => agent.groupId === kits[0]?.groupId);
    const g1 = kits.find((agent) => g0 && agent.groupId !== g0.groupId);
    expect(g0 && g1).toBeTruthy();
    expect(strangers.getRelationships(g0!.id).get(g1!.id)?.familiarity ?? 0).toBeLessThan(0.18);
    const far = farthestClearing(strangers);
    place(strangers, g0!, far.x, far.z);
    place(strangers, g1!, far.x + 2.2, far.z);
    calm(g0!);
    calm(g1!);
    const seen = new Set<string>();
    const outcomes: Array<string | number | boolean | null> = [];
    strangers.onEvent((e) => {
      const between = e.actors.includes(g0!.id) && e.actors.includes(g1!.id);
      if (!between || e.data.kind !== 'greet') return;
      if (e.type === 'interaction.contact' || e.type === 'interaction.resolved') {
        seen.add(e.type);
        if (e.type === 'interaction.resolved') outcomes.push(e.data.outcome ?? null);
      }
    });
    step(strangers, 350);
    expect(seen.has('interaction.contact')).toBe(false);
    expect(['rejected', 'ignored']).toContain(outcomes[0]);
  });

  it('interrupts a greeting when fear spikes', () => {
    const sim = Simulation.create(bundle, { seed: 16 });
    const adults = sim.agents.filter((a) => a.speciesId === 'kit_forager' && a.lifeStage === 'adult');
    const a = adults[0];
    const b = adults.find((agent) => agent.groupId === a?.groupId && agent.id !== a?.id);
    expect(a && b).toBeTruthy();
    const spot = farthestClearing(sim);
    place(sim, a!, spot.x, spot.z);
    place(sim, b!, spot.x + 2, spot.z);
    calm(a!);
    calm(b!);
    const events: SimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    let interrupted = false;
    for (let i = 0; i < 250 && !interrupted; i++) {
      sim.step();
      const inter = sim.interactions.find((x) => x.initiator === a!.id || x.responder === a!.id);
      if (inter && (inter.phase === 'signal' || inter.phase === 'contact' || inter.phase === 'orient')) {
        a!.needs.fear = 1;
        b!.needs.fear = 1;
        sim.step();
        interrupted = true;
      }
    }
    expect(interrupted).toBe(true);
    expect(events.some((e) => e.type === 'interaction.interrupted')).toBe(true);
    expect(a!.interaction).toBeNull();
    expect(b!.interaction).toBeNull();
  });

  it('hunts an isolated kit, fails a chase, and aborts against the herd', () => {
    const success = runHunt('success');
    expect(success.events.some((e) => e.type === 'hunt.stalk_started')).toBe(true);
    expect(success.events.some((e) => e.type === 'hunt.succeeded')).toBe(true);
    expect(success.prey.alive).toBe(false);
    expect(success.prey.causeOfDeath).toBe('predation');
    expect(success.sim.carcasses.some((c) => c.agentId === success.prey.id)).toBe(true);

    const failed = runHunt('fail');
    expect(failed.events.some((e) => e.type === 'hunt.stalk_started' || e.type === 'hunt.chase_started')).toBe(true);
    expect(failed.events.some((e) => e.type === 'hunt.failed')).toBe(true);
    expect(failed.prey.alive).toBe(true);

    const herd = runHunt('herd');
    expect(herd.events.some((e) => e.type === 'hunt.stalk_started')).toBe(true);
    expect(herd.events.some((e) => e.type === 'herd.defense')).toBe(true);
    expect(herd.events.some((e) => e.type === 'hunt.aborted')).toBe(true);
    expect(herd.prey.alive).toBe(true);
  });

  it('sends cold giants into a hot spring', () => {
    const sim = Simulation.create(bundle, { seed: 21 });
    sim.setOverrides({ season: 'winter', weather: 'snow' });
    expect(sim.env.season).toBe('winter');
    expect(sim.env.weather).toBe('snow');
    expect(sim.env.temperatureC).toBeLessThan(1);
    expect(sim.recentEvents(10).some((e) => e.type === 'world.override')).toBe(true);
    const events: SimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    step(sim, 2200);
    const giants = new Set(sim.agents.filter((a) => a.speciesId === 'giant_grazer').map((a) => a.id));
    const entered = events.filter((e) => e.type === 'hotspring.entered' && e.actors.some((id) => giants.has(id)));
    expect(entered.length).toBeGreaterThan(0);
  });

  it('keeps juveniles with their mothers and brings them home at dusk', () => {
    const sim = Simulation.create(bundle, { seed: 19 });
    step(sim, 500);
    const followed = sim.agents.filter((a) => a.alive && a.lifeStage === 'juvenile' && a.motherId != null && sim.species.get(a.speciesId)?.behaviors.includes('follow'));
    expect(followed.length).toBeGreaterThan(0);
    for (const child of followed) {
      const mother = sim.getAgent(child.motherId!);
      expect(mother?.alive).toBe(true);
      const d = Math.hypot(child.pos.x - mother!.pos.x, child.pos.z - mother!.pos.z);
      expect(d).toBeLessThan(16);
    }

    const dusk = Simulation.create(bundle, { seed: 19, startHour: 17.6 });
    expect(dusk.env.dayPhase).toBe('dusk');
    const kid = dusk.agents.find((a) => a.alive && a.speciesId === 'kit_forager' && a.lifeStage === 'juvenile' && a.homeId);
    expect(kid).toBeTruthy();
    const home = dusk.terrain.getLandmark(kid!.homeId!);
    expect(home).toBeTruthy();
    let placed = false;
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      const x = home!.x + Math.sin(ang) * 26;
      const z = home!.z + Math.cos(ang) * 26;
      if (!dusk.terrain.isWalkable(x, z, 36, 0.5)) continue;
      place(dusk, kid!, x, z);
      placed = true;
      break;
    }
    expect(placed).toBe(true);
    const events: SimEvent[] = [];
    dusk.onEvent((e) => events.push(e));
    step(dusk, 700);
    const returned = events.some((e) => e.type === 'home.returned' && e.actors.includes(kid!.id));
    const dist = Math.hypot(kid!.pos.x - home!.x, kid!.pos.z - home!.z);
    expect(returned || dist < home!.radius + 4).toBe(true);
  });
});

function runHunt(mode: 'success' | 'fail' | 'herd'): { sim: Simulation; prey: AgentState; events: SimEvent[] } {
  const sim = Simulation.create(bundle, { seed: 27 });
  const events: SimEvent[] = [];
  sim.onEvent((e) => events.push(e));
  const stalkers = sim.agents.filter((a) => a.speciesId === 'ridge_stalker' && a.alive);
  const hunter = stalkers[0];
  expect(hunter).toBeTruthy();
  for (const other of stalkers) {
    if (other.id !== hunter.id) other.needs.hunger = 0;
  }
  hunter.needs.hunger = 1;
  hunter.needs.stamina = mode === 'fail' ? 0 : 1;
  hunter.needs.fear = 0;

  if (mode === 'herd') {
    const giants = sim.agents.filter((a) => a.speciesId === 'giant_grazer' && a.alive && a.lifeStage !== 'juvenile');
    const kit = sim.agents.find((a) => a.speciesId === 'kit_forager' && a.alive && a.lifeStage === 'juvenile') ?? sim.agents.find((a) => a.speciesId === 'kit_forager' && a.alive);
    expect(giants.length).toBeGreaterThan(0);
    expect(kit).toBeTruthy();
    const gx = giants[0].pos.x;
    const gz = giants[0].pos.z;
    place(sim, kit!, gx + 2.2, gz + 0.6);
    if (giants[1]) place(sim, giants[1], gx + 3.2, gz - 1.2);
    place(sim, hunter, gx + 7, gz + 1);
    for (const other of sim.agents) {
      if (other.id === kit!.id || other.id === hunter.id || other.speciesId === 'giant_grazer') continue;
      if (other.speciesId === 'kit_forager') place(sim, other, gx + 140, gz - 80);
    }
    kit!.lifeStage = 'juvenile';
    step(sim, 30);
    return { sim, prey: kit!, events };
  }

  const spot = farthestClearing(sim);
  const kits = sim.agents.filter((a) => a.speciesId === 'kit_forager' && a.alive);
  const prey = (mode === 'success' ? kits.find((a) => a.lifeStage === 'juvenile') : kits.find((a) => a.lifeStage !== 'juvenile')) ?? kits[0];
  expect(prey).toBeTruthy();
  if (mode === 'success') prey.lifeStage = 'juvenile';
  else {
    prey.lifeStage = 'adult';
    prey.motherId = null;
  }
  place(sim, prey, spot.x, spot.z);
  place(sim, hunter, spot.x + (mode === 'success' ? 1.2 : 16), spot.z + 0.3);
  for (const other of sim.agents) {
    if (other.id === prey.id || other.id === hunter.id) continue;
    if (other.speciesId === 'kit_forager' || other.speciesId === 'giant_grazer') {
      place(sim, other, -spot.x, -spot.z);
    }
  }
  step(sim, mode === 'success' ? 40 : 220);
  return { sim, prey, events };
}
