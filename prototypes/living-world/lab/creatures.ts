/**
 * Creature rig lab — a scripted harness, not the simulation.
 * Terrain is the shared deterministic field (seed 20261124). The stage is the
 * flattest dry ground near the largest hot spring; nothing here is a hardcoded
 * coordinate. Scenarios: ?scenario= lineup | gaits | postures | greet | play |
 * warn | nurse | bathe | flight | hunt. Also ?orbit=1 ?time=hour ?at=seconds
 * ?debug=skeleton,feet,contact ?env=1.
 */
import * as THREE from 'three';
import { loadGameDataOrThrow } from '../src/data/load';
import type { SpeciesProfile } from '../src/data/schema';
import { createCreatureLayer } from '../src/render/creatures';
import type { CreatureLayer, FrameState, RenderContext } from '../src/render/contracts';
import { INTERACTION_PHASES, type FlightMode, type InteractionKind, type InteractionPhase, type LifeStage, type Posture, type Sex } from '../src/sim/ids';
import { Terrain, type PoolInfo } from '../src/sim/terrain';
import type { AgentState, EnvironmentState, InteractionState, Needs } from '../src/sim/types';

const params = new URLSearchParams(location.search);
const scenarioName = params.get('scenario') ?? 'lineup';
const hour = Number(params.get('time') ?? '16.4');
const orbit = params.get('orbit') === '1';
const debugFlag = params.get('debug') ?? '';

let nextId = 1;

const data = loadGameDataOrThrow();
const terrain = Terrain.build(data.region, 20261124);
const speciesById = new Map(data.species.map((s) => [s.id, s]));

const spring = largestHotSpring(terrain);
const stage = flattestPad(terrain, spring);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.08, 2500);
const light = lightingAt(hour);
renderer.toneMappingExposure = light.exposure;
scene.background = light.horizon;
scene.fog = new THREE.FogExp2(light.fog, light.fogDensity);

scene.add(buildTerrainMesh(terrain, data.art.terrain));
scene.add(buildSpringDisc(spring, data.art.water.hotSpringShallow));

const hemi = new THREE.HemisphereLight(light.hemiSky, light.hemiGround, light.hemiIntensity);
scene.add(hemi);
const sun = new THREE.DirectionalLight(light.sun, Math.max(0.35, light.sunIntensity));
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.00025;
sun.shadow.normalBias = 0.04;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
fitShadow(sun, stage.x, stage.y, stage.z, 28);
scene.add(sun);
scene.add(sun.target);
// A little fill so SwiftShader shadows don't crush the bellies to black.
scene.add(new THREE.AmbientLight(light.horizon, 0.18));

const speciesMap = speciesById;
const ctx: RenderContext = {
  renderer,
  scene,
  camera,
  terrain,
  region: data.region,
  art: data.art,
  species: speciesMap,
  quality: 'high',
};

const layer: CreatureLayer = createCreatureLayer();
await layer.init(ctx);
const debug = {
  skeleton: debugFlag.includes('skeleton'),
  footTargets: debugFlag.includes('feet') || debugFlag.includes('foot'),
  contactPoints: debugFlag.includes('contact'),
};
layer.setDebug(debug);

