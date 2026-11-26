import { describe, expect, it } from 'vitest';
import { loadGameDataOrThrow } from '../../src/data/load';
import { Simulation } from '../../src/sim/Simulation';
import { Terrain } from '../../src/sim/terrain';
import { generateDrinkSpots, nearestAccessibleDrinkSpot, shouldRefreshWaterMemory } from '../../src/sim/spatial';
import { place } from './helpers';

const data = loadGameDataOrThrow();
const terrain = Terrain.build(data.region, 20261126);
const spots = generateDrinkSpots(terrain);

describe('water access geometry', () => {
  it('generates only stable, shallow drinkable banks close to a real water feature', () => {
    expect(spots.length).toBeGreaterThan(24);
    for (const spot of spots) {
      expect(terrain.isWalkable(spot.x, spot.z, 50, 0.35)).toBe(true);
      const nearRiver = terrain.riverSamples.some((sample) => {
        const d = Math.hypot(spot.x - sample.x, spot.z - sample.z);
        return d <= sample.halfWidth + 0.7;
      });
      const nearPool = terrain.pools.some((pool) => {
        const d = Math.hypot(spot.x - pool.x, spot.z - pool.z);
        return d <= pool.radius + 0.7 && !(pool.kind === 'hot_spring' && pool.temperatureC > 36);
      });
      expect(nearRiver || nearPool).toBe(true);
    }
  });

  it('chooses the nearest bank that is walkable for the species, not a closer steep bank', () => {
    const kit = data.species.find((species) => species.id === 'kit_forager')!;
    const unsafe = terrain;
    let steep: { x: number; z: number } | null = null;
    for (let x = -180; x <= 180 && !steep; x += 4) {
      for (let z = -180; z <= 180; z += 4) {
        if (unsafe.inBounds(x, z, 4) && !unsafe.isWalkable(x, z, kit.locomotion.maxSlopeDeg, 0.35)) {
          steep = { x, z };
          break;
        }
      }
    }
    expect(steep).not.toBeNull();
    const position = { x: steep!.x, z: steep!.z };
    const result = nearestAccessibleDrinkSpot(
      terrain,
      [position, ...spots],
      position.x,
      position.z,
      kit.locomotion.maxSlopeDeg,
    );
    expect(result).not.toBeNull();
    expect(terrain.isWalkable(result!.x, result!.z, kit.locomotion.maxSlopeDeg, 0.35)).toBe(true);
  });

  it('refreshes a distant remembered source when a much closer safe bank is known', () => {
    const position = { x: -120.7, z: -100.6 };
    const kit = data.species.find((species) => species.id === 'kit_forager')!;
    const nearest = nearestAccessibleDrinkSpot(terrain, spots, position.x, position.z, kit.locomotion.maxSlopeDeg);
    expect(nearest).not.toBeNull();
    const stale = { x: -24.4, z: -17.1 };
    expect(shouldRefreshWaterMemory(terrain, stale, nearest, position.x, position.z, kit.locomotion.maxSlopeDeg)).toBe(true);
  });

  it('does not thrash between two nearly equivalent safe drink spots', () => {
    const current = { x: -100, z: -90 };
    const candidate = { x: -96, z: -90 };
    expect(shouldRefreshWaterMemory(terrain, current, candidate, -90, -90, 40)).toBe(false);
  });
});

describe('water memory integration', () => {
  it('replaces a stale central-valley water memory with a local source after the individual moves', () => {
    const sim = Simulation.create({ region: data.region, species: data.species }, { seed: 20261126 });
    const kit = sim.agents.find((agent) => agent.speciesId === 'kit_forager' && agent.lifeStage === 'adult');
    expect(kit).toBeDefined();
    const position = { x: -120.7, z: -100.6 };
    place(sim, kit!, position.x, position.z);
    kit!.speed = 0;
    kit!.needs.thirst = 0.85;
    kit!.memory.water = { x: -24.4, z: -17.1 };

    for (let i = 0; i < 35; i++) sim.step();

    expect(kit!.memory.water).not.toBeNull();
    const remainingDistance = Math.hypot(
      kit!.memory.water!.x - kit!.pos.x,
      kit!.memory.water!.z - kit!.pos.z,
    );
    expect(remainingDistance).toBeLessThan(30);
    expect(kit!.causeOfDeath).toBeNull();
  });
});
