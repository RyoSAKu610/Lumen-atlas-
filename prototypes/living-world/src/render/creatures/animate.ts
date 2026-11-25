/**
 * Runtime pose: distance-driven gaits, two-bone IK with planted feet, posture
 * blends, flight, and interaction displays. Quaternions are authored every frame
 * from the bind rest pose — nothing is integrated on top of the previous frame's
 * bone rotation except the smoothed look and tail springs.
 */
import {
  Bone,
  Euler,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SkeletonHelper,
  SphereGeometry,
  Vector3,
  type SkinnedMesh,
} from 'three';
import type { CreatureLook, SpeciesProfile } from '../../data/schema';
import type { FlightMode, InteractionKind, InteractionPhase, Posture } from '../../sim/ids';
import type { InteractionState, AgentState } from '../../sim/types';
import type { Terrain } from '../../sim/terrain';
import type { CreatureDebugFlags, FrameState } from '../contracts';
import type { LegTemplate, SpeciesTemplate } from './build';
import { AXIS_UP, aimBone, clamp, damp, lerp, limbPole, smoothstep, solveTwoBone, wrapAngle } from './ik';
import type { CoatMaterial } from './materials';

export interface LegRuntime {
  spec: LegTemplate;
  upper: Bone;
  lower: Bone;
  foot: Bone;
  footLen: number;
}

interface WingRuntime {
  side: number;
  upper: Bone;
  mid: Bone;
  hand: Bone;
  fingers: Bone[];
}

export interface CreatureInstance {
  id: number;
  template: SpeciesTemplate;
  look: CreatureLook;
  profile: SpeciesProfile;
  mesh: SkinnedMesh;
  bones: Map<string, Bone>;
  restQ: Map<string, Quaternion>;
  restP: Map<string, Vector3>;
  legs: LegRuntime[];
  wings: WingRuntime[];
  tail: Bone[];
  material: CoatMaterial;
  anchor: Vector3;
  heading: number;
  gaitPhase: number;
  flapPhase: number;
  lastX: number;
  lastZ: number;
  lastHeading: number;
  posture: Posture;
  postureFrom: Posture;
  postureT: number;
  variantKey: string;
  animTime: number;
  headYaw: number;
  headPitch: number;
  neckYaw: number;
  neckPitch: number;
  bank: number;
  planted: boolean[];
  plant: Vector3[];
  swingFrom: Vector3[];
  swingTo: Vector3[];
  feetReady: boolean;
  helper: SkeletonHelper | null;
  footDebug: Mesh[];
  contactDebug: Mesh | null;
  proxies: Mesh[];
  highlighted: boolean;
  lastFootY: { front: number; hind: number };
}

const _e = new Euler();
const _dq = new Quaternion();
const _q = new Quaternion();
const _fwd = new Vector3();
const _right = new Vector3();
const _hip = new Vector3();
const _ankle = new Vector3();
const _knee = new Vector3();
const _pole = new Vector3();
const _toe = new Vector3();
const _home = new Vector3();
const _look = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();

const UP = AXIS_UP;
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

type Gait = 'idle' | 'walk' | 'trot' | 'bound' | 'crouch' | 'gallop' | 'biped';

const OFFSET: Record<Gait, Record<string, number>> = {
  idle: { fl: 0, hr: 0.25, fr: 0.5, hl: 0.75 },
  walk: { fl: 0, hr: 0.25, fr: 0.5, hl: 0.75 },
  trot: { fl: 0, hr: 0, fr: 0.5, hl: 0.5 },
  bound: { hl: 0, hr: 0.03, fl: 0.5, fr: 0.53 },
  crouch: { fl: 0, hr: 0.25, fr: 0.5, hl: 0.75 },
  gallop: { hl: 0, hr: 0.1, fl: 0.52, fr: 0.64 },
  biped: { hl: 0, hr: 0.5, fl: 0, fr: 0.5 },
};
const DUTY: Record<Gait, number> = { idle: 1, walk: 0.67, trot: 0.46, bound: 0.4, crouch: 0.78, gallop: 0.33, biped: 0.62 };
const LIFT: Record<Gait, number> = { idle: 0, walk: 0.09, trot: 0.14, bound: 0.26, crouch: 0.045, gallop: 0.2, biped: 0.09 };
const BOB: Record<Gait, number> = { idle: 0.008, walk: 0.012, trot: 0.02, bound: 0.055, crouch: 0.006, gallop: 0.04, biped: 0.016 };

function fract(x: number): number {
  return x - Math.floor(x);
}
function mulEuler(bone: Bone, rest: Quaternion, x: number, y: number, z: number): void {
  _e.set(x, y, z, 'YXZ');
  _dq.setFromEuler(_e);
  bone.quaternion.copy(rest).multiply(_dq);
}
function boneOf(inst: CreatureInstance, name: string): Bone | undefined {
  return inst.bones.get(name);
}
function restOf(inst: CreatureInstance, name: string): Quaternion {
  return inst.restQ.get(name) ?? _q.identity();
}

const debugGeo = new SphereGeometry(1, 8, 6);
const debugMat = new MeshBasicMaterial({ color: '#ffcc66', depthTest: false, transparent: true, opacity: 0.9 });
const contactMat = new MeshBasicMaterial({ color: '#ff5a3c', depthTest: false, transparent: true, opacity: 0.95 });

