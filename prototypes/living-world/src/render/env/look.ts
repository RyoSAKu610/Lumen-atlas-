/**
 * Shared per-frame look. Every colour comes from ArtDirection; this only holds
 * the interpolated, weather-graded values the shaders and lights read.
 */
import * as THREE from 'three';
import type { ArtDirection, LightingKey } from '../../data/schema';
import type { Season, Weather } from '../../sim/ids';

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export interface ResolvedLighting {
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  sunGlow: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  exposure: number;
  starsOpacity: number;
}

function lerpColor(out: THREE.Color, a: string, b: string, t: number): THREE.Color {
  tmpA.set(a);
  tmpB.set(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

function smooth(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Hour 0 and hour 24 are the same key. timeOfDay wraps onto [0, 24). */
export function sampleLighting(keys: readonly LightingKey[], timeOfDay: number, out: ResolvedLighting): ResolvedLighting {
  const hour = ((timeOfDay % 24) + 24) % 24;
  let i = 0;
  for (; i < keys.length - 1; i++) {
    if (hour <= keys[i + 1].hour) break;
  }
  const a = keys[i];
  const b = keys[Math.min(keys.length - 1, i + 1)];
  const span = b.hour - a.hour;
  const t = span <= 1e-4 ? 0 : smooth((hour - a.hour) / span);
  lerpColor(out.sunColor, a.sunColor, b.sunColor, t);
  lerpColor(out.hemiSky, a.hemiSky, b.hemiSky, t);
  lerpColor(out.hemiGround, a.hemiGround, b.hemiGround, t);
  lerpColor(out.skyZenith, a.skyZenith, b.skyZenith, t);
  lerpColor(out.skyHorizon, a.skyHorizon, b.skyHorizon, t);
  lerpColor(out.sunGlow, a.sunGlow, b.sunGlow, t);
  lerpColor(out.fogColor, a.fogColor, b.fogColor, t);
  out.sunIntensity = THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, t);
  out.hemiIntensity = THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, t);
  out.fogDensity = THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, t);
  out.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t);
  out.starsOpacity = THREE.MathUtils.lerp(a.starsOpacity, b.starsOpacity, t);
  return out;
}

function grade(out: THREE.Color, saturation: number, tint: THREE.Color, tintAmt: number): void {
  const l = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722;
  out.r = l + (out.r - l) * saturation;
  out.g = l + (out.g - l) * saturation;
  out.b = l + (out.b - l) * saturation;
  if (tintAmt > 0) out.lerp(tint, tintAmt);
}

export function applyWeather(look: ResolvedLighting, art: ArtDirection, weather: Weather, intensity: number): void {
  const w = art.weather[weather];
  const k = THREE.MathUtils.clamp(intensity, 0, 1);
  const sat = THREE.MathUtils.lerp(1, w.saturation, k);
  tmpA.set(w.tint);
  const tintAmt = (1 - Math.min(sat, 1)) * 0.42 * k + w.cloudCover * 0.05 * k;
  grade(look.sunColor, sat, tmpA, tintAmt * 0.65);
  grade(look.hemiSky, sat, tmpA, tintAmt);
  grade(look.hemiGround, sat, tmpA, tintAmt * 0.8);
  grade(look.skyZenith, sat, tmpA, tintAmt * 0.85);
  grade(look.skyHorizon, sat, tmpA, tintAmt);
  grade(look.sunGlow, sat, tmpA, tintAmt * 0.45);
  grade(look.fogColor, sat, tmpA, Math.min(0.55, tintAmt + 0.12 * k));
  const light = THREE.MathUtils.lerp(1, w.lightMultiplier, k);
  look.sunIntensity *= light;
  look.hemiIntensity *= light;
  look.fogDensity *= THREE.MathUtils.lerp(1, w.fogMultiplier, k);
  look.starsOpacity *= THREE.MathUtils.lerp(1, 1 - w.cloudCover, k);
}

/** Tunable grades that are not a second palette — multipliers on the art keys. */
export const GRADE = {
  /** Multiplies the interpolated lighting-key exposure. */
  exposure: 1.04,
  /** Extra basin mist on clear days. Fades itself out when art fog is already thick. */
  mistScale: 1,
  shadowBias: -0.00035,
  normalBias: 1.05,
};

