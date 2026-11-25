/**
 * Environment layer for Yugasumi Valley.
 *
 * Integration (observation desk / any host):
 * - Import `createEnvironmentLayer` from `src/render/env/index.ts`. It takes no required
 *   arguments (`options.quality` is only a hint; `RenderContext.quality` wins in `init`).
 * - Call `await layer.init(ctx)` before the first frame. `init` adds every object,
 *   including `layer.sun`, to `ctx.scene`.
 * - `init` sets, and `update` maintains:
 *     renderer.outputColorSpace = SRGBColorSpace
 *     renderer.toneMapping = ACESFilmicToneMapping
 *     renderer.toneMappingExposure  (from the interpolated lighting key × weather)
 *     renderer.shadowMap.enabled, shadow map type, and the sun shadow frustum
 *   The observation desk may set the same colour space and tone mapping before init.
 *   Do not also run a second fog, exposure, or shadow rig. Creature materials should be
 *   ordinary Three.js materials (linear working colour, tone-mapped). They share `layer.sun`.
 * - `update` reads `frame.env` only. It does not step the simulation.
 * - `getWind()` is `{ direction, strength }` with direction in radians (wind blows toward
 *   that heading) and strength in 0..1 (env.wind.speed / 10).
 * - Colours come from `ctx.art`. There is no second palette in this module.
 * - Terrain vertices are exactly `terrain.meshData()`; the shader does not displace them,
 *   so `heightAt` stays on the rendered ground. Water sits on `waterSurfaceAt` / pool
 *   `surfaceY` with ripples under 3 cm.
 */
import * as THREE from 'three';
import type { EnvironmentLayer, FrameState, QualityLevel, RenderContext } from '../contracts';
import type { Season } from '../../sim/ids';
import { createFoliage, type Foliage } from './foliage';
import { configureRenderer, createLightingRig, type LightingRig } from './lighting';
import { applyWeather, emptyLighting, GRADE, LookUniforms, paintPalette, sampleLighting } from './look';
import { createParticles, type ParticleField } from './particles';
import { createSky, type SkyDome } from './sky';
import { createBackdrop, createTerrainMaterial, createTerrainMesh } from './terrain';
import { createWater, type WaterLayer } from './water';

export interface EnvironmentLayerOptions {
  quality?: QualityLevel;
}

const WETNESS: Record<string, number> = {
  clear: 0,
  cloudy: 0.1,
  rain: 0.88,
  fog: 0.24,
  snow: 0.38,
  storm: 1,
};