let envLayer: { update(frame: FrameState): void; sun?: THREE.DirectionalLight } | null = null;
if (params.get('env') === '1') {
  try {
    const spec = '../src/render/env/index.ts';
    const mod = (await import(/* @vite-ignore */ spec)) as { createEnvironmentLayer?: () => { init(c: RenderContext): Promise<void>; update(f: FrameState): void; sun?: THREE.DirectionalLight } };
    if (typeof mod.createEnvironmentLayer === 'function') {
      const created = mod.createEnvironmentLayer();
      await created.init(ctx);
      envLayer = created;
      sun.visible = false;
      hemi.visible = false;
    }
  } catch (err) {
    console.warn('[creatures lab] environment layer unavailable', err);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Stage — flat ground beside the hot spring, discovered from the terrain.
// ---------------------------------------------------------------------------

function largestHotSpring(t: Terrain): PoolInfo {
  let best: PoolInfo | null = null;
  for (const p of t.pools) {
    if (p.kind !== 'hot_spring') continue;
    if (!best || p.radius > best.radius) best = p;
  }
  if (!best) throw new Error('terrain.pools has no hot_spring');
  return best;
}

function flattestPad(t: Terrain, pool: PoolInfo): { x: number; z: number; y: number } {
  let best: { x: number; z: number; score: number } | null = null;
  const offsets: Array<[number, number]> = [
    [0, 0],
    [6, 0],
    [-6, 0],
    [0, 6],
    [0, -6],
    [4, 4],
    [-4, 4],
    [4, -4],
  ];
  for (let i = 0; i < 40; i++) {
    const ang = (i / 40) * Math.PI * 2;
    for (const extra of [5, 9, 13, 18]) {
      const d = pool.radius + extra;
      const x = pool.x + Math.cos(ang) * d;
      const z = pool.z + Math.sin(ang) * d;
      if (!t.inBounds(x, z, 12)) continue;
      if (t.waterDepthAt(x, z) > 0.06) continue;
      let slope = 0;
      let rough = 0;
      const h0 = t.heightAt(x, z);
      for (const [dx, dz] of offsets) {
        slope += t.slopeAt(x + dx, z + dz);
        rough += Math.abs(t.heightAt(x + dx, z + dz) - h0);
      }
      const score = slope * 12 + rough * 1.6 + t.coverAt(x, z) * 0.4;
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  const x = best?.x ?? pool.x + pool.radius + 8;
  const z = best?.z ?? pool.z;
  return { x, z, y: t.heightAt(x, z) };
}

function buildTerrainMesh(t: Terrain, colors: { meadow: string; rock: string; moss: string }): THREE.Mesh {
  const m = t.meshData();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  const meadow = new THREE.Color(colors.meadow);
  const rock = new THREE.Color(colors.rock);
  const moss = new THREE.Color(colors.moss);
  const col = new Float32Array(m.normals.length);
  for (let i = 0; i < m.normals.length; i += 3) {
    const ny = m.normals[i + 1];
    const c = ny > 0.82 ? meadow.clone().lerp(moss, (m.positions[i + 1] % 7) / 14) : rock;
    col[i] = c.r;
    col[i + 1] = c.g;
    col[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

function buildSpringDisc(pool: PoolInfo, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(pool.radius, 72),
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      roughness: 0.06,
      metalness: 0.08,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pool.x, pool.surfaceY + 0.03, pool.z);
  mesh.receiveShadow = true;
  return mesh;
}

function lightingAt(h: number) {
  const keys = data.art.lighting;
  const hour = ((h % 24) + 24) % 24;
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (hour >= keys[i].hour && hour <= keys[i + 1].hour) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const t = (hour - a.hour) / Math.max(0.001, b.hour - a.hour);
  const mix = (c0: string, c1: string) => new THREE.Color(c0).lerp(new THREE.Color(c1), t);
  return {
    sun: mix(a.sunColor, b.sunColor),
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t,
    hemiSky: mix(a.hemiSky, b.hemiSky),
    hemiGround: mix(a.hemiGround, b.hemiGround),
    hemiIntensity: a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t,
    fog: mix(a.fogColor, b.fogColor),
    fogDensity: a.fogDensity + (b.fogDensity - a.fogDensity) * t,
    exposure: a.exposure + (b.exposure - a.exposure) * t,
    horizon: mix(a.skyHorizon, b.skyHorizon),
  };
}

function fitShadow(light: THREE.DirectionalLight, x: number, y: number, z: number, radius: number) {
  light.position.set(x - 22, y + 34, z + 16);
  light.target.position.set(x, y + 1.2, z);
  const cam = light.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.updateProjectionMatrix();
}

function makeEnv(h: number, elapsedSec: number): EnvironmentState {
  const timeOfDay = ((h % 24) + 24) % 24;
  const dayPhase = timeOfDay < 5 || timeOfDay >= 19.5 ? 'night' : timeOfDay < 7 ? 'dawn' : timeOfDay < 17.2 ? 'day' : 'dusk';
  return {
    time: timeOfDay * 3600 + elapsedSec,
    day: 1,
    timeOfDay,
    dayPhase,
    season: 'spring',
    seasonProgress: 0.4,
    year: 1,
    weather: 'clear',
    weatherIntensity: 0,
    temperatureC: 14,
    wind: { direction: 0.6, speed: 1.4 },
    sun: { direction: { x: -0.4, y: 0.75, z: 0.35 }, elevation: 0.6 },
    moon: { direction: { x: 0.2, y: 0.4, z: -0.8 }, phase: 0.4 },
  };
}

// ---------------------------------------------------------------------------
// Scripted agents. These are puppets for the rig, not Utility-AI output.
// ---------------------------------------------------------------------------

const ZERO_NEEDS: Needs = {
  hunger: 0.2,
  thirst: 0.2,
  fatigue: 0.15,
  cold: 0.1,
  heat: 0,
  social: 0.3,
  fear: 0,
  curiosity: 0.4,
  stamina: 0.85,
  health: 1,
  breeding: 0,
};

function puppet(opts: {
  speciesId: string;
  sex?: Sex;
  lifeStage?: LifeStage;
  scale?: number;
  x: number;
  z: number;
  y?: number;
  heading?: number;
  posture?: Posture;
  flightMode?: FlightMode | null;
  bank?: number;
  speed?: number;
}): AgentState {
  const profile = speciesById.get(opts.speciesId);
  const stageScale = opts.scale ?? (opts.lifeStage === 'juvenile' ? (profile?.lifeCycle.juvenileScale ?? 0.4) : 1);
  const y = opts.y ?? terrain.heightAt(opts.x, opts.z);
  const pos = { x: opts.x, y, z: opts.z };
  return {
    id: nextId++,
    speciesId: opts.speciesId,
    sex: opts.sex ?? 'female',
    bornAt: opts.lifeStage === 'juvenile' ? -2 : -40,
    lifeStage: opts.lifeStage ?? 'adult',
    alive: opts.posture !== 'dead',
    diedAt: opts.posture === 'dead' ? 0 : null,
    causeOfDeath: opts.posture === 'dead' ? 'injury' : null,
    pos,
    prevPos: { ...pos },
    heading: opts.heading ?? 0,
    prevHeading: opts.heading ?? 0,
    velocity: { x: 0, y: 0, z: 0 },
    speed: opts.speed ?? 0,
    posture: opts.posture ?? 'stand',
    flightMode: opts.flightMode ?? null,
    bank: opts.bank ?? 0,
    scale: stageScale,
    needs: { ...ZERO_NEEDS },
    behavior: 'idle',
    behaviorStartedAt: 0,
    intent: { behavior: 'idle', target: null, targetAgent: null, place: null },
    decision: null,
    interaction: null,
    groupId: null,
    homeId: null,
    motherId: null,
    fatherId: null,
    mateId: null,
    territory: null,
    pregnancy: null,
    memory: { lastThreatAt: null, lastThreatPos: null, lastThreatId: null, food: null, water: null },
    lookAt: null,
    vocalization: null,
    stats: { meals: 0, huntsAttempted: 0, huntsSucceeded: 0, interactions: 0, offspring: 0, distance: 0, baths: 0 },
  };
}

function stepAgent(a: AgentState, dt: number, speed: number, heading: number, y?: number) {
  a.prevPos = { ...a.pos };
  a.prevHeading = a.heading;
  a.heading = heading;
  a.speed = speed;
  a.pos = {
    x: a.pos.x + Math.sin(heading) * speed * dt,
    y: y ?? a.pos.y,
    z: a.pos.z + Math.cos(heading) * speed * dt,
  };
  a.velocity = { x: Math.sin(heading) * speed, y: 0, z: Math.cos(heading) * speed };
}

interface Script {
  update(elapsed: number, dt: number): { agents: AgentState[]; interactions: InteractionState[] };
  frameCamera(camera: THREE.PerspectiveCamera, elapsed: number, orbit: boolean): void;
}

const PHASE_DUR = [0.4, 0.4, 0.4, 0.35, 1.8, 0.7, 0.45, 0.55];

function phaseClock(t: number): { phase: InteractionPhase; phaseTime: number; phaseDuration: number; amp: number } {
  const cycle = PHASE_DUR.reduce((s, d) => s + d, 0);
  let u = ((t % cycle) + cycle) % cycle;
  for (let i = 0; i < INTERACTION_PHASES.length; i++) {
    const dur = PHASE_DUR[i] ?? 0.5;
    if (u <= dur) {
      const amp = i >= 1 && i <= 4 ? 1 : i === 0 ? u / dur : 1 - u / dur;
      return { phase: INTERACTION_PHASES[i], phaseTime: u, phaseDuration: dur, amp: Math.max(0, Math.min(1, amp)) };
    }
    u -= dur;
  }
  return { phase: 'contact', phaseTime: 0, phaseDuration: 1, amp: 1 };
}

function makeInteraction(id: number, kind: InteractionKind, a: AgentState, b: AgentState, clock: ReturnType<typeof phaseClock>, contact: { x: number; y: number; z: number } | null): InteractionState {
  a.interaction = { id, kind, role: 'initiator', phase: clock.phase, partnerId: b.id };
  b.interaction = { id, kind, role: 'responder', phase: clock.phase, partnerId: a.id };
  a.behavior = 'interact';
  b.behavior = 'interact';
  return {
    id,
    kind,
    initiator: a.id,
    responder: b.id,
    phase: clock.phase,
    phaseTime: clock.phaseTime,
    phaseDuration: clock.phaseDuration,
    startedAt: 0,
    response: clock.phase === 'approach' || clock.phase === 'orient' ? null : 'accept',
    outcome: null,
    interruptReason: null,
    contactPoint: contact,
  };
}

function lookAtAgent(from: AgentState, to: AgentState, height: number) {
  const profile = speciesById.get(to.speciesId);
  const reach = (profile?.body.headReach ?? 0.5) * to.scale;
  from.lookAt = {
    x: to.pos.x + Math.sin(to.heading) * reach * 0.45,
    y: to.pos.y + height,
    z: to.pos.z + Math.cos(to.heading) * reach * 0.45,
  };
}

function buildScenario(name: string, t: Terrain, pool: PoolInfo, pad: { x: number; y: number; z: number }, species: Map<string, SpeciesProfile>): Script {
  switch (name) {
    case 'gaits':
      return gaitScript(pad);
    case 'postures':
      return postureScript(pad, pool);
    case 'greet':
      return pairScript(pad, 'greet', 'kit_forager', 'adult', 'adult');
    case 'play':
      return pairScript(pad, 'play', 'kit_forager', 'juvenile', 'juvenile');
    case 'warn':
      return warnScript(pad);
    case 'nurse':
      return nurseScript(pad);
    case 'bathe':
      return batheScript(pool);
    case 'flight':
      return flightScript(pad, pool);
    case 'hunt':
      return huntScript(pad);
    case 'lineup':
    default:
      return lineupScript(pad, species);
  }
}

function lineupScript(pad: { x: number; y: number; z: number }, _species: Map<string, SpeciesProfile>): Script {
  const rows: Array<{ id: string; z: number; spacing: number }> = [
    { id: 'giant_grazer', z: 0, spacing: 9 },
    { id: 'ridge_stalker', z: 7, spacing: 4.4 },
    { id: 'thermal_glider', z: 11, spacing: 3.8 },
    { id: 'kit_forager', z: 14.2, spacing: 2.15 },
  ];
  const heading = 0.65;
  const agents: AgentState[] = [];
  for (const row of rows) {
    const variants: Array<{ sex: Sex; life: LifeStage; x: number }> = [
      { sex: 'female', life: 'juvenile', x: -row.spacing },
      { sex: 'female', life: 'adult', x: 0 },
      { sex: 'male', life: 'adult', x: row.spacing },
    ];
    for (const v of variants) {
      agents.push(
        puppet({
          speciesId: row.id,
          sex: v.sex,
          lifeStage: v.life,
          x: pad.x + v.x,
          z: pad.z + row.z,
          heading,
          posture: 'stand',
        }),
      );
    }
  }
  const focus = { x: pad.x + 0.5, y: pad.y + 1.7, z: pad.z + 6.5 };
  return {
    update() {
      return { agents, interactions: [] };
    },
    frameCamera(cam, elapsed, doOrbit) {
      const dist = 16.5;
      const ang = doOrbit ? elapsed * 0.28 : 0.42;
      cam.fov = 34;
      cam.updateProjectionMatrix();
      cam.position.set(focus.x + Math.sin(ang) * dist * 0.55, focus.y + 1.15, focus.z + Math.cos(ang) * dist);
      cam.lookAt(focus.x, focus.y + 0.2, focus.z);
      fitShadow(sun, focus.x, pad.y, focus.z, 26);
    },
  };
}

function gaitScript(pad: { x: number; y: number; z: number }): Script {
  const heading = Math.PI / 2;
  const specs: Array<{ id: string; z: number; speed: number; posture: Posture; x: number }> = [
    { id: 'giant_grazer', z: -1, speed: 1.05, posture: 'stand', x: -1 },
    { id: 'ridge_stalker', z: 5.5, speed: 0.72, posture: 'crouch', x: -2 },
    { id: 'ridge_stalker', z: 9.2, speed: 3.6, posture: 'stand', x: -6 },
    { id: 'thermal_glider', z: 12.4, speed: 0.7, posture: 'stand', x: 0 },
    { id: 'kit_forager', z: 14.6, speed: 2.7, posture: 'stand', x: -3.5 },
  ];
  const agents = specs.map((s) =>
    puppet({
      speciesId: s.id,
      x: pad.x + s.x,
      z: pad.z + s.z,
      heading,
      posture: s.posture,
      speed: s.speed,
      sex: 'female',
      lifeStage: 'adult',
    }),
  );
  return {
    update(_e, dt) {
      agents.forEach((a, i) => stepAgent(a, dt, specs[i].speed, heading));
      return { agents, interactions: [] };
    },
    frameCamera(cam) {
      const cx = agents.reduce((s, a) => s + a.pos.x, 0) / agents.length;
      const cz = pad.z + 8;
      cam.fov = 42;
      cam.updateProjectionMatrix();
      cam.position.set(cx, pad.y + 3.1, cz + 16);
      cam.lookAt(cx, pad.y + 1.3, cz);
      fitShadow(sun, cx, pad.y, cz, 22);
    },
  };
}

function postureScript(pad: { x: number; y: number; z: number }, pool: PoolInfo): Script {
  const postures: Posture[] = ['stand', 'crouch', 'sit', 'lie', 'sleep', 'dead'];
  const agents: AgentState[] = postures.map((p, i) =>
    puppet({
      speciesId: 'kit_forager',
      x: pad.x + (i - 2.5) * 1.6,
      z: pad.z + 2,
      heading: Math.PI / 2,
      posture: p,
    }),
  );
  agents.push(
    puppet({
      speciesId: 'ridge_stalker',
      x: pad.x - 2,
      z: pad.z + 6,
      heading: 0.4,
      posture: 'crouch',
    }),
    puppet({
      speciesId: 'giant_grazer',
      x: pad.x + 6,
      z: pad.z - 2,
      heading: 0.8,
      posture: 'lie',
    }),
    puppet({
      speciesId: 'thermal_glider',
      x: pad.x - 4,
      z: pad.z + 8,
      heading: 0.2,
      posture: 'perch',
    }),
    puppet({
      speciesId: 'thermal_glider',
      x: pool.x + 4,
      z: pool.z + 4,
      y: pool.surfaceY + 5,
      heading: 1.2,
      posture: 'airborne',
      flightMode: 'glide',
      bank: 0.3,
      speed: 6,
    }),
  );
  return {
    update() {
      return { agents, interactions: [] };
    },
    frameCamera(cam) {
      cam.fov = 40;
      cam.updateProjectionMatrix();
      cam.position.set(pad.x + 2, pad.y + 3.4, pad.z + 16);
      cam.lookAt(pad.x + 1, pad.y + 1.1, pad.z + 3);
    },
  };
}

function pairScript(pad: { x: number; y: number; z: number }, kind: InteractionKind, speciesId: string, lifeA: LifeStage, lifeB: LifeStage): Script {
  const profile = speciesById.get(speciesId)!;
  const scaleA = lifeA === 'juvenile' ? profile.lifeCycle.juvenileScale : 1;
  const scaleB = lifeB === 'juvenile' ? profile.lifeCycle.juvenileScale : 1;
  const reach = profile.body.headReach;
  const a = puppet({ speciesId, lifeStage: lifeA, scale: scaleA, x: pad.x - 0.8, z: pad.z, heading: 0, sex: 'female' });
  const b = puppet({ speciesId, lifeStage: lifeB, scale: scaleB, x: pad.x + 0.8, z: pad.z, heading: Math.PI, sex: 'male' });
  return {
    update(elapsed) {
      const clock = phaseClock(elapsed);
      const close = reach * scaleA + reach * scaleB - 0.12 * Math.min(scaleA, scaleB);
      const far = close + 0.55;
      const dist = far + (close - far) * clock.amp;
      const midX = pad.x;
      a.prevPos = { ...a.pos };
      b.prevPos = { ...b.pos };
      a.pos.x = midX - dist * 0.5;
      b.pos.x = midX + dist * 0.5;
      a.pos.z = pad.z;
      b.pos.z = pad.z;
      a.heading = 0;
      b.heading = Math.PI;
      const headY = pad.y + profile.body.headHeight * ((scaleA + scaleB) * 0.5);
      const contact = { x: midX, y: headY, z: pad.z };
      if (clock.phase === 'signal' || clock.phase === 'contact') {
        a.vocalization = { kind: kind === 'play' ? 'chirp' : 'call', until: 1e9 };
        b.vocalization = { kind: 'call', until: 1e9 };
      } else {
        a.vocalization = null;
        b.vocalization = null;
      }
      lookAtAgent(a, b, profile.body.headHeight * scaleB);
      lookAtAgent(b, a, profile.body.headHeight * scaleA);
      const ix = makeInteraction(1, kind, a, b, clock, contact);
      return { agents: [a, b], interactions: [ix] };
    },
    frameCamera(cam) {
      const mid = (a.pos.x + b.pos.x) * 0.5;
      cam.fov = 38;
      cam.updateProjectionMatrix();
      cam.position.set(mid + 0.2, pad.y + profile.body.shoulderHeight * 1.1, pad.z + Math.max(2.4, profile.body.length * 2.4));
      cam.lookAt(mid, pad.y + profile.body.headHeight * 0.85, pad.z);
      fitShadow(sun, mid, pad.y, pad.z, 8);
    },
  };
}

function warnScript(pad: { x: number; y: number; z: number }): Script {
  const a = puppet({ speciesId: 'ridge_stalker', sex: 'male', x: pad.x - 1.2, z: pad.z, heading: Math.PI / 2 });
  const b = puppet({ speciesId: 'ridge_stalker', sex: 'male', x: pad.x - 1.2, z: pad.z + 3.4, heading: Math.PI / 2 });
  const profile = speciesById.get('ridge_stalker')!;
  return {
    update(elapsed) {
      const clock = phaseClock(elapsed);
      a.lookAt = { x: b.pos.x, y: pad.y + profile.body.headHeight, z: b.pos.z };
      b.lookAt = { x: a.pos.x, y: pad.y + profile.body.headHeight, z: a.pos.z };
      if (clock.phase === 'signal' || clock.phase === 'contact' || clock.phase === 'response') {
        a.vocalization = { kind: 'growl', until: 1e9 };
      } else a.vocalization = null;
      const contact = { x: (a.pos.x + b.pos.x) * 0.5, y: pad.y + profile.body.headHeight, z: (a.pos.z + b.pos.z) * 0.5 };
      return { agents: [a, b], interactions: [makeInteraction(2, 'warn', a, b, clock, contact)] };
    },
    frameCamera(cam) {
      cam.fov = 36;
      cam.updateProjectionMatrix();
      cam.position.set(pad.x + 7.2, pad.y + 1.5, pad.z + 1.7);
      cam.lookAt(pad.x - 1.1, pad.y + 0.9, pad.z + 1.7);
      fitShadow(sun, pad.x, pad.y, pad.z + 1.7, 10);
    },
  };
}

function nurseScript(pad: { x: number; y: number; z: number }): Script {
  const profile = speciesById.get('kit_forager')!;
  const adult = puppet({ speciesId: 'kit_forager', sex: 'female', lifeStage: 'adult', x: pad.x, z: pad.z, heading: Math.PI / 2 });
  const calf = puppet({
    speciesId: 'kit_forager',
    sex: 'female',
    lifeStage: 'juvenile',
    x: pad.x + 0.15,
    z: pad.z - 0.42,
    heading: 2.4,
    posture: 'crouch',
  });
  calf.motherId = adult.id;
  return {
    update(elapsed) {
      const clock = phaseClock(elapsed);
      const contact = { x: adult.pos.x + 0.05, y: pad.y + profile.body.shoulderHeight * 0.42, z: adult.pos.z - 0.22 };
      calf.lookAt = contact;
      adult.lookAt = { x: calf.pos.x, y: pad.y + 0.2, z: calf.pos.z };
      return { agents: [adult, calf], interactions: [makeInteraction(3, 'nurse', adult, calf, clock, contact)] };
    },
    frameCamera(cam) {
      cam.fov = 34;
      cam.updateProjectionMatrix();
      cam.position.set(pad.x + 2.3, pad.y + 0.7, pad.z + 1.6);
      cam.lookAt(pad.x + 0.05, pad.y + 0.38, pad.z - 0.1);
      fitShadow(sun, pad.x, pad.y, pad.z, 6);
    },
  };
}

function batheScript(pool: PoolInfo): Script {
  const giant = puppet({
    speciesId: 'giant_grazer',
    sex: 'female',
    x: pool.x,
    z: pool.z,
    y: pool.surfaceY,
    heading: 1.15,
    posture: 'bathe',
  });
  const kit = puppet({
    speciesId: 'kit_forager',
    x: pool.x + pool.radius * 0.72,
    z: pool.z + pool.radius * 0.15,
    heading: Math.PI,
    posture: 'bathe',
  });
  return {
    update() {
      return { agents: [giant, kit], interactions: [] };
    },
    frameCamera(cam) {
      cam.fov = 34;
      cam.updateProjectionMatrix();
      const y = pool.surfaceY;
      cam.position.set(pool.x + 14, y + 2.4, pool.z + 10);
      cam.lookAt(pool.x, y + 1.3, pool.z);
      fitShadow(sun, pool.x, y, pool.z, 18);
    },
  };
}

function flightScript(pad: { x: number; y: number; z: number }, pool: PoolInfo): Script {
  const perched = puppet({
    speciesId: 'thermal_glider',
    sex: 'female',
    x: pool.x + 2.2,
    z: pool.z - pool.radius - 1.2,
    heading: -0.6,
    posture: 'perch',
  });
  const radius = 8;
  const soar = puppet({
    speciesId: 'thermal_glider',
    sex: 'male',
    x: pool.x + radius,
    z: pool.z,
    y: pool.surfaceY + 6.5,
    heading: 0,
    posture: 'airborne',
    flightMode: 'soar',
    bank: 0.42,
    speed: 8,
  });
  return {
    update(elapsed, dt) {
      const ang = elapsed * 0.45;
      const px = pool.x + Math.cos(ang) * radius;
      const pz = pool.z + Math.sin(ang) * radius;
      // Heading is the tangent of the circle. d(cos)/dt = -sin, d(sin)/dt = cos, so forward is (-sin, cos) in xz,
      // and heading satisfies (sin h, cos h) = (-sin ang, cos ang) => h = -ang.
      const heading = -ang;
      soar.prevPos = { ...soar.pos };
      soar.prevHeading = soar.heading;
      soar.pos = { x: px, y: pool.surfaceY + 6.5 + Math.sin(elapsed * 0.6) * 0.4, z: pz };
      soar.heading = heading;
      soar.bank = 0.48;
      soar.speed = radius * 0.45;
      soar.flightMode = 'soar';
      soar.posture = 'airborne';
      perched.prevPos = { ...perched.pos };
      perched.prevHeading = perched.heading;
      void dt;
      return { agents: [perched, soar], interactions: [] };
    },
    frameCamera(cam) {
      cam.fov = 40;
      cam.updateProjectionMatrix();
      cam.position.set(pool.x + 16, pool.surfaceY + 7, pool.z + 14);
      cam.lookAt(pool.x + 2, pool.surfaceY + 2.2, pool.z);
      fitShadow(sun, pool.x, pool.surfaceY, pool.z, 24);
    },
  };
}

function huntScript(pad: { x: number; y: number; z: number }): Script {
  const kit = puppet({
    speciesId: 'kit_forager',
    x: pad.x + 3.2,
    z: pad.z,
    heading: 0.2,
    posture: 'stand',
  });
  const stalker = puppet({
    speciesId: 'ridge_stalker',
    sex: 'female',
    x: pad.x - 1.4,
    z: pad.z - 0.3,
    heading: 0.15,
    posture: 'crouch',
    speed: 0.55,
  });
  return {
    update(_e, dt) {
      stepAgent(stalker, dt, 0.55, stalker.heading);
      kit.lookAt = { x: kit.pos.x + 2, y: pad.y + 0.15, z: kit.pos.z + 1 };
      stalker.lookAt = { x: kit.pos.x, y: pad.y + 0.35, z: kit.pos.z };
      kit.prevPos = { ...kit.pos };
      return { agents: [stalker, kit], interactions: [] };
    },
    frameCamera(cam) {
      cam.fov = 32;
      cam.updateProjectionMatrix();
      cam.position.set(pad.x + 1.2, pad.y + 0.72, pad.z + 5.4);
      cam.lookAt(pad.x + 1.1, pad.y + 0.55, pad.z);
      fitShadow(sun, pad.x + 1, pad.y, pad.z, 10);
    },
  };
}

const world = buildScenario(scenarioName, terrain, spring, stage, speciesById);
let elapsed = Number(params.get('at') ?? '0');
let frames = 0;
let last = performance.now();

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;
  const { agents, interactions } = world.update(elapsed, dt);
  const env = makeEnv(hour, elapsed);
  const frame: FrameState = { dt, elapsed, alpha: 1, timeScale: 1, env, sim: null };
  envLayer?.update(frame);
  layer.update(frame, agents, interactions);
  world.frameCamera(camera, elapsed, orbit);
  renderer.render(scene, camera);
  frames += 1;
  if (frames === 2) (window as unknown as { __LA_READY: boolean }).__LA_READY = true;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
