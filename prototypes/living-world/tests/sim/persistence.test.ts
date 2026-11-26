import { describe, expect, it } from 'vitest';
import { loadGameDataOrThrow } from '../../src/data/load';
import { offlineGameSeconds, readWorldSnapshot, writeWorldSnapshot, type SnapshotStorage } from '../../src/sim/persistence';
import { Simulation } from '../../src/sim/Simulation';
import { fingerprint, step } from './helpers';

class MemoryStorage implements SnapshotStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const bundle = (() => {
  const data = loadGameDataOrThrow();
  return { region: data.region, species: data.species };
})();

describe('browser world persistence', () => {
  it('saves a checksummed world and reads it back without changing the snapshot', () => {
    const storage = new MemoryStorage();
    const sim = Simulation.create(bundle, { seed: 42 });
    step(sim, 150);
    const snapshot = sim.snapshot(1_000);
    const written = writeWorldSnapshot(storage, 'world:test', snapshot);
    expect(written.saved).toBe(true);

    const read = readWorldSnapshot(storage, 'world:test');
    expect(read.status).toBe('ready');
    expect(read.snapshot).toEqual(snapshot);
    const restored = Simulation.restore(read.snapshot!, bundle);
    expect(fingerprint(restored)).toBe(fingerprint(sim));
  });

  it('removes an unsupported storage envelope and falls back safely', () => {
    const storage = new MemoryStorage();
    storage.setItem('world:test', JSON.stringify({ formatVersion: 999, snapshot: {} }));
    const read = readWorldSnapshot(storage, 'world:test');
    expect(read.status).toBe('corrupt');
    expect(read.snapshot).toBeNull();
    expect(storage.getItem('world:test')).toBeNull();
  });

  it('does not crash when storage is unavailable or quota is exhausted', () => {
    expect(readWorldSnapshot(null, 'world:test').status).toBe('unavailable');
    const sim = Simulation.create(bundle, { seed: 3 });
    const quotaStorage: SnapshotStorage = {
      getItem: () => null,
      setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); },
      removeItem: () => undefined,
    };
    const result = writeWorldSnapshot(quotaStorage, 'world:test', sim.snapshot(10));
    expect(result.saved).toBe(false);
    expect(result.message).toContain('容量');
  });

  it('converts elapsed wall-clock time to game time and clamps clock rollback', () => {
    expect(offlineGameSeconds(1_000, 11_000, 60)).toBe(600);
    expect(offlineGameSeconds(11_000, 1_000, 60)).toBe(0);
    expect(offlineGameSeconds(1_000, 11_000, 0)).toBe(0);
    expect(offlineGameSeconds(Number.NaN, 11_000, 60)).toBe(0);
  });

  it('restores the same world and advances it during offline catch-up', () => {
    const sim = Simulation.create(bundle, { seed: 17 });
    step(sim, 80);
    const snapshot = sim.snapshot(1_000);
    const restored = Simulation.restore(snapshot, bundle);
    const elapsed = offlineGameSeconds(snapshot.savedAtWallClockMs, 6_000, restored.config.clockScale);
    const report = restored.catchUp(elapsed);
    expect(report.requestedGameSeconds).toBe(300);
    expect(report.simulatedGameSeconds).toBeGreaterThan(298);
    expect(restored.tick).toBeGreaterThan(sim.tick);
    expect(restored.agents.map((agent) => agent.id)).toEqual(sim.agents.map((agent) => agent.id));
    expect(restored.recentEvents(100).some((event) => event.type === 'system.catchup')).toBe(true);
  });
});
