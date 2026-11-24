import { describe, expect, it } from 'vitest';
import { loadGameData, loadGameDataOrThrow } from '../src/data/load';
import { Rng, hashString } from '../src/sim/rng';
import { sunPosition, yearFraction } from '../src/sim/sky';
import { Terrain } from '../src/sim/terrain';

const data = loadGameDataOrThrow();

function hashFloats(a: Float32Array): number {
  return hashString(Array.from(a, (v) => (Number.isNaN(v) ? 'n' : v.toFixed(4))).join(','));
}

describe('foundation: data', () => {
  it('bundled data validates with no errors', () => {
    const { data: d, diagnostics } = loadGameData();
    expect(diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
    expect(d).not.toBeNull();
  });
});

describe('foundation: rng', () => {
  it('is deterministic per seed and restorable from state', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
    const state = a.getState();
    const next = Array.from({ length: 10 }, () => a.next());
    const c = new Rng(state);
    expect(Array.from({ length: 10 }, () => c.next())).toEqual(next);
  });

  it('named streams are independent', () => {
    expect(Rng.stream(1, 'ecology').next()).not.toEqual(Rng.stream(1, 'weather').next());
  });
});

describe('foundation: terrain', () => {
  const t1 = Terrain.build(data.region, 1234);

  it('is deterministic for a seed', () => {
    const t2 = Terrain.build(data.region, 1234);
    expect(hashFloats(t2.heights)).toBe(hashFloats(t1.heights));
    expect(t2.trees.length).toBe(t1.trees.length);
    expect(t2.trees[10]).toEqual(t1.trees[10]);
  });

  it('heightAt matches mesh vertices and stays within triangles', () => {
    const m = t1.meshData();
    for (const idx of [0, 1000, 20000, 33000, m.positions.length / 3 - 1]) {
      const x = m.positions[idx * 3];
      const y = m.positions[idx * 3 + 1];
      const z = m.positions[idx * 3 + 2];
      expect(t1.heightAt(x, z)).toBeCloseTo(y, 4);
    }
  });

  it('has a hot spring with water and walkable valley floor', () => {
    const spring = t1.pools.find((p) => p.kind === 'hot_spring')!;
    expect(spring).toBeDefined();
    expect(t1.waterDepthAt(spring.x, spring.z)).toBeGreaterThan(0.3);
    expect(t1.surfaceAt(spring.x, spring.z)).toBe('hot_spring');
    const meadow = data.region.zones.find((z) => z.kind === 'meadow')!;
    expect(t1.isWalkable(meadow.center[0], meadow.center[1], 30)).toBe(true);
  });
});

describe('foundation: sky', () => {
  it('puts the noon sun in the south and night sun below the horizon', () => {
    const noon = sunPosition(12, yearFraction('summer', 0.1));
    expect(noon.elevation).toBeGreaterThan(1);
    expect(noon.direction.z).toBeGreaterThan(0);
    expect(sunPosition(0, yearFraction('summer', 0.1)).elevation).toBeLessThan(0);
    const morning = sunPosition(7, yearFraction('spring', 0));
    expect(morning.direction.x).toBeGreaterThan(0);
  });
});