export function createCreatureInstance(
  template: SpeciesTemplate,
  mesh: SkinnedMesh,
  material: CoatMaterial,
  agent: AgentState,
  look: CreatureLook,
  profile: SpeciesProfile,
): CreatureInstance {
  const bones = new Map<string, Bone>();
  mesh.traverse((o) => {
    if ((o as Bone).isBone) bones.set(o.name, o as Bone);
  });
  const restQ = new Map<string, Quaternion>();
  const restP = new Map<string, Vector3>();
  for (const [name, b] of bones) {
    restQ.set(name, b.quaternion.clone());
    restP.set(name, b.position.clone());
  }
  const legs: LegRuntime[] = [];
  for (const spec of template.legs) {
    const upper = bones.get(`leg_${spec.id}_upper`);
    const lower = bones.get(`leg_${spec.id}_lower`);
    const foot = bones.get(`leg_${spec.id}_foot`);
    if (!upper || !lower || !foot) continue;
    legs.push({ spec, upper, lower, foot, footLen: spec.footLen });
  }
  const wings: WingRuntime[] = [];
  if (template.hasWings) {
    for (const side of [1, -1]) {
      const tag = side > 0 ? 'r' : 'l';
      const upper = bones.get(`wing_${tag}_upper`);
      const mid = bones.get(`wing_${tag}_mid`);
      const hand = bones.get(`wing_${tag}_hand`);
      if (!upper || !mid || !hand) continue;
      const fingers: Bone[] = [];
      for (let i = 0; i < template.fingerCount; i++) {
        const f = bones.get(`wing_${tag}_f${i}`);
        if (f) fingers.push(f);
      }
      wings.push({ side, upper, mid, hand, fingers });
    }
  }
  const tail: Bone[] = [];
  for (let i = 0; i < template.tailCount; i++) {
    const t = bones.get(`tail_${i}`);
    if (t) tail.push(t);
  }
  const n = legs.length;
  const inst: CreatureInstance = {
    id: agent.id,
    template,
    look,
    profile,
    mesh,
    bones,
    restQ,
    restP,
    legs,
    wings,
    tail,
    material,
    anchor: new Vector3(),
    heading: agent.heading,
    gaitPhase: (agent.id % 7) * 0.13,
    flapPhase: (agent.id % 5) * 0.4,
    lastX: agent.pos.x,
    lastZ: agent.pos.z,
    lastHeading: agent.heading,
    posture: agent.posture,
    postureFrom: agent.posture,
    postureT: 1,
    variantKey: '',
    animTime: agent.id * 0.37,
    headYaw: 0,
    headPitch: 0,
    neckYaw: 0,
    neckPitch: 0,
    bank: 0,
    planted: legs.map(() => true),
    plant: legs.map(() => new Vector3()),
    swingFrom: legs.map(() => new Vector3()),
    swingTo: legs.map(() => new Vector3()),
    feetReady: false,
    helper: null,
    footDebug: [],
    contactDebug: null,
    proxies: [],
    highlighted: false,
    lastFootY: { front: 0, hind: 0 },
  };
  for (let i = 0; i < n; i++) {
    const m = new Mesh(debugGeo, debugMat);
    m.visible = false;
    m.renderOrder = 10;
    m.scale.setScalar(0.06);
    inst.footDebug.push(m);
  }
  inst.contactDebug = new Mesh(debugGeo, contactMat);
  inst.contactDebug.visible = false;
  inst.contactDebug.scale.setScalar(0.08);
  applyVariant(inst, agent);
  return inst;
}

function applyVariant(inst: CreatureInstance, agent: AgentState): void {
  const male = agent.sex === 'male';
  const juv = agent.lifeStage === 'juvenile';
  const key = `${agent.lifeStage}:${agent.sex}`;
  const body = Math.max(0.05, agent.scale) * (male ? inst.look.maleVariant.scale : 1);
  inst.mesh.scale.setScalar(body);
  if (inst.variantKey === key) return;
  inst.variantKey = key;
  for (const [name, b] of inst.bones) {
    const p = inst.restP.get(name);
    if (p) b.position.copy(p);
    b.scale.set(1, 1, 1);
  }
  const j = inst.look.juvenile;
  if (juv) {
    const head = boneOf(inst, 'head');
    if (head) head.scale.setScalar(j.headScale);
    for (const leg of inst.legs) {
      leg.lower.position.multiplyScalar(j.legScale);
      leg.foot.position.multiplyScalar(j.legScale);
      leg.footLen = leg.spec.footLen * j.legScale;
    }
    for (const t of inst.tail) t.position.multiplyScalar(j.tailScale);
  } else {
    for (const leg of inst.legs) leg.footLen = leg.spec.footLen;
  }
  const hornMul = male ? inst.look.maleVariant.hornScale : 1;
  for (const name of ['horn_l', 'horn_r', 'crest']) {
    const b = boneOf(inst, name);
    if (b) b.scale.setScalar(Math.max(0.001, hornMul));
  }
}

function selectGait(inst: CreatureInstance, speed: number, posture: Posture): Gait {
  const family = inst.template.family;
  const loco = inst.profile.locomotion;
  if (posture === 'dead' || posture === 'lie' || posture === 'sleep' || posture === 'sit') return 'idle';
  if (posture === 'airborne') return 'idle';
  if (posture === 'swim') return family === 'quadruped_small' ? 'bound' : family === 'winged_flyer' ? 'biped' : 'walk';
  if (speed < 0.1) return 'idle';
  if (family === 'quadruped_giant') return 'walk';
  if (family === 'quadruped_small') return speed < loco.trotSpeed * 0.92 ? 'walk' : 'bound';
  if (family === 'quadruped_predator') {
    if (posture === 'crouch' || speed < loco.trotSpeed) return 'crouch';
    return 'gallop';
  }
  return 'biped';
}

