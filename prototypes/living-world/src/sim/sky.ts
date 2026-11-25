import { SEASONS, type Season } from './ids';
import type { Vec3 } from './types';

/** Mid-latitude northern-hemisphere valley; only used for sun/moon geometry. */
export const DEFAULT_LATITUDE_DEG = 36.5;
const DEG = Math.PI / 180;

/** Fraction of the year (0..1) for a season and its progress; spring starts at the March equinox. */
export function yearFraction(season: Season, seasonProgress: number): number {
  const s = SEASONS.indexOf(season);
  return (((s + seasonProgress) * 91.25 + 79) % 365) / 365;
}

/**
 * Unit vector toward the sun (+X east, +Z south, +Y up) and its elevation in radians.
 * Simple declination / hour-angle model; adequate for lighting, not for astronomy.
 */
export function sunPosition(timeOfDay: number, yearFrac: number, latitudeDeg = DEFAULT_LATITUDE_DEG): { direction: Vec3; elevation: number } {
  const phi = latitudeDeg * DEG;
  const decl = -23.44 * DEG * Math.cos(2 * Math.PI * (yearFrac * 365 + 10) / 365);
  const H = (timeOfDay - 12) * 15 * DEG;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
  const c = Math.cos(el);
  return { direction: { x: Math.sin(az) * c, y: Math.sin(el), z: -Math.cos(az) * c }, elevation: el };
}

/** Approximate moon position: trails the sun by the lunar phase (0 = new, 0.5 = full). */
export function moonPosition(timeOfDay: number, yearFrac: number, phase: number, latitudeDeg = DEFAULT_LATITUDE_DEG): { direction: Vec3 } {
  const t = (((timeOfDay - phase * 24) % 24) + 24) % 24;
  return { direction: sunPosition(t, (yearFrac + 0.5) % 1, latitudeDeg).direction };
}
