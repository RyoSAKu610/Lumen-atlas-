import { describe, expect, it } from 'vitest';
import { loadGameDataOrThrow } from '../../src/data/load';
import { constrainHomeRangeTarget, homeRangePressure, homeRangeRadius } from '../../src/sim/ai';

const data = loadGameDataOrThrow();

describe('family home-range behavior', () => {
  const kit = data.species.find((species) => species.id === 'kit_forager')!;
  const giant = data.species.find((species) => species.id === 'giant_grazer')!;

  it('uses a compact range for family species and a wider range for herd species', () => {
    expect(homeRangeRadius(kit)).toBe(78);
    expect(homeRangeRadius(giant)).toBe(170);
  });

  it('raises return pressure only after an individual leaves the inner home range', () => {
    const radius = homeRangeRadius(kit);
    expect(homeRangePressure(radius * 0.4, radius)).toBe(0);
    expect(homeRangePressure(radius * 0.55, radius)).toBe(0);
    expect(homeRangePressure(radius, radius)).toBe(1);
    expect(homeRangePressure(radius * 1.5, radius)).toBe(1);
  });

  it('projects exploration targets back inside the home-range boundary', () => {
    const home = { x: -53, z: 42 };
    const origin = { x: -45, z: 36 };
    const target = { x: 80, z: 160 };
    const bounded = constrainHomeRangeTarget(home, origin, target, homeRangeRadius(kit));
    expect(Math.hypot(bounded.x - home.x, bounded.z - home.z)).toBeCloseTo(78 * 0.92, 6);
  });

  it('sends an animal home when it is already outside its permitted range', () => {
    const home = { x: -53, z: 42 };
    const origin = { x: 65, z: 110 };
    const target = { x: 80, z: 160 };
    expect(constrainHomeRangeTarget(home, origin, target, homeRangeRadius(kit))).toEqual(home);
  });

  it('leaves nearby exploration targets unchanged', () => {
    const home = { x: -53, z: 42 };
    const origin = { x: -48, z: 40 };
    const target = { x: -25, z: 48 };
    expect(constrainHomeRangeTarget(home, origin, target, homeRangeRadius(kit))).toEqual(target);
  });
});
