import * as THREE from 'three';
import { loadGameDataOrThrow } from '../data/load';
import type { GameData, RegionLayout, SpeciesProfile } from '../data/schema';
import { buildDossier } from '../observe/dossier';
import { DocumentaryCamera, type CameraAgent, type CameraWorld } from '../observe/camera';
import { formatClock, narrateEvent, nicknameFor, speciesName } from '../observe/narrate';
import type { CreatureLayer, EnvironmentLayer, QualityLevel, RenderContext } from '../render/contracts';
import type { Season, Weather } from '../sim/ids';
import { Terrain } from '../sim/terrain';
import type { AgentId, CatchUpReport, SimConfig, SimulationView, WorldSnapshot } from '../sim/types';
import { offlineGameSeconds, readWorldSnapshot, WORLD_STORAGE_FORMAT_VERSION, writeWorldSnapshot, type SnapshotStorage } from '../sim/persistence';
import { mountShell } from '../ui/shell';

export interface SimHandle extends SimulationView {
  step(): void;
  advance(realSeconds: number, speed: number, maxSteps?: number): { steps: number; alpha: number };
  setOverrides(overrides: { season?: Season | null; weather?: Weather | null }): void;
  snapshot(savedAtWallClockMs?: number): WorldSnapshot;
  catchUp(gameSeconds: number, onProgress?: (fraction: number, label: string) => void): CatchUpReport;
}

export interface ObservationModules {
  createSimulation(
    data: { region: RegionLayout; species: SpeciesProfile[] },
    config?: Partial<SimConfig>,
    onProgress?: (fraction: number, label: string) => void,
  ): SimHandle;
  restoreSimulation(
    snapshot: WorldSnapshot,
    data: { region: RegionLayout; species: SpeciesProfile[] },
    onProgress?: (fraction: number, label: string) => void,
  ): SimHandle;
  createEnvironmentLayer(): EnvironmentLayer;
  createCreatureLayer(): CreatureLayer;
}

interface SimModule {
  Simulation: {
    create: ObservationModules['createSimulation'];
    restore: ObservationModules['restoreSimulation'];
  };
  DEFAULT_SIM_CONFIG: SimConfig;
}

interface LayerModule {
  createEnvironmentLayer?: () => EnvironmentLayer;
  createCreatureLayer?: () => CreatureLayer;
}

/**
 * Binds the observation desk to whichever engine modules exist.
 * Returns false while the simulation or a renderer layer is still being written.
 */
export async function bindLivingWorld(): Promise<ObservationModules | null> {
  const simLoaders = import.meta.glob('../sim/index.ts');
  const envLoaders = import.meta.glob('../render/env/index.ts');
  const creatureLoaders = import.meta.glob('../render/creatures/index.ts');
  const simLoad = simLoaders['../sim/index.ts'];
  const envLoad = envLoaders['../render/env/index.ts'];
  const creatureLoad = creatureLoaders['../render/creatures/index.ts'];
  if (!simLoad || !envLoad || !creatureLoad) return null;
  const sim = (await simLoad()) as SimModule;
  const env = (await envLoad()) as LayerModule;
  const creatures = (await creatureLoad()) as LayerModule;
  if (!sim.Simulation?.create || !sim.Simulation?.restore || !env.createEnvironmentLayer || !creatures.createCreatureLayer) return null;
  return {
    createSimulation: sim.Simulation.create,
    restoreSimulation: sim.Simulation.restore,
    createEnvironmentLayer: env.createEnvironmentLayer,
    createCreatureLayer: creatures.createCreatureLayer,
  };
}