export class LookUniforms {
  readonly fogColor = { value: new THREE.Color() };
  readonly fogDensity = { value: 0.002 };
  readonly floorY = { value: 16 };
  readonly mist = { value: 0.4 };
  readonly sunDir = { value: new THREE.Vector3(0.3, 0.8, 0.2) };
  readonly sunColor = { value: new THREE.Color('#fff4e0') };
  readonly sunIntensity = { value: 2 };
  readonly hemiSky = { value: new THREE.Color('#9db7c9') };
  readonly hemiGround = { value: new THREE.Color('#494336') };
  readonly hemiIntensity = { value: 0.8 };
  readonly snow = { value: 0 };
  readonly wet = { value: 0 };
  readonly night = { value: 0 };
  readonly painterly = { value: 0.68 };
  readonly windX = { value: 0.2 };
  readonly windZ = { value: 0.8 };
  readonly windAmp = { value: 0.2 };
  readonly time = { value: 0 };
  readonly stars = { value: 0 };
  readonly cloud = { value: 0.1 };
  readonly zenith = { value: new THREE.Color('#4c82ad') };
  readonly horizon = { value: new THREE.Color('#c9dce0') };
  readonly glow = { value: new THREE.Color('#fff2d3') };
  readonly moonDir = { value: new THREE.Vector3(-0.2, 0.5, 0.3) };
  readonly moonPhase = { value: 0.5 };
  readonly sunElev = { value: 0.4 };
  readonly flowerOn = { value: 1 };
  readonly grassBase = { value: new THREE.Color() };
  readonly grassTip = { value: new THREE.Color() };
  readonly flower = { value: new THREE.Color() };
  readonly meadowDry = { value: new THREE.Color() };
  readonly moss = { value: new THREE.Color() };
  readonly sulfur = { value: new THREE.Color() };
  readonly snowCol = { value: new THREE.Color() };
  readonly seasonGround = { value: new THREE.Color() };
  readonly forest = { value: new THREE.Color() };
  readonly surf = Array.from({ length: 14 }, () => ({ value: new THREE.Color() }));
  readonly shallow = { value: new THREE.Color() };
  readonly deep = { value: new THREE.Color() };
  readonly hotShallow = { value: new THREE.Color() };
  readonly hotDeep = { value: new THREE.Color() };
  readonly foam = { value: new THREE.Color() };
  readonly steam = { value: new THREE.Color() };
  readonly petal = { value: new THREE.Color() };
  readonly firefly = { value: new THREE.Color() };
  readonly godRays = { value: 0.4 };
  readonly steamOpacity = { value: 0.6 };
  readonly petalRate = { value: 0 };
  readonly fade0 = { value: 18 };
  readonly fade1 = { value: 36 };

  bindFog(target: Record<string, { value: unknown }>): void {
    target.uFogColor = this.fogColor;
    target.uFogDensity = this.fogDensity;
    target.uFloorY = this.floorY;
    target.uMist = this.mist;
  }
}

const SURF_MIX: Array<(art: ArtDirection, season: Season, out: THREE.Color) => void> = [
  (art, season, out) => out.set(art.terrain.meadow).lerp(tmpA.set(art.seasons[season].grassBase), 0.42),
  (art, season, out) => out.set(art.terrain.meadow).lerp(tmpA.set(art.seasons[season].grassTip), 0.3),
  (art, season, out) =>
    out.set(art.terrain.forestFloor).lerp(tmpA.set(art.seasons[season].sakuraCanopy), season === 'spring' ? 0.24 : 0.08),
  (art, season, out) => out.set(art.terrain.forestFloor).lerp(tmpA.set(art.seasons[season].cedar), 0.34),
  (art, season, out) =>
    out.set(art.terrain.forestFloor).lerp(tmpA.set(art.seasons[season].mapleCanopy), season === 'autumn' ? 0.32 : 0.1),
  (art, _season, out) => out.set(art.terrain.marsh),
  (art, _season, out) => out.set(art.terrain.moss).lerp(tmpA.set(art.terrain.rock), 0.28),
  (art, _season, out) => out.set(art.terrain.rock),
  (art, _season, out) => out.set(art.terrain.cliff),
  (art, _season, out) => out.set(art.terrain.sinter),
  (art, _season, out) => out.set(art.terrain.riverbed),
  (art, _season, out) => out.set(art.terrain.riverbed).lerp(tmpA.set(art.water.deep), 0.62),
  (art, _season, out) => out.set(art.terrain.riverbed).lerp(tmpA.set(art.water.deep), 0.55),
  (art, _season, out) => out.set(art.terrain.sinter).lerp(tmpA.set(art.water.hotSpringDeep), 0.38),
];

export function paintPalette(look: LookUniforms, art: ArtDirection, season: Season): void {
  const s = art.seasons[season];
  for (let i = 0; i < 14; i++) SURF_MIX[i](art, season, look.surf[i].value);
  look.grassBase.value.set(s.grassBase);
  look.grassTip.value.set(s.grassTip);
  look.flower.value.set(s.flowerAccent ?? s.grassTip);
  look.flowerOn.value = s.flowerAccent ? 1 : 0;
  look.meadowDry.value.set(art.terrain.meadowDry);
  look.moss.value.set(art.terrain.moss);
  look.sulfur.value.set(art.terrain.sulfur);
  look.snowCol.value.set(art.terrain.snow);
  look.seasonGround.value.set(s.ground);
  look.forest.value.set(art.terrain.forestFloor);
  look.shallow.value.set(art.water.shallow).lerp(tmpA.set(s.waterTint), 0.35);
  look.deep.value.set(art.water.deep);
  look.hotShallow.value.set(art.water.hotSpringShallow);
  look.hotDeep.value.set(art.water.hotSpringDeep);
  look.foam.value.set(art.water.foam);
  look.steam.value.set(art.water.steam);
  look.petal.value.set(s.petalColor);
  look.firefly.value.set(art.atmosphere.fireflyColor);
  look.painterly.value = art.atmosphere.painterly;
  look.godRays.value = art.atmosphere.godRays;
  look.steamOpacity.value = art.atmosphere.steamOpacity;
  look.petalRate.value = s.petalRate;
}

export function emptyLighting(): ResolvedLighting {
  return {
    sunColor: new THREE.Color(),
    sunIntensity: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0.5,
    skyZenith: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    sunGlow: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogDensity: 0.002,
    exposure: 1,
    starsOpacity: 0,
  };
}
