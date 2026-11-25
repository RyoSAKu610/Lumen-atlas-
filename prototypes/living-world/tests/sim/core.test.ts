import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, SNAPSHOT_SCHEMA_VERSION, Simulation, SnapshotError, migrateSnapshot } from '../../src/sim/Simulation';
import { bundle, fingerprint, step } from './helpers';

describe('simulation core', () => {
  it('is deterministic across 6000 steps and seeds diverge', () => {
    const a = Simulation.create(bundle, { seed: 7 });
    const b = Simulation.create(bundle, { seed: 7 });
    const c = Simulation.create(bundle, { seed: 8 });
    step(a, 6000);
    step(b, 6000);
    step(c, 6000);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint(c));
    for (const sim of [a, b, c]) {
      for (const agent of sim.agents) {
        expect(Number.isFinite(agent.pos.x)).toBe(true);
        expect(Number.isFinite(agent.pos.y)).toBe(true);
        expect(Number.isFinite(agent.pos.z)).toBe(true);
      }
    }
  }, 60_000);

  it('advances with a fixed accumulator', () => {
    const sim = Simulation.create(bundle, { seed: 3 });
    const tick = sim.tick;
    const moved = sim.advance(0.35, 1);
    expect(moved.steps).toBe(3);
    expect(moved.alpha).toBeCloseTo(0.5, 5);
    expect(sim.tick).toBe(tick + 3);
    expect(sim.physTime).toBeCloseTo(sim.tick * sim.config.fixedDt, 8);
    const paused = sim.advance(1, 0);
    expect(paused.steps).toBe(0);
  });

  it('round-trips a snapshot and rejects corrupt data', () => {
    const sim = Simulation.create(bundle, { seed: 11 });
    step(sim, 250);
    const snap = sim.snapshot(1_700_000_000_000);
    expect(snap.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(migrateSnapshot(snap)).toBe(snap);
    const raw = JSON.parse(JSON.stringify(snap)) as typeof snap;
    const restored = Simulation.restore(raw, bundle);
    expect(fingerprint(restored)).toBe(fingerprint(sim));
    step(sim, 120);
    step(restored, 120);
    expect(fingerprint(restored)).toBe(fingerprint(sim));

    expect(() => migrateSnapshot(null)).toThrow(SnapshotError);
    expect(() => migrateSnapshot({ schemaVersion: 99 })).toThrow(SnapshotError);
    expect(() => Simulation.restore({ schemaVersion: 2, regionId: 'x', config: {} } as never, bundle)).toThrow(SnapshotError);
    const tampered = JSON.parse(JSON.stringify(snap)) as { tick: number };
    tampered.tick += 5;
    expect(() => Simulation.restore(tampered as never, bundle)).toThrow(SnapshotError);
  });

  it('catch-up is deterministic, truncated, finite, and approximate', () => {
    const a = Simulation.create(bundle, { seed: 4 });
    const b = Simulation.create(bundle, { seed: 4 });
    const ra = a.catchUp(2 * 86400);
    const rb = b.catchUp(2 * 86400);
    expect(ra).toEqual(rb);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(ra.truncated).toBe(false);
    expect(ra.simulatedGameSeconds).toBeGreaterThan(2 * 86400 - 2);
    expect(ra.events).toBeGreaterThan(0);
    const events = a.recentEvents(4000);
    expect(events.some((e) => e.type === 'system.catchup' && e.approximate)).toBe(true);
    const created = events.find((e) => e.type === 'system.world_created');
    expect(created?.approximate).toBe(false);
    for (const event of events) {
      if (event.type === 'system.world_created') continue;
      expect(event.approximate).toBe(true);
    }
    for (const agent of a.agents) {
      expect(Number.isFinite(agent.pos.x)).toBe(true);
      expect(Number.isFinite(agent.pos.y)).toBe(true);
      expect(Number.isFinite(agent.pos.z)).toBe(true);
    }

    const clipped = Simulation.create(bundle, { seed: 4 }).catchUp(DEFAULT_SIM_CONFIG.maxCatchUpGameSeconds + 3 * 86400);
    expect(clipped.truncated).toBe(true);
    expect(clipped.simulatedGameSeconds).toBeGreaterThan(DEFAULT_SIM_CONFIG.maxCatchUpGameSeconds - 2);
    expect(clipped.simulatedGameSeconds).toBeLessThanOrEqual(DEFAULT_SIM_CONFIG.maxCatchUpGameSeconds + 1);
  }, 60_000);

  it('crosses dawn, dusk, and a season boundary', () => {
    const dawn = Simulation.create(bundle, { seed: 2, startHour: 4.7 });
    expect(dawn.env.dayPhase).toBe('night');
    const dawnEvents: string[] = [];
    dawn.onEvent((e) => dawnEvents.push(e.type));
    step(dawn, 280);
    expect(dawn.env.dayPhase).toBe('dawn');
    expect(dawnEvents).toContain('world.dawn');

    const dusk = Simulation.create(bundle, { seed: 2, startHour: 17.3 });
    const duskEvents: string[] = [];
    dusk.onEvent((e) => duskEvents.push(e.type));
    step(dusk, 200);
    expect(dusk.env.dayPhase).toBe('dusk');
    expect(duskEvents).toContain('world.dusk');

    const year = Simulation.create(bundle, { seed: 2, daysPerSeason: 0.05 });
    const yearEvents: string[] = [];
    year.onEvent((e) => yearEvents.push(e.type));
    step(year, 800);
    expect(year.env.season).not.toBe('spring');
    expect(yearEvents).toContain('world.season_changed');
  });

  it('stays finite and populated across a game day', () => {
    const sim = Simulation.create(bundle, { seed: 9 });
    const counts = new Map<string, number>();
    sim.onEvent((e) => counts.set(e.type, (counts.get(e.type) ?? 0) + 1));
    const stepsPerDay = Math.round(86400 / sim.config.clockScale / sim.config.fixedDt);
    step(sim, stepsPerDay);
    const half = sim.terrain.half;
    let alive = 0;
    const bySpecies = new Map<string, number>();
    for (const agent of sim.agents) {
      expect(Number.isFinite(agent.pos.x)).toBe(true);
      expect(Number.isFinite(agent.pos.y)).toBe(true);
      expect(Number.isFinite(agent.pos.z)).toBe(true);
      expect(agent.pos.x).toBeGreaterThan(-half - 0.01);
      expect(agent.pos.x).toBeLessThan(half + 0.01);
      expect(agent.pos.z).toBeGreaterThan(-half - 0.01);
      expect(agent.pos.z).toBeLessThan(half + 0.01);
      expect(agent.pos.y).toBeGreaterThan(-20);
      expect(agent.pos.y).toBeLessThan(400);
      if (!agent.alive) {
        expect(agent.posture).toBe('dead');
        continue;
      }
      alive += 1;
      bySpecies.set(agent.speciesId, (bySpecies.get(agent.speciesId) ?? 0) + 1);
      for (const value of Object.values(agent.needs)) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of Object.values(agent.needs)) expect(value).toBeLessThanOrEqual(1);
    }
    expect(alive).toBeGreaterThan(12);
    expect(alive).toBeLessThan(70);
    for (const id of ['giant_grazer', 'kit_forager', 'ridge_stalker', 'thermal_glider']) {
      expect(bySpecies.get(id) ?? 0).toBeGreaterThan(0);
    }
    const hunts = counts.get('hunt.stalk_started') ?? 0;
    expect(hunts).toBeGreaterThanOrEqual(1);
    expect(hunts).toBeLessThanOrEqual(6);
    expect(counts.get('world.day_started') ?? 0).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('fills sorted decision traces', () => {
    const sim = Simulation.create(bundle, { seed: 6 });
    step(sim, 40);
    let traced = 0;
    for (const agent of sim.agents) {
      if (!agent.alive || !agent.decision) continue;
      traced += 1;
      const { options, chosen, reason } = agent.decision;
      expect(reason.length).toBeGreaterThan(0);
      expect(options.length).toBeGreaterThan(0);
      expect(options.length).toBeLessThanOrEqual(8);
      expect(options[0]?.behavior).toBe(chosen);
      for (let i = 1; i < options.length; i++) {
        expect(options[i - 1]!.score).toBeGreaterThanOrEqual(options[i]!.score);
      }
      for (const option of options) {
        expect(option.considerations.length).toBeGreaterThan(0);
        for (const consideration of option.considerations) {
          expect(consideration.name.length).toBeGreaterThan(0);
          expect(consideration.input).toBeGreaterThanOrEqual(0);
          expect(consideration.input).toBeLessThanOrEqual(1);
          expect(consideration.output).toBeGreaterThanOrEqual(0);
          expect(consideration.output).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(traced).toBe(sim.agents.filter((a) => a.alive).length);
  });
});