function postureDuration(p: Posture): number {
  switch (p) {
    case 'crouch':
      return 0.32;
    case 'stand':
    case 'perch':
      return 0.4;
    case 'sit':
      return 0.65;
    case 'lie':
      return 0.85;
    case 'sleep':
    case 'dead':
      return 1;
    case 'bathe':
      return 0.9;
    case 'swim':
    case 'airborne':
      return 0.45;
    default:
      return 0.5;
  }
}

interface PoseW {
  drop: number;
  pitch: number;
  roll: number;
  spineX: number;
  neckX: number;
  headX: number;
  tailX: number;
  feet: 'gait' | 'sit' | 'lie' | 'tuck' | 'limp' | 'reach';
  wing: 'fold' | 'flap' | 'glide' | 'soar' | 'flare' | 'takeoff';
}

function poseOf(inst: CreatureInstance, p: Posture, flight: FlightMode | null): PoseW {
  const family = inst.template.family;
  const hip = inst.template.hipHeight;
  const ry = inst.template.bodyRy;
  const crouchMul = family === 'quadruped_predator' ? 0.58 : family === 'quadruped_giant' ? 0.86 : 0.68;
  const lieDrop = -hip + ry * 1.05;
  const sitDrop = -hip * (family === 'winged_flyer' ? 0.08 : 0.42);
  const base: PoseW = { drop: 0, pitch: 0, roll: 0, spineX: 0, neckX: 0, headX: 0, tailX: 0, feet: 'gait', wing: 'fold' };
  switch (p) {
    case 'crouch':
      return { ...base, drop: -hip * (1 - crouchMul), pitch: family === 'quadruped_predator' ? 0.16 : 0.06, spineX: 0.08, headX: 0.06 };
    case 'sit':
      return { ...base, drop: sitDrop, pitch: -0.04, spineX: 0.1, neckX: 0.08, tailX: 0.15, feet: 'sit' };
    case 'lie':
      return { ...base, drop: lieDrop, spineX: 0.06, neckX: 0.12, headX: 0.2, tailX: 0.1, feet: 'lie' };
    case 'sleep':
      return { ...base, drop: lieDrop, spineX: 0.1, neckX: 0.35, headX: 0.55, tailX: 0.35, feet: 'lie' };
    case 'dead':
      return { ...base, drop: lieDrop + ry * 0.05, roll: 1.25, spineX: 0.2, neckX: 0.45, headX: 0.4, tailX: 0.2, feet: 'limp' };
    case 'bathe':
      return { ...base, pitch: 0.04, neckX: 0.05, tailX: 0.08 };
    case 'swim':
      return { ...base, pitch: 0.1, neckX: 0.12, headX: 0.05 };
    case 'airborne': {
      const wing = flight === 'glide' ? 'glide' : flight === 'soar' ? 'soar' : flight === 'landing' ? 'flare' : flight === 'takeoff' ? 'takeoff' : 'flap';
      return { ...base, pitch: flight === 'landing' ? 0.28 : flight === 'soar' ? 0.06 : 0.04, neckX: flight === 'glide' ? 0.15 : -0.05, feet: flight === 'landing' ? 'reach' : 'tuck', wing };
    }
    case 'perch':
      return { ...base, pitch: -0.05, neckX: 0.08, spineX: 0.04 };
    default:
      return base;
  }
}

function blendPose(a: PoseW, b: PoseW, t: number): PoseW {
  const n = (x: number, y: number) => lerp(x, y, t);
  return {
    drop: n(a.drop, b.drop),
    pitch: n(a.pitch, b.pitch),
    roll: n(a.roll, b.roll),
    spineX: n(a.spineX, b.spineX),
    neckX: n(a.neckX, b.neckX),
    headX: n(a.headX, b.headX),
    tailX: n(a.tailX, b.tailX),
    feet: t > 0.55 ? b.feet : a.feet,
    wing: t > 0.45 ? b.wing : a.wing,
  };
}

interface Social {
  earFlatten: number;
  maneLift: number;
  tailHook: number;
  tailFan: number;
  crest: number;
  splay: number;
  jaw: number;
  widen: number;
  bob: number;
  reach: number;
  tuck: number;
}

const NO_SOCIAL: Social = { earFlatten: 0, maneLift: 0, tailHook: 0, tailFan: 0, crest: 0, splay: 0, jaw: 0, widen: 0, bob: 0, reach: 0, tuck: 0 };

function phaseAmp(phase: InteractionPhase, t: number): number {
  const e = smoothstep(clamp(t * 1.35, 0, 1));
  switch (phase) {
    case 'approach':
      return 0.12;
    case 'orient':
      return 0.3 + 0.7 * e;
    case 'signal':
      return 1;
    case 'response':
      return 0.88;
    case 'contact':
      return 1;
    case 'resolve':
      return 1 - e;
    case 'cooldown':
      return 0.22;
    case 'separate':
      return 0.08 * (1 - clamp(t, 0, 1));
    default:
      return 0;
  }
}