/** Full observation loop. The caller owns the document root. */
export async function runObservation(root: HTMLElement, modules: ObservationModules, data: GameData = loadGameDataOrThrow()): Promise<() => void> {
  const params = new URLSearchParams(location.search);
  const shell = mountShell(root, data);
  shell.setStatus('谷を起こしています');
  shell.setShot('湯霞の夜明け');
  shell.pushJournal({ time: '—', text: '記録を開く。光と地形を先に用意する。' });

  const renderer = new THREE.WebGLRenderer({ antialias: params.get('quality') !== 'low', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, params.get('quality') === 'high' ? 1.5 : 1));
  renderer.setSize(root.clientWidth || window.innerWidth, root.clientHeight || window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  shell.viewport.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, viewportAspect(shell.viewport), 0.15, 2500);
  const quality = (params.get('quality') as QualityLevel | null) ?? 'medium';
  const seed = Number(params.get('seed') ?? 20261124);
  const terrain = Terrain.build(data.region, seed, (fraction, label) => shell.setStatus(`${label} ${Math.round(fraction * 100)}%`));
  const species = new Map(data.species.map((profile) => [profile.id, profile]));
  const ctx: RenderContext = { renderer, scene, camera, terrain, region: data.region, art: data.art, species, quality };

  const environment = modules.createEnvironmentLayer();
  const creatures = modules.createCreatureLayer();
  await environment.init(ctx, (fraction, label) => shell.setStatus(`${label} ${Math.round(fraction * 100)}%`));
  await creatures.init(ctx, (fraction, label) => shell.setStatus(`${label} ${Math.round(fraction * 100)}%`));

  const simData = { region: data.region, species: data.species };
  const storageKey = `living-atlas:${data.region.id}:snapshot:v${WORLD_STORAGE_FORMAT_VERSION}`;
  let storage: SnapshotStorage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // Private browsing / storage policy may deny access; the simulation remains playable in memory.
  }
  const stored = readWorldSnapshot(storage, storageKey);
  let sim: SimHandle;
  let restored = false;
  let catchUpReport: CatchUpReport | null = null;
  if (stored.snapshot) {
    try {
      sim = modules.restoreSimulation(stored.snapshot, simData, (fraction, label) => shell.setStatus(`${label} ${Math.round(fraction * 100)}%`));
      const elapsedGameSeconds = offlineGameSeconds(stored.snapshot.savedAtWallClockMs, Date.now(), sim.config.clockScale);
      if (elapsedGameSeconds >= 1) {
        catchUpReport = sim.catchUp(elapsedGameSeconds, (fraction, label) => shell.setStatus(`${label} ${Math.round(fraction * 100)}%`));
      }
      restored = true;
    } catch (error) {
      try { storage?.removeItem(storageKey); } catch { /* storage may be unavailable */ }
      console.warn('[LIVING ATLAS] Saved world could not be restored; starting a fresh world.', error);
      shell.pushJournal({ time: '—', text: '保存記録を復元できなかったため、新しい谷を用意します。' });
      sim = modules.createSimulation(
        simData,
        { seed, startHour: Number(params.get('hour') ?? 6) },
        (fraction, label) => shell.setStatus(`${label} ${Math.round(fraction * 100)}%`),
      );
    }
  } else {
    sim = modules.createSimulation(
      simData,
      { seed, startHour: Number(params.get('hour') ?? 6) },
      (fraction, label) => shell.setStatus(`${label} ${Math.round(fraction * 100)}%`),
    );
  }
  if (restored) {
    shell.pushJournal({ time: formatClock(sim.env.timeOfDay), text: '前回の世界を復元しました。個体の記憶と関係、植生、資源の状態を引き継いでいます。' });
    if (catchUpReport && catchUpReport.requestedGameSeconds > 0) {
      const note = catchUpReport.truncated ? '長い不在期間のため、オフライン進行は上限まで近似計算しました。' : '観察していない時間の生態変化を近似計算しました。';
      shell.pushJournal({ time: formatClock(sim.env.timeOfDay), text: `${note} 出生 ${catchUpReport.births}、死亡 ${catchUpReport.deaths}、記録 ${catchUpReport.events}件。` });
    }
  } else if (stored.status === 'corrupt' || stored.status === 'unavailable') {
    shell.pushJournal({ time: '—', text: stored.message });
  }
  const director = new DocumentaryCamera(camera, data.shots);
  const sources = {
    narration: data.narration,
    art: data.art,
    region: data.region,
    agent: (id: AgentId) => sim.getAgent(id),
  };

  let speed = 1;
  let selected: AgentId | null = null;
  let stopped = false;
  let hudAt = 0;
  shell.setStatus(null);
  (window as Window & { __LA_READY?: boolean }).__LA_READY = true;

  const saveWorld = (quiet = true): void => {
    if (!storage) return;
    const result = writeWorldSnapshot(storage, storageKey, sim.snapshot(Date.now()));
    if (!result.saved) {
      console.warn(`[LIVING ATLAS] ${result.message}`);
      if (!quiet) shell.setStatus(result.message);
    }
  };
  // Snapshot often enough to survive tab closes without writing on every animation frame.
  const autosaveTimer = window.setInterval(() => saveWorld(true), 15_000);
  const onPageHide = () => saveWorld(true);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') saveWorld(true);
  };
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // Persist the restored / newly seeded state immediately, after any offline catch-up.
  saveWorld(true);

  shell.onSpeed((value) => {
    speed = value;
  });
  shell.onSeason((season) => sim.setOverrides({ season }));
  shell.onWeather((weather) => sim.setOverrides({ weather }));
  shell.onSelect((id) => {
    selected = id;
    director.follow(id);
    creatures.setHighlight(id);
    shell.setDossier(id === null ? null : buildDossier(sim, data, id));
  });

  const unsubscribe = sim.onEvent((event) => {
    director.consider(event);
    if (event.importance < 0.25 && event.type.startsWith('world.')) return;
    shell.pushJournal({ time: formatClock(event.timeOfDay), text: narrateEvent(sources, event) });
    shell.setShot(director.shotName.ja);
  });

  const world: CameraWorld = {
    get agents() {
      return sim.agents.map(toCameraAgent);
    },
    terrainHeight: (x, z) => terrain.heightAt(x, z),
    place: (id) => {
      const landmark = terrain.landmarks.get(id);
      if (landmark) return { x: landmark.x, y: landmark.y, z: landmark.z };
      const pool = terrain.pools.find((item) => item.id === id);
      return pool ? { x: pool.x, y: pool.surfaceY, z: pool.z } : null;
    },
    heart: () => {
      const pool = terrain.pools.find((item) => item.kind === 'hot_spring') ?? terrain.pools[0];
      return pool ? { x: pool.x, y: pool.surfaceY, z: pool.z } : { x: 0, y: terrain.heightAt(0, 0), z: 0 };
    },
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onPointer = (event: PointerEvent) => {
    if (event.target !== renderer.domElement) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = creatures.pick(raycaster);
    if (hit === null) return;
    selected = hit;
    director.follow(hit);
    creatures.setHighlight(hit);
    shell.setDossier(buildDossier(sim, data, hit));
  };
  renderer.domElement.addEventListener('pointerdown', onPointer);

  const onResize = () => {
    const width = shell.viewport.clientWidth || window.innerWidth;
    const height = shell.viewport.clientHeight || window.innerHeight;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  window.addEventListener('resize', onResize);
  onResize();

  let last = performance.now();
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const { alpha } = sim.advance(dt, speed, 48);
    const frameState = { dt, elapsed: now / 1000, alpha, timeScale: speed, env: sim.env, sim };
    environment.update(frameState);
    creatures.update(frameState, sim.agents, sim.interactions);
    director.update(dt, world);
    shell.setShot(director.shotName.ja);
    renderer.render(scene, camera);
    if (now - hudAt > 250) {
      hudAt = now;
      publishHud();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  function publishHud() {
    const season = data.narration.labels.seasons[sim.env.season];
    const weather = data.narration.labels.weathers[sim.env.weather];
    shell.setClock({
      day: sim.env.day,
      clock: formatClock(sim.env.timeOfDay),
      season,
      weather,
      temp: `${sim.env.temperatureC.toFixed(1)}°C`,
      speed: speed === 0 ? '静止' : `${speed}×`,
    });
    shell.setRoster(
      sim.agents
        .filter((agent) => agent.alive)
        .slice(0, 18)
        .map((agent) => ({
          id: agent.id,
          label: nicknameFor(data.narration, agent.speciesId, agent.id),
          detail: speciesName(data.art, agent.speciesId),
        })),
    );
    if (selected !== null) shell.setDossier(buildDossier(sim, data, selected));
  }

  function toCameraAgent(agent: SimulationView['agents'][number]): CameraAgent {
    const profile = species.get(agent.speciesId);
    const length = (profile?.body.length ?? 1) * agent.scale;
    const shoulder = (profile?.body.shoulderHeight ?? 0.5) * agent.scale;
    return {
      id: agent.id,
      speciesId: agent.speciesId,
      alive: agent.alive,
      behavior: agent.behavior,
      groupId: agent.groupId,
      pos: agent.pos,
      heading: agent.heading,
      length,
      shoulder,
    };
  }

  return () => {
    saveWorld(true);
    stopped = true;
    window.clearInterval(autosaveTimer);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    unsubscribe();
    window.removeEventListener('resize', onResize);
    renderer.domElement.removeEventListener('pointerdown', onPointer);
    creatures.dispose();
    environment.dispose();
    renderer.dispose();
  };
}

function viewportAspect(viewport: HTMLElement): number {
  const width = viewport.clientWidth || window.innerWidth;
  const height = viewport.clientHeight || window.innerHeight;
  return width / Math.max(1, height);
}
