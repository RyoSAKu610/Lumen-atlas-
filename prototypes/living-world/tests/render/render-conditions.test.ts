import { describe, expect, it } from 'vitest';
import { animationDeltaSeconds } from '../../src/render/creatures/timing';
import { weatherLightFactors } from '../../src/render/env/look';

describe('creature animation clock', () => {
  it('matches the observation desk speed presets through 20×', () => {
    expect(animationDeltaSeconds(0.05, 0)).toBe(0);
    expect(animationDeltaSeconds(0.05, 1)).toBeCloseTo(0.05, 10);
    expect(animationDeltaSeconds(0.05, 4)).toBeCloseTo(0.2, 10);
    expect(animationDeltaSeconds(0.05, 20)).toBeCloseTo(1, 10);
  });

  it('clamps a long frame before applying speed to prevent animation jumps', () => {
    expect(animationDeltaSeconds(0.5, 4)).toBeCloseTo(0.2, 10);
    expect(animationDeltaSeconds(-1, 4)).toBe(0);
    expect(animationDeltaSeconds(Number.NaN, 4)).toBe(0);
    expect(animationDeltaSeconds(0.05, Number.POSITIVE_INFINITY)).toBe(0);
    expect(animationDeltaSeconds(0.05, 100)).toBeCloseTo(1, 10);
  });
});

describe('weather lighting balance', () => {
  it('dims direct sun strongly while retaining diffuse ambient fill in rain and storms', () => {
    const rain = weatherLightFactors(0.48, 1);
    const storm = weatherLightFactors(0.26, 1);
    expect(rain.direct).toBeCloseTo(0.48, 10);
    expect(storm.direct).toBeCloseTo(0.26, 10);
    expect(rain.ambient).toBeGreaterThanOrEqual(0.72);
    expect(storm.ambient).toBeGreaterThanOrEqual(0.72);
    expect(rain.ambient).toBeGreaterThan(rain.direct);
    expect(storm.ambient).toBeGreaterThan(storm.direct);
  });

  it('blends weather gradually and leaves clear weather unchanged', () => {
    expect(weatherLightFactors(1.08, 1)).toEqual({ direct: 1.08, ambient: 1.08 });
    const halfRain = weatherLightFactors(0.48, 0.5);
    expect(halfRain.direct).toBeCloseTo(0.74, 10);
    expect(halfRain.ambient).toBeGreaterThan(halfRain.direct);
  });

  it('fails safe for non-finite weather inputs', () => {
    expect(weatherLightFactors(Number.NaN, 1)).toEqual({ direct: 1, ambient: 1 });
    expect(weatherLightFactors(0.4, Number.NaN)).toEqual({ direct: 1, ambient: 1 });
  });
});
