/**
 * Key light, hemisphere, exponential fog, and a camera-following shadow frustum.
 *
 * init() sets renderer.toneMapping, outputColorSpace, and shadowMap so the lab
 * (which has no integrator) matches the observation desk. The desk may set the
 * same values first; exposure is updated here every frame from the lighting keys.
 */
import * as THREE from 'three';
import type { QualityLevel } from '../contracts';
import type { Terrain } from '../../sim/terrain';
import { GRADE, type LookUniforms, type ResolvedLighting } from './look';

export interface QualitySettings {
  shadowMap: number;
  shadowType: THREE.ShadowMapType;
  shadowRadius: number;
  shadowBlur: number;
  grassRadius: number;
  grassSpacing: number;
  particleScale: number;
  fillerScale: number;
}

export function qualitySettings(level: QualityLevel): QualitySettings {
  if (level === 'high') {
    return {
      shadowMap: 2048,
      shadowType: THREE.PCFSoftShadowMap,
      shadowRadius: 120,
      shadowBlur: 2,
      grassRadius: 68,
      grassSpacing: 1.45,
      particleScale: 1,
      fillerScale: 1,
    };
  }
  if (level === 'medium') {
    return {
      shadowMap: 1024,
      shadowType: THREE.PCFShadowMap,
      shadowRadius: 100,
      shadowBlur: 1.25,
      grassRadius: 48,
      grassSpacing: 1.9,
      particleScale: 0.7,
      fillerScale: 0.85,
    };
  }
  return {
    shadowMap: 512,
    shadowType: THREE.PCFShadowMap,
    shadowRadius: 84,
    shadowBlur: 1,
    grassRadius: 34,
    grassSpacing: 2.7,
    particleScale: 0.42,
    fillerScale: 0.55,
  };
}

export interface LightingRig {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly settings: QualitySettings;
  setQuality(level: QualityLevel, renderer: THREE.WebGLRenderer): void;
  apply(look: LookUniforms, resolved: ResolvedLighting, camera: THREE.Camera, terrain: Terrain): void;
  dispose(): void;
}

export function createLightingRig(quality: QualityLevel): LightingRig {
  const sun = new THREE.DirectionalLight('#fff5e4', 2);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.bias = GRADE.shadowBias;
  sun.shadow.normalBias = GRADE.normalBias;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 460;
  const hemi = new THREE.HemisphereLight('#b7d0de', '#4d5842', 0.8);
  hemi.name = 'sky-hemi';
  const settings = qualitySettings(quality);
  applyShadow(sun, settings);

  const focus = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const view = new THREE.Vector3();

  return {
    sun,
    hemi,
    get settings() {
      return settings;
    },
    setQuality(level, renderer) {
      const next = qualitySettings(level);
      settings.shadowMap = next.shadowMap;
      settings.shadowType = next.shadowType;
      settings.shadowRadius = next.shadowRadius;
      settings.shadowBlur = next.shadowBlur;
      settings.grassRadius = next.grassRadius;
      settings.grassSpacing = next.grassSpacing;
      settings.particleScale = next.particleScale;
      settings.fillerScale = next.fillerScale;
      applyShadow(sun, settings);
      renderer.shadowMap.type = settings.shadowType;
      renderer.shadowMap.needsUpdate = true;
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    },
    apply(look, resolved, camera, terrain) {
      sun.color.copy(resolved.sunColor);
      sun.intensity = resolved.sunIntensity;
      hemi.color.copy(resolved.hemiSky);
      hemi.groundColor.copy(resolved.hemiGround);
      hemi.intensity = resolved.hemiIntensity;

      const night = 1 - THREE.MathUtils.smoothstep(resolvedSunElev(look), -0.04, 0.16);
      dir.copy(look.sunDir.value).lerp(look.moonDir.value, night);
      if (dir.y < 0.08) dir.y = 0.08;
      dir.normalize();

      focusOnGround(camera, terrain, view, focus);
      const dist = Math.max(24, camera.position.distanceTo(focus));
      const radius = THREE.MathUtils.clamp(dist * 0.62, settings.shadowRadius * 0.55, settings.shadowRadius);
      sun.position.copy(focus).addScaledVector(dir, 170);
      sun.target.position.copy(focus);
      const cam = sun.shadow.camera as THREE.OrthographicCamera;
      cam.left = -radius;
      cam.right = radius;
      cam.top = radius;
      cam.bottom = -radius;
      cam.near = 2;
      cam.far = 420;
      cam.updateProjectionMatrix();
      sun.shadow.radius = settings.shadowBlur;
    },
    dispose() {
      sun.dispose();
      hemi.dispose();
    },
  };
}

function resolvedSunElev(look: LookUniforms): number {
  return look.sunElev.value;
}

function applyShadow(sun: THREE.DirectionalLight, settings: QualitySettings): void {
  sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
  sun.shadow.bias = GRADE.shadowBias;
  sun.shadow.normalBias = settings.shadowMap <= 512 ? GRADE.normalBias + 0.18 : GRADE.normalBias;
}

function focusOnGround(camera: THREE.Camera, terrain: Terrain, view: THREE.Vector3, focus: THREE.Vector3): void {
  camera.getWorldDirection(view);
  const origin = camera.position;
  focus.copy(origin).addScaledVector(view, 36);
  for (let d = 10; d <= 200; d += 8) {
    const x = origin.x + view.x * d;
    const z = origin.z + view.z * d;
    if (!terrain.inBounds(x, z, 1)) break;
    const ground = terrain.surfaceHeightAt(x, z);
    const y = origin.y + view.y * d;
    focus.set(x, ground + 1.2, z);
    if (y <= ground + 1.2) return;
  }
}

export function configureRenderer(renderer: THREE.WebGLRenderer, quality: QualityLevel): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = qualitySettings(quality).shadowType;
  renderer.shadowMap.autoUpdate = true;
}
