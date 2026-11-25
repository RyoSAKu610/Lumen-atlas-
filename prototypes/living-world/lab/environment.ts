/**
 * Environment lab. No simulation: terrain is built from the region, and the
 * environment state is taken from the query string.
 *
 *   ?seed=20261124
 *   ?hour=17.8&season=spring&weather=clear&day=1
 *   ?view=valley_overlook|spring_side|falls_view
 *   ?cam=x,y,z&target=x,y,z&fov=44
 *   ?quality=low|medium|high
 *   ?animate=1
 *   ?hud=1
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadGameDataOrThrow } from '../src/data/load';
import type { RegionLayout } from '../src/data/schema';
import type { QualityLevel, RenderContext } from '../src/render/contracts';
import { createEnvironmentLayer } from '../src/render/env/index';
import { SEASONS, WEATHERS, type DayPhase, type Season, type Weather } from '../src/sim/ids';
import { moonPosition, sunPosition, yearFraction } from '../src/sim/sky';
import { Terrain } from '../src/sim/terrain';
import type { EnvironmentState } from '../src/sim/types';

export interface EnvironmentStateQuery {
  hour: number;
  season: Season;
  weather: Weather;
  day?: number;
  seasonProgress?: number;
  weatherIntensity?: number;
  year?: number;
}

export function environmentStateFor(region: RegionLayout, opts: EnvironmentStateQuery): EnvironmentState {
  const hour = wrapHour(opts.hour);
  const season = opts.season;
  const weather = opts.weather;
  const day = opts.day ?? 1;
  const seasonProgress = opts.seasonProgress ?? 0.4;
  const year = opts.year ?? 1;
  const weatherIntensity = opts.weatherIntensity ?? 1;
  const yf = yearFraction(season, seasonProgress);
  const sun = sunPosition(hour, yf);
  const phase = (((day + 14) % 30) + 30) % 30 / 30;
  const moon = moonPosition(hour, yf, phase);
  const mean = region.climate.seasonalMeanC[season];
  const diurnal = Math.cos(((hour - 14) / 24) * Math.PI * 2) * region.climate.diurnalRangeC * 0.5;
  let temperatureC = mean + diurnal;
  if (weather === 'rain' || weather === 'storm') temperatureC -= 2.4;
  if (weather === 'fog') temperatureC -= 1.1;
  if (weather === 'snow') temperatureC = Math.min(temperatureC, -0.4);
  const windScale: Record<Weather, number> = { clear: 1, cloudy: 1.05, rain: 1.28, fog: 0.42, snow: 1.12, storm: 1.85 };
  return {
    time: (day - 1) * 86400 + hour * 3600,
    day,
    timeOfDay: hour,
    dayPhase: dayPhaseFor(hour),
    season,
    seasonProgress,
    year,
    weather,
    weatherIntensity,
    temperatureC,
    wind: {
      direction: region.wind.direction,
      speed: region.wind.speed * windScale[weather] * (0.8 + 0.2 * weatherIntensity),
    },
    sun,
    moon: { direction: moon.direction, phase },
  };
}

export interface ViewpointQuery {
  view?: string | null;
  cam?: string | null;
  target?: string | null;
  fov?: number | null;
}

export interface ViewpointCamera {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  id: string;
}

export function cameraFromViewpoint(region: RegionLayout, query: ViewpointQuery = {}): ViewpointCamera {
  const named = region.cameraViewpoints.find((view) => view.id === query.view) ?? region.cameraViewpoints[0];
  const position = parseVec3(query.cam) ?? (named ? new THREE.Vector3(...named.position) : new THREE.Vector3(90, 48, 90));
  const target = parseVec3(query.target) ?? (named ? new THREE.Vector3(...named.target) : new THREE.Vector3(0, 18, 0));
  const fov = query.fov ?? named?.fovDeg ?? 44;
  return { position, target, fov, id: query.cam ? 'custom' : (named?.id ?? 'custom') };
}

function wrapHour(hour: number): number {
  if (!Number.isFinite(hour)) return 10;
  return ((hour % 24) + 24) % 24;
}

function dayPhaseFor(hour: number): DayPhase {
  if (hour < 4.6 || hour >= 19.8) return 'night';
  if (hour < 6.7) return 'dawn';
  if (hour < 17.2) return 'day';
  return 'dusk';
}

function parseVec3(value: string | null | undefined): THREE.Vector3 | null {
  if (!value) return null;
  const parts = value.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  if (parts.length < 3) return null;
  return new THREE.Vector3(parts[0], parts[1], parts[2]);
}

function asSeason(value: string | null): Season {
  return SEASONS.includes(value as Season) ? (value as Season) : 'spring';
}

function asWeather(value: string | null): Weather {
  return WEATHERS.includes(value as Weather) ? (value as Weather) : 'clear';
}

function asQuality(value: string | null): QualityLevel {
  return value === 'low' || value === 'high' || value === 'medium' ? value : 'medium';
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const data = loadGameDataOrThrow();
  const seed = Number(params.get('seed') ?? 20261124);
  const terrain = Terrain.build(data.region, Number.isFinite(seed) ? seed : 20261124);
  const quality = asQuality(params.get('quality'));
  const animate = params.get('animate') === '1';
  const showHud = params.get('hud') === '1';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const placement = cameraFromViewpoint(data.region, {
    view: params.get('view'),
    cam: params.get('cam'),
    target: params.get('target'),
    fov: params.has('fov') ? Number(params.get('fov')) : null,
  });
  const camera = new THREE.PerspectiveCamera(placement.fov, window.innerWidth / window.innerHeight, 0.35, 5000);
  camera.position.copy(placement.position);
  camera.lookAt(placement.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(placement.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 2;
  controls.maxDistance = 700;
  controls.update();

  const species = new Map(data.species.map((profile) => [profile.id, profile]));
  const ctx: RenderContext = {
    renderer,
    scene,
    camera,
    terrain,
    region: data.region,
    art: data.art,
    species,
    quality,
  };
  const layer = createEnvironmentLayer();
  await layer.init(ctx);

  const hud = showHud ? mountHud(data.art.ui) : null;
  let hour = Number(params.get('hour') ?? 10);
  const season = asSeason(params.get('season'));
  const weather = asWeather(params.get('weather'));
  const day = Number(params.get('day') ?? 1);
  let frames = 0;
  let last = performance.now();

  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (animate) hour = wrapHour(hour + dt * 0.35);
    controls.update();
    const env = environmentStateFor(data.region, {
      hour,
      season,
      weather,
      day: Number.isFinite(day) ? day : 1,
    });
    layer.update({
      dt,
      elapsed: now / 1000,
      alpha: 1,
      timeScale: animate ? 1 : 0,
      env,
      sim: null,
    });
    renderer.render(scene, camera);
    if (hud) fillHud(hud, env, quality, camera, layer.getWind());
    frames += 1;
    if (frames === 4) (window as unknown as { __LA_READY: boolean }).__LA_READY = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function mountHud(ui: { ink: string; paper: string; accent: string; displayFont: string; bodyFont: string }): HTMLElement {
  const el = document.createElement('div');
  el.id = 'hud';
  el.style.cssText = [
    'position:absolute',
    'left:14px',
    'top:14px',
    'padding:10px 12px',
    'max-width:280px',
    `color:${ui.ink}`,
    `background:${ui.paper}`,
    `border:1px solid ${ui.accent}`,
    `font-family:${ui.bodyFont}`,
    'font-size:12px',
    'line-height:1.45',
    'letter-spacing:0.01em',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

function fillHud(
  el: HTMLElement,
  env: EnvironmentState,
  quality: QualityLevel,
  camera: THREE.PerspectiveCamera,
  wind: { direction: number; strength: number },
): void {
  const p = camera.position;
  el.textContent = [
    `${env.season}  ${env.weather}  day ${env.day}`,
    `hour ${env.timeOfDay.toFixed(2)}  ${env.dayPhase}  ${env.temperatureC.toFixed(1)}°C`,
    `quality ${quality}`,
    `cam ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
    `wind ${wind.direction.toFixed(2)} rad  ${wind.strength.toFixed(2)}`,
  ].join('\n');
}

if (typeof location !== 'undefined' && /environment\.html/.test(location.pathname)) void main();