function socialOf(agent: AgentState, ix: InteractionState | undefined, amp: number): Social {
  if (!ix || amp <= 0) return NO_SOCIAL;
  const k: InteractionKind = ix.kind;
  const juv = agent.lifeStage === 'juvenile';
  const s: Social = { ...NO_SOCIAL };
  if (k === 'greet') {
    s.reach = amp * (ix.phase === 'contact' || ix.phase === 'response' ? 1 : 0.35);
    s.earFlatten = -0.35 * amp;
  } else if (k === 'groom') {
    s.reach = amp;
    s.jaw = 0.22 * amp;
    s.earFlatten = 0.2 * amp;
  } else if (k === 'nurse') {
    if (juv) {
      s.reach = amp;
      s.tuck = amp;
      s.bob = 0;
    } else {
      s.widen = amp;
      s.tailHook = -0.4 * amp;
    }
  } else if (k === 'play') {
    s.bob = amp;
    s.reach = 0.55 * amp;
    s.earFlatten = -0.25 * amp;
  } else if (k === 'warn') {
    s.earFlatten = amp;
    s.maneLift = amp;
    s.tailHook = amp;
    s.tailFan = amp;
    s.crest = amp;
    s.splay = amp;
    s.jaw = 0.18 * amp;
  } else if (k === 'court') {
    s.crest = amp;
    s.tailFan = 0.8 * amp;
    s.splay = 0.45 * amp;
    s.reach = 0.2 * amp;
  }
  return s;
}

function findInteraction(agent: AgentState, interactions: readonly InteractionState[]): InteractionState | undefined {
  for (const ix of interactions) {
    if (ix.initiator === agent.id || ix.responder === agent.id) return ix;
  }
  return undefined;
}

interface WingA {
  pitch: number;
  sweep: number;
  elbow: number;
  wrist: number;
  /** Roll about the span so the feather face isn't edge-on when folded. */
  roll: number;
  splay: number;
}

function wingAngles(kind: PoseW['wing'], flap: number, social: Social): WingA {
  const s = Math.sin(flap);
  const fold: WingA = { pitch: -0.35, sweep: 1.15, elbow: 1.7, wrist: 0.7, roll: 1.15, splay: 0.02 };
  if (kind === 'fold') return { ...fold, splay: fold.splay + social.splay * 0.28 };
  if (kind === 'glide') return { pitch: 0.22, sweep: 0.18, elbow: 0.12, wrist: 0.05, roll: 0.05, splay: 0.16 + social.splay * 0.2 };
  if (kind === 'soar') return { pitch: 0.08, sweep: 0.05, elbow: 0.04, wrist: 0.02, roll: 0, splay: 0.28 + social.splay * 0.16 };
  if (kind === 'flare') return { pitch: 0.85, sweep: 0.02, elbow: 0.1, wrist: -0.05, roll: 0.1, splay: 0.42 };
  if (kind === 'takeoff') {
    const k = 0.5 + 0.5 * Math.sin(flap);
    return {
      pitch: lerp(fold.pitch, s * 0.7, k),
      sweep: lerp(fold.sweep, 0.1, k),
      elbow: lerp(fold.elbow, 0.2, k),
      wrist: lerp(fold.wrist, 0.08, k),
      roll: lerp(fold.roll, 0, k),
      splay: 0.14,
    };
  }
  const down = s > 0 ? 1 : 0;
  return {
    pitch: s * 0.65,
    sweep: 0.1 + (1 - down) * 0.15,
    elbow: 0.18 + (1 - down) * 0.35,
    wrist: 0.06 + (1 - down) * 0.2,
    roll: 0.04,
    splay: 0.18 + down * 0.06,
  };
}

function applyWings(inst: CreatureInstance, a: WingA): void {
  for (const w of inst.wings) {
    const s = w.side;
    // Chain extends along local ±X. Sweep around Y brings it aft; pitch around Z drops or raises it.
    const sweepQ = new Quaternion().setFromAxisAngle(Y_AXIS, a.sweep * s);
    const pitchQ = new Quaternion().setFromAxisAngle(Z_AXIS, a.pitch * s);
    const rollQ = new Quaternion().setFromAxisAngle(X_AXIS, a.roll * s);
    w.upper.quaternion.copy(sweepQ).multiply(pitchQ).multiply(rollQ);
    w.mid.quaternion.setFromAxisAngle(Y_AXIS, a.elbow * s);
    w.hand.quaternion.setFromAxisAngle(Y_AXIS, a.wrist * s);
    const n = w.fingers.length;
    w.fingers.forEach((f, i) => {
      const rest = inst.restQ.get(f.name);
      const extra = (i - (n - 1) / 2) * a.splay;
      _e.set(0, extra * s, 0, 'YXZ');
      _dq.setFromEuler(_e);
      if (rest) f.quaternion.copy(rest).multiply(_dq);
      else f.quaternion.copy(_dq);
    });
  }
}

function supportY(terrain: Terrain, x: number, z: number, simY: number, posture: Posture): number {
  const ground = terrain.heightAt(x, z);
  if (posture === 'perch' && simY > ground + 0.45) return simY;
  return ground;
}

