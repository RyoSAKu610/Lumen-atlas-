import { describe, expect, it } from 'vitest';
import { loadGameDataOrThrow } from '../../src/data/load';
import { constrainHomeRangeTarget, homeRangePressure, homeRangeRadius } from '../../src/sim/ai';
import { fleeDestination } from '../../src/sim/steering';

const data = loadGameDataOrThrow();

describe('family home-range behavior', () => {
  const kit = data.species.find((species) => species.id === 'kit_forager')!;
  const giant = data.species.find((species) => species.id === 'giant_grazer')!;

  it('uses a compact range for family species and a wider range for herd species', () => {
    expect(homeRangeRadius(kit)).toBe(90);
    expect(homeRangeRadius(giant)).toBe(170);
  });

  it('raises return pressure only after an individual leaves the inner home range', () => {
    const radius = homeRangeRadius(kit);
    expect(homeRangePressure(radius * 0.6, radius)).toBe(0);
    expect(homeRangePressure(radius * 0.75, radius)).toBe(0);
    expect(homeRangePressure(radius, radius)).toBeCloseTo(1, 10);
    expect(homeRangePressure(radius * 1.5, radius)).toBeCloseTo(1, 10);
  });

  it('projects exploration targets back inside the home-range boundary', () => {
    const home = { x: -53, z: 42 };
    const origin = { x: -45, z: 36 };
    const target = { x: 80, z: 160 };
    const bounded = constrainHomeRangeTarget(home, origin, target, homeRangeRadius(kit));
    expect(Math.hypot(bounded.x - home.x, bounded.z - home.z)).toBeCloseTo(90 * 0.92, 6);
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

describe('flee home-range recovery', () => {
  it('turns a herd back toward its home landmark after it is driven outside its range', () => {
    const home = { x: 83, z: 28 };
    const origin = { x: -113, z: -184.9 };
    const threat = { x: -133.1, z: -73.5 };
    const target = fleeDestination(origin, threat, home, 170);
    expect(target).toEqual(home);
  });

  it('keeps an in-range escape destination inside the home-range boundary', () => {
    const home = { x: -53, z: 42 };
    const origin = { x: -45, z: 36 };
    const threat = { x: -70, z: -80 };
    const target = fleeDestination(origin, threat, home, 90);
    expect(Math.hypot(target.x - home.x, target.z - home.z)).toBeLessThanOrEqual(90 * 0.92 + 1e-6);
    expect(Math.hypot(target.x - origin.x, target.z - origin.z)).toBeGreaterThan(0);
  });

  it('uses a territorial center as the flee anchor and preserves a finite radius', () => {
    const territory = { x: 47, z: -60 };
    const origin = { x: 47, z: -50 };
    const threat = { x: 47, z: -20 };
    const target = fleeDestination(origin, threat, territory, 101.5);
    expect(Math.hypot(target.x - territory.x, target.z - territory.z)).toBeLessThanOrEqual(101.5 * 0.92 + 1e-6);
    expect(target.z).toBeLessThan(origin.z);
  });
});