export function createEnvironmentLayer(options?: EnvironmentLayerOptions): EnvironmentLayer {
  const look = new LookUniforms();
  const lighting: LightingRig = createLightingRig(options?.quality ?? 'medium');
  const resolved = emptyLighting();
  const wind = { direction: 0, strength: 0 };
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();

  let ctx: RenderContext | null = null;
  let root: THREE.Group | null = null;
  let sky: SkyDome | null = null;
  let foliage: Foliage | null = null;
  let water: WaterLayer | null = null;
  let particles: ParticleField | null = null;
  let terrainMat: THREE.Material | null = null;
  let painted: Season | null = null;
  let anim = 0;
  let ready = false;

  function ensureSeason(season: Season, art: RenderContext['art']): void {
    if (painted === season || !foliage) return;
    paintPalette(look, art, season);
    foliage.setSeason(season);
    painted = season;
  }

  const layer: EnvironmentLayer = {
    sun: lighting.sun,
    async init(next, onProgress) {
      ctx = next;
      const quality = next.quality;
      configureRenderer(next.renderer, quality);
      if (quality !== (options?.quality ?? 'medium')) lighting.setQuality(quality, next.renderer);
      else lighting.setQuality(quality, next.renderer);
      onProgress?.(0.08, 'light');

      const pools = next.terrain.pools;
      look.floorY.value = pools.length ? pools.reduce((sum, pool) => sum + pool.surfaceY, 0) / pools.length : 16;
      wind.direction = next.region.wind.direction;
      wind.strength = Math.min(1, next.region.wind.speed / 10);
      look.windX.value = Math.sin(wind.direction);
      look.windZ.value = Math.cos(wind.direction);

      root = new THREE.Group();
      root.name = 'environment';
      root.add(lighting.sun);
      root.add(lighting.sun.target);
      root.add(lighting.hemi);

      sky = createSky(look);
      root.add(sky.mesh);
      onProgress?.(0.2, 'sky');

      terrainMat = createTerrainMaterial(look);
      root.add(createTerrainMesh(next.terrain, terrainMat));
      root.add(createBackdrop(next.terrain, terrainMat));
      onProgress?.(0.45, 'terrain');

      water = createWater(next.terrain, look);
      for (const obj of water.objects) root.add(obj);
      onProgress?.(0.62, 'water');

      foliage = createFoliage(next.terrain, next.art, look, lighting.settings);
      for (const obj of foliage.objects) root.add(obj);
      ensureSeason('spring', next.art);
      foliage.update(next.camera);
      onProgress?.(0.84, 'foliage');

      particles = createParticles(next.terrain, look);
      for (const obj of particles.objects) root.add(obj);

      next.scene.add(root);
      next.scene.fog = new THREE.FogExp2(look.fogColor.value.clone(), 0.002);
      ready = true;
      onProgress?.(1, 'environment');
    },
    update(frame: FrameState) {
      if (!ready || !ctx || !sky || !foliage || !particles) return;
      const env = frame.env;
      const art = ctx.art;
      sampleLighting(art.lighting, env.timeOfDay, resolved);
      applyWeather(resolved, art, env.weather, env.weatherIntensity);
      ensureSeason(env.season, art);

      look.sunColor.value.copy(resolved.sunColor);
      look.sunIntensity.value = resolved.sunIntensity;
      look.hemiSky.value.copy(resolved.hemiSky);
      look.hemiGround.value.copy(resolved.hemiGround);
      look.hemiIntensity.value = resolved.hemiIntensity;
      look.zenith.value.copy(resolved.skyZenith);
      look.horizon.value.copy(resolved.skyHorizon);
      look.glow.value.copy(resolved.sunGlow);
      look.fogColor.value.copy(resolved.fogColor);
      look.fogDensity.value = resolved.fogDensity;
      look.stars.value = resolved.starsOpacity;
      const weather = art.weather[env.weather];
      const blend = THREE.MathUtils.clamp(env.weatherIntensity, 0, 1);
      look.cloud.value = weather.cloudCover * blend;

      sunDir.set(env.sun.direction.x, env.sun.direction.y, env.sun.direction.z);
      if (sunDir.lengthSq() < 1e-6) sunDir.set(0.25, 0.2, 0.2);
      sunDir.normalize();
      moonDir.set(env.moon.direction.x, env.moon.direction.y, env.moon.direction.z);
      if (moonDir.lengthSq() < 1e-6) moonDir.set(-0.3, 0.5, 0.2);
      moonDir.normalize();
      look.sunDir.value.copy(sunDir);
      look.moonDir.value.copy(moonDir);
      look.moonPhase.value = env.moon.phase;
      look.sunElev.value = env.sun.elevation;
      look.night.value = 1 - THREE.MathUtils.smoothstep(env.sun.elevation, -0.06, 0.14);

      const seasonalSnow = art.seasons[env.season].snowCover;
      let snow = seasonalSnow;
      if (env.weather === 'snow') snow = Math.min(1, seasonalSnow + 0.4 * blend);
      else if (env.weather === 'storm' && env.season === 'winter') snow = Math.min(1, seasonalSnow + 0.22 * blend);
      look.snow.value = snow;
      look.wet.value = (WETNESS[env.weather] ?? 0) * Math.max(blend, env.weather === 'clear' ? 0 : 0.65);

      wind.direction = env.wind.direction;
      wind.strength = Math.min(1, Math.max(0, env.wind.speed / 10));
      look.windX.value = Math.sin(wind.direction);
      look.windZ.value = Math.cos(wind.direction);
      look.windAmp.value = 0.18 + wind.strength * 1.45;

      anim += Math.min(0.1, frame.dt) * frame.timeScale;
      look.time.value = anim;

      const baseMist = THREE.MathUtils.clamp(0.26 - resolved.fogDensity * 6, 0.04, 0.26);
      const twilight = 1 - THREE.MathUtils.clamp(env.sun.elevation / 0.45, 0, 1);
      look.mist.value = baseMist * GRADE.mistScale * (1 + twilight * 0.18);

      ctx.renderer.toneMappingExposure = resolved.exposure * GRADE.exposure;
      const fog = ctx.scene.fog;
      if (fog && 'density' in fog) {
        fog.color.copy(look.fogColor.value);
        fog.density = look.fogDensity.value;
      }
      ctx.renderer.setClearColor(look.fogColor.value);

      lighting.apply(look, resolved, ctx.camera, ctx.terrain);
      sky.follow(ctx.camera);
      foliage.update(ctx.camera);
      particles.sync({
        weather: env.weather,
        season: env.season,
        hour: env.timeOfDay,
        temperatureC: env.temperatureC,
        scale: lighting.settings.particleScale,
        camera: ctx.camera,
      });
    },
    getWind() {
      return wind;
    },
    setQuality(quality: QualityLevel) {
      if (!ctx) return;
      lighting.setQuality(quality, ctx.renderer);
      foliage?.setQuality(lighting.settings);
    },
    dispose() {
      ready = false;
      root?.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.name === 'terrain' || mesh.name === 'backdrop') mesh.geometry?.dispose();
      });
      foliage?.dispose();
      water?.dispose();
      particles?.dispose();
      sky?.dispose();
      terrainMat?.dispose();
      lighting.dispose();
      root?.removeFromParent();
      if (ctx) ctx.scene.fog = null;
      foliage = null;
      water = null;
      particles = null;
      sky = null;
      root = null;
      ctx = null;
    },
  };
  return layer;
}