export function updateCreature(
  inst: CreatureInstance,
  agent: AgentState,
  frame: FrameState,
  terrain: Terrain,
  interactions: readonly InteractionState[],
  cameraPos: Vector3,
  debug: CreatureDebugFlags,
  distances: { detail: number; lod: number; hide: number },
): void {
  const dt = Math.min(0.05, Math.max(0, frame.dt)) * clamp(frame.timeScale, 0, 4);
  inst.animTime += dt;
  applyVariant(inst, agent);
  const alpha = clamp(frame.alpha, 0, 1);
  const x = lerp(agent.prevPos.x, agent.pos.x, alpha);
  const z = lerp(agent.prevPos.z, agent.pos.z, alpha);
  const simY = lerp(agent.prevPos.y, agent.pos.y, alpha);
  let heading = agent.prevHeading + wrapAngle(agent.heading - agent.prevHeading) * alpha;
  inst.heading = heading;

  const dx = x - inst.lastX;
  const dz = z - inst.lastZ;
  const movedRaw = Math.hypot(dx, dz);
  const scale = inst.mesh.scale.x;
  const strideBase = Math.max(0.12, inst.profile.locomotion.strideLength * scale);
  const teleported = movedRaw > Math.max(1.5, strideBase * 1.6);
  const moved = teleported ? 0 : movedRaw;
  const speed = dt > 1e-4 ? moved / Math.max(dt, 1e-4) : 0;
  if (teleported) inst.feetReady = false;

  if (agent.posture !== inst.posture) {
    inst.postureFrom = inst.posture;
    inst.posture = agent.posture;
    inst.postureT = 0;
  }
  const dur = postureDuration(inst.posture);
  if (dt > 0) inst.postureT = Math.min(1, inst.postureT + dt / dur);
  const blend = smoothstep(inst.postureT);
  const pose = blendPose(poseOf(inst, inst.postureFrom, agent.flightMode), poseOf(inst, inst.posture, agent.flightMode), blend);

  const dist = cameraPos.distanceTo(_tmp.set(x, simY, z));
  const hidden = dist > distances.hide;
  inst.mesh.visible = !hidden;
  if (hidden) {
    inst.lastX = x;
    inst.lastZ = z;
    inst.lastHeading = heading;
    return;
  }
  const far = dist > distances.lod;
  inst.mesh.castShadow = dist < distances.detail;
  inst.mesh.receiveShadow = dist < distances.lod;

  const ix = findInteraction(agent, interactions);
  const amp = ix ? phaseAmp(ix.phase, ix.phaseDuration > 0 ? ix.phaseTime / ix.phaseDuration : 1) : 0;
  const social = socialOf(agent, ix, amp);

  // Far LOD: bind pose planted on the support surface, heading only.
  if (far) {
    const ground = supportY(terrain, x, z, simY, inst.posture);
    const y = inst.posture === 'airborne' ? simY : ground + pose.drop;
    inst.mesh.position.set(x, y, z);
    inst.mesh.quaternion.setFromAxisAngle(Y_AXIS, heading);
    for (const [name, b] of inst.bones) {
      const rq = inst.restQ.get(name);
      if (rq) b.quaternion.copy(rq);
    }
    if (inst.posture !== 'airborne') applyWings(inst, wingAngles('fold', 0, social));
    inst.lastX = x;
    inst.lastZ = z;
    inst.lastHeading = heading;
    const chest = boneOf(inst, 'chest');
    if (chest) chest.getWorldPosition(inst.anchor);
    else inst.anchor.set(x, y + inst.template.shoulderHeight * scale, z);
    return;
  }

  const gait = selectGait(inst, speed, inst.posture);
  let stride = strideBase;
  if (inst.template.family === 'quadruped_giant' && speed > 0.2) {
    const capHz = 0.72;
    if (speed / stride > capHz) stride = speed / capHz;
  }
  if (gait !== 'idle' && !teleported) inst.gaitPhase += moved / Math.max(0.05, stride);
  if (inst.posture === 'swim') inst.gaitPhase += dt * 1.5;
  if (inst.posture === 'airborne') inst.flapPhase += dt * (agent.flightMode === 'soar' ? 1.2 : agent.flightMode === 'glide' ? 0.6 : 5.5 + speed * 0.15);

  const ground = supportY(terrain, x, z, simY, inst.posture);
  const nrm = terrain.normalAt(x, z);
  _fwd.set(Math.sin(heading), 0, Math.cos(heading));
  _right.set(Math.cos(heading), 0, -Math.sin(heading));
  const slopePitch = Math.atan2(-(nrm.x * _fwd.x + nrm.z * _fwd.z), nrm.y);
  const slopeRoll = Math.atan2(-(nrm.x * _right.x + nrm.z * _right.z), nrm.y);
  const yawRate = dt > 1e-4 ? wrapAngle(heading - inst.lastHeading) / dt : 0;

  let drop = pose.drop;
  if (inst.posture === 'bathe' || inst.posture === 'swim') {
    const water = terrain.waterSurfaceAt(x, z);
    const bed = terrain.heightAt(x, z);
    const hip = inst.template.hipHeight * scale;
    const ry = inst.template.bodyRy * scale;
    const surface = water ?? bed + ry * 0.35;
    const standBelly = bed + hip - ry;
    if (inst.posture === 'swim') {
      const pelvis = surface + ry * 0.15;
      drop = pelvis - (bed + hip);
    } else if (standBelly < surface + ry * 0.35) {
      const settle = clamp(standBelly - (surface - ry * 0.05), 0, hip * 0.12);
      drop = -settle;
    } else {
      const pelvis = clamp(surface + ry * 0.1, bed + ry * 0.8, bed + hip);
      drop = pelvis - (bed + hip);
    }
  }
  if (social.tuck > 0 && inst.posture !== 'airborne') drop -= inst.template.hipHeight * scale * 0.28 * social.tuck;

  const bobAmp = inst.template.hipHeight * scale * BOB[gait];
  const bob = gait === 'bound' || gait === 'gallop' ? Math.abs(Math.sin(inst.gaitPhase * Math.PI * 2)) * bobAmp : Math.sin(inst.gaitPhase * Math.PI * 2) * bobAmp;
  const playBob = social.bob * Math.abs(Math.sin(inst.animTime * 7.5)) * inst.template.bodyRy * scale * 0.55;
  const breath = Math.sin(inst.animTime * (inst.posture === 'sleep' ? 1.15 : 2.3) + inst.id) * (inst.posture === 'dead' ? 0 : inst.posture === 'sleep' ? 0.025 : 0.012);

  let pitch = (inst.posture === 'airborne' ? 0 : slopePitch * 0.85) + pose.pitch;
  pitch += Math.sin(inst.gaitPhase * Math.PI * 2) * (gait === 'bound' ? 0.1 : gait === 'gallop' ? 0.07 : 0.02);
  let roll = (inst.posture === 'airborne' ? 0 : slopeRoll * 0.75) + pose.roll;
  roll += clamp(-yawRate * 0.04, -0.18, 0.18);
  inst.bank = damp(inst.bank, inst.posture === 'airborne' ? agent.bank : 0, 5, dt);
  roll -= inst.bank;

  const grounded = inst.posture !== 'airborne';
  const sink = grounded ? Math.max(0.015, (inst.legs[0]?.footLen ?? 0.04) * 0.55) * scale : 0;
  const y = (inst.posture === 'airborne' ? simY : ground) + (grounded ? drop : 0) + bob + playBob - sink;
  inst.mesh.position.set(x, y, z);
  _q.setFromAxisAngle(Y_AXIS, heading);
  _dq.setFromAxisAngle(X_AXIS, pitch);
  _q.multiply(_dq);
  _dq.setFromAxisAngle(Z_AXIS, roll);
  inst.mesh.quaternion.copy(_q).multiply(_dq);

  const bend = clamp(-yawRate * 0.16, -0.55, 0.55);
  const spine = boneOf(inst, 'spine');
  const chest = boneOf(inst, 'chest');
  if (spine) mulEuler(spine, restOf(inst, 'spine'), pose.spineX + breath + social.reach * 0.06, bend * 0.5, 0);
  if (chest) mulEuler(chest, restOf(inst, 'chest'), breath * 0.8, bend * 0.32, 0);

  const windStr = clamp(frame.env.wind.speed / 7, 0, 1);
  const windYaw = wrapAngle(frame.env.wind.direction - heading);
  let lag = -yawRate * 0.14 + Math.sin(windYaw) * windStr * 0.3;
  inst.tail.forEach((t, i) => {
    const along = inst.tail.length <= 1 ? 1 : i / (inst.tail.length - 1);
    const hook = social.tailHook * smoothstep(along) * 0.85;
    const fan = social.tailFan * along;
    const addX = pose.tailX / inst.tail.length + lag * 0.22 + Math.sin(inst.animTime * 2.2 + i * 0.6) * (0.035 + windStr * 0.08) + hook;
    const addY = lag + Math.sin(inst.animTime * 1.4 + i) * 0.03;
    mulEuler(t, restOf(inst, t.name), addX, addY, fan * 0.15);
    if (i === inst.tail.length - 1) t.scale.x = 1 + social.tailFan * 0.85;
    lag *= 0.84;
  });

  applyWings(inst, wingAngles(pose.wing, inst.flapPhase, social));

  const dorsal = boneOf(inst, 'dorsal');
  if (dorsal) mulEuler(dorsal, restOf(inst, 'dorsal'), breath * 2.2 - social.maneLift * 0.75, 0, 0);

  for (const sideName of ['ear_l', 'ear_r'] as const) {
    const ear = boneOf(inst, sideName);
    if (!ear) continue;
    const side = sideName === 'ear_r' ? 1 : -1;
    const flatten = clamp(social.earFlatten, -0.5, 1);
    const twitch = Math.sin(inst.animTime * 4.5 + side) * 0.07 * (1 - Math.abs(flatten));
    mulEuler(ear, restOf(inst, sideName), flatten * 0.45, twitch, side * flatten * 0.75);
  }
  const crest = boneOf(inst, 'crest');
  if (crest) mulEuler(crest, restOf(inst, 'crest'), -social.crest * 0.45, 0, 0);

  inst.mesh.updateMatrixWorld(true);

  // Head look. Neck origin does not depend on the neck's own rotation.
  const neck = boneOf(inst, 'neck');
  const head = boneOf(inst, 'head');
  let lookTarget: Vector3 | null = null;
  if (agent.lookAt) lookTarget = _look.set(agent.lookAt.x, agent.lookAt.y, agent.lookAt.z);
  if (ix && (ix.phase === 'orient' || ix.phase === 'signal' || ix.phase === 'response' || ix.phase === 'contact')) {
    const useContact = ix.contactPoint && (ix.kind === 'greet' || ix.kind === 'groom' || ix.kind === 'nurse' || ix.kind === 'play') && (ix.phase === 'contact' || ix.phase === 'response');
    if (useContact && ix.contactPoint) lookTarget = _look.set(ix.contactPoint.x, ix.contactPoint.y, ix.contactPoint.z);
  }
  let wantYaw = Math.sin(inst.animTime * 0.45 + inst.id) * (speed < 0.15 ? 0.18 : 0.05);
  let wantPitch = Math.sin(inst.animTime * 0.31 + inst.id * 0.2) * 0.05;
  if (lookTarget && neck) {
    neck.getWorldPosition(_tmp);
    neck.parent?.getWorldQuaternion(_q);
    _tmp2.subVectors(lookTarget, _tmp).applyQuaternion(_q.invert());
    const horiz = Math.hypot(_tmp2.x, _tmp2.z) || 1e-4;
    wantYaw = clamp(Math.atan2(_tmp2.x, _tmp2.z), -0.9, 0.9);
    wantPitch = clamp(Math.atan2(-_tmp2.y, horiz), -0.55, 0.65);
  }
  const lookK = dt > 0 ? 8 : 0;
  inst.headYaw = damp(inst.headYaw, wantYaw, lookK, dt || 0.016);
  inst.headPitch = damp(inst.headPitch, wantPitch, lookK, dt || 0.016);
  inst.neckYaw = inst.headYaw * 0.35;
  inst.neckPitch = inst.headPitch * 0.32 + pose.neckX + social.reach * 0.12;
  if (neck) mulEuler(neck, restOf(inst, 'neck'), inst.neckPitch, inst.neckYaw, 0);
  if (head) mulEuler(head, restOf(inst, 'head'), inst.headPitch * 0.4 + pose.headX + social.reach * 0.08, inst.headYaw * 0.4, social.crest * -0.08);

  let vocal = 0;
  if (agent.vocalization && frame.env.time <= agent.vocalization.until) {
    vocal = agent.vocalization.kind === 'alarm' || agent.vocalization.kind === 'growl' ? 0.62 : 0.42;
  }
  const jaw = boneOf(inst, 'jaw');
  if (jaw) {
    _e.set(vocal + social.jaw, 0, 0, 'XYZ');
    jaw.quaternion.setFromEuler(_e);
  }

  // Feet.
  const lift = inst.template.hipHeight * scale * LIFT[gait];
  let frontY = 0;
  let hindY = 0;
  let frontN = 0;
  let hindN = 0;
  const widen = 1 + social.widen * 0.32;
  if (!inst.feetReady) {
    for (let i = 0; i < inst.legs.length; i++) {
      const leg = inst.legs[i];
      const hx = leg.spec.homeX * widen;
      const hz = leg.spec.homeZ;
      const wx = x + (_right.x * hx + _fwd.x * hz) * scale;
      const wz = z + (_right.z * hx + _fwd.z * hz) * scale;
      inst.plant[i].set(wx, terrain.heightAt(wx, wz), wz);
      inst.swingTo[i].copy(inst.plant[i]);
      inst.swingFrom[i].copy(inst.plant[i]);
      inst.planted[i] = true;
    }
    inst.feetReady = true;
  }

  for (let i = 0; i < inst.legs.length; i++) {
    const leg = inst.legs[i];
    const hx = leg.spec.homeX * widen;
    const hz = leg.spec.homeZ;
    _home.set(x + (_right.x * hx + _fwd.x * hz) * scale, 0, z + (_right.z * hx + _fwd.z * hz) * scale);
    const off = OFFSET[gait][leg.spec.id] ?? 0;
    const phase = fract(inst.gaitPhase + off);
    const duty = DUTY[gait];
    const stepping = pose.feet === 'gait' && gait !== 'idle' && duty < 0.999;
    if (!stepping) {
      const py = terrain.heightAt(_home.x, _home.z);
      inst.plant[i].x = damp(inst.plant[i].x, _home.x, 7, dt || 0.016);
      inst.plant[i].z = damp(inst.plant[i].z, _home.z, 7, dt || 0.016);
      inst.plant[i].y = terrain.heightAt(inst.plant[i].x, inst.plant[i].z);
      if (!Number.isFinite(inst.plant[i].y)) inst.plant[i].y = py;
      inst.planted[i] = true;
      _toe.copy(inst.plant[i]);
    } else if (phase < duty) {
      if (!inst.planted[i]) {
        inst.plant[i].copy(inst.swingTo[i]);
        inst.plant[i].y = terrain.heightAt(inst.plant[i].x, inst.plant[i].z);
        inst.planted[i] = true;
      }
      _toe.copy(inst.plant[i]);
    } else {
      const st = (phase - duty) / Math.max(1e-4, 1 - duty);
      if (inst.planted[i]) {
        inst.swingFrom[i].copy(inst.plant[i]);
        const reach = stride * duty * 0.5;
        const nx = _home.x + _fwd.x * reach;
        const nz = _home.z + _fwd.z * reach;
        inst.swingTo[i].set(nx, terrain.heightAt(nx, nz), nz);
        inst.planted[i] = false;
      }
      const t = st * st * (3 - 2 * st);
      _toe.x = lerp(inst.swingFrom[i].x, inst.swingTo[i].x, t);
      _toe.z = lerp(inst.swingFrom[i].z, inst.swingTo[i].z, t);
      _toe.y = lerp(inst.swingFrom[i].y, inst.swingTo[i].y, t) + Math.sin(st * Math.PI) * lift;
    }

    leg.upper.getWorldPosition(_hip);
    const sc = scale;
    const L1 = Math.max(0.02, leg.lower.position.length() * sc);
    const L2 = Math.max(0.02, leg.foot.position.length() * sc);
    const L3 = Math.max(0.015, leg.footLen * sc);
    const sideSign = leg.spec.side || 1;

    if (pose.feet === 'tuck') {
      _toe.copy(_hip).addScaledVector(_fwd, -L1 * 0.2).addScaledVector(UP, -L3 * 0.55);
      _ankle.copy(_hip).addScaledVector(_fwd, -L1 * 0.05).addScaledVector(UP, -(L1 + L2) * 0.28);
    } else if (pose.feet === 'limp' && blend > 0.6) {
      mulEuler(leg.upper, restOf(inst, leg.upper.name), 0.35, 0, sideSign * 0.35);
      mulEuler(leg.lower, restOf(inst, leg.lower.name), -0.7, 0, 0);
      mulEuler(leg.foot, restOf(inst, leg.foot.name), 0.45, 0, 0);
      continue;
    } else {
      if (pose.feet === 'sit' && !leg.spec.isFront) {
        _toe.set(_hip.x + _fwd.x * L3 * 1.25, ground + 0.012, _hip.z + _fwd.z * L3 * 1.25);
      } else if (pose.feet === 'lie') {
        _toe.set(_hip.x + _right.x * sideSign * L1 * 0.55 + _fwd.x * L3 * 0.15, ground + 0.012, _hip.z + _right.z * sideSign * L1 * 0.55 + _fwd.z * L3 * 0.15);
      } else if (pose.feet === 'reach') {
        const gy = terrain.heightAt(_hip.x, _hip.z);
        _toe.set(_hip.x + _fwd.x * L3 * 0.3, gy, _hip.z + _fwd.z * L3 * 0.3);
      }
      if (leg.spec.digitigrade) {
        const back = leg.spec.isFront ? 0.18 : 0.4;
        _ankle.set(_toe.x - _fwd.x * L3 * back, _toe.y + L3 * (leg.spec.isFront ? 0.7 : 0.82), _toe.z - _fwd.z * L3 * back);
      } else {
        _ankle.set(_toe.x - _fwd.x * L3 * 0.1, _toe.y + L3 * 0.94, _toe.z - _fwd.z * L3 * 0.1);
      }
      // Keep the ankle inside the two-bone reach.
      _tmp.subVectors(_ankle, _hip);
      const raw = _tmp.length();
      const maxR = L1 + L2 - 1e-3;
      const minR = Math.abs(L1 - L2) + 1e-3;
      if (raw > maxR) _ankle.copy(_hip).addScaledVector(_tmp.multiplyScalar(1 / raw), maxR);
      else if (raw < minR && raw > 1e-4) _ankle.copy(_hip).addScaledVector(_tmp.multiplyScalar(1 / (raw || 1)), minR);
    }

    const fwdSign = leg.spec.isFront && leg.spec.digitigrade ? -1 : 1;
    limbPole(_hip, _fwd, _tmp2.set(_right.x * sideSign, 0, _right.z * sideSign), L1, fwdSign, _pole);
    solveTwoBone(_hip, _ankle, _pole, L1, L2, _knee);
    if (!leg.spec.digitigrade) {
      // Columnar legs stay in the sagittal plane. A side pole rolls a straight knee out flat.
      const along = L1 / Math.max(0.001, L1 + L2);
      _knee.copy(_hip).lerp(_ankle, along);
      _knee.addScaledVector(_fwd, L1 * 0.1 * fwdSign);
      _pole.copy(_hip).addScaledVector(_fwd, L1 * fwdSign).addScaledVector(UP, L1 * 0.25);
    }
    aimBone(leg.upper, _knee, _pole);
    aimBone(leg.lower, _ankle, _pole);
    _tmp.copy(_pole).setY(_hip.y + L1);
    aimBone(leg.foot, _toe, _tmp);

    if (leg.spec.isFront) {
      frontY += _toe.y;
      frontN++;
    } else {
      hindY += _toe.y;
      hindN++;
    }
    if (debug.footTargets) {
      const m = inst.footDebug[i];
      m.visible = true;
      m.position.copy(_toe);
      m.scale.setScalar(Math.max(0.04, scale * 0.05));
    } else if (inst.footDebug[i]) inst.footDebug[i].visible = false;
  }

  if (frontN && hindN) {
    inst.lastFootY.front = frontY / frontN;
    inst.lastFootY.hind = hindY / hindN;
  }

  if (debug.contactPoints && ix?.contactPoint) {
    inst.contactDebug!.visible = true;
    inst.contactDebug!.position.set(ix.contactPoint.x, ix.contactPoint.y, ix.contactPoint.z);
  } else if (inst.contactDebug) inst.contactDebug.visible = false;

  if (debug.skeleton) {
    if (!inst.helper) {
      inst.helper = new SkeletonHelper(inst.mesh);
      inst.helper.frustumCulled = false;
    }
    inst.helper.visible = true;
  } else if (inst.helper) inst.helper.visible = false;

  const chestB = boneOf(inst, 'chest');
  if (chestB) chestB.getWorldPosition(inst.anchor);
  else inst.anchor.set(x, y + inst.template.shoulderHeight * scale, z);

  // Proxy shapes in mesh-local metres (mesh scale carries growth).
  if (inst.proxies[0]) {
    const body = inst.proxies[0];
    body.position.set(0, inst.template.hipHeight * 0.72, inst.template.torsoLength * 0.05);
    body.scale.set(inst.template.bodyRx * 2.3, inst.template.bodyRy * 2.1, inst.template.torsoLength * 1.15);
  }
  if (inst.proxies[1]) {
    const headP = inst.proxies[1];
    headP.position.set(0, inst.template.shoulderHeight * 0.92, inst.template.headReach * 0.72);
    headP.scale.set(inst.template.bodyRx * 0.85, inst.template.bodyRy * 0.7, inst.profile.body.headReach * 0.45);
  }

  inst.material.userData.coat.uHighlight.value = inst.highlighted ? 1 : 0;
  inst.lastX = x;
  inst.lastZ = z;
  inst.lastHeading = heading;
}
