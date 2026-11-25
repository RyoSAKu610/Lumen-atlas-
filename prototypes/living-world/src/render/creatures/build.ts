/**
 * Procedural skinned species. Morphology lengths are fractions of SpeciesProfile.body.length.
 * One template mesh per species; agents receive a SkeletonUtils clone.
 *
 * Bone hierarchy (names are stable):
 *   root
 *     pelvis
 *       spine
 *         chest
 *           neck
 *             head
 *               jaw, ear_l, ear_r, horn_l, horn_r, crest
 *           dorsal
 *           leg_fl_*, leg_fr_*
 *           wing_l_*, wing_r_*  (upper / mid / hand / f0..)
 *       leg_hl_*, leg_hr_*   (upper / lower / foot)
 *       tail_0 .. tail_n
 */
import {
  Bone,
  BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
  type Material,
} from 'three';
import type { CreatureLook, CreatureMorphology, SpeciesProfile } from '../../data/schema';
import type { AnatomyFamily } from '../../sim/ids';
import { AXIS_UP, aimBone, limbPole, solveTwoBone } from './ik';
import {
  REG_BELLY,
  REG_BODY,
  REG_DORSAL,
  REG_HORN,
  REG_MANE,
  REG_PRIMARY,
  REG_WING,
  createEyeMaterial,
} from './materials';

type LegSpec = NonNullable<CreatureMorphology['legs']['hind']>;
type Morph = CreatureMorphology;

export interface LegTemplate {
  id: 'fl' | 'fr' | 'hl' | 'hr';
  side: number;
  isFront: boolean;
  digitigrade: boolean;
  footStyle: string;
  footLen: number;
  homeX: number;
  homeZ: number;
}

export interface SpeciesTemplate {
  speciesId: string;
  family: AnatomyFamily;
  mesh: SkinnedMesh;
  /** Unscaled bind metrics, metres. */
  hipHeight: number;
  shoulderHeight: number;
  torsoLength: number;
  bodyRx: number;
  bodyRy: number;
  bodyLength: number;
  headReach: number;
  legs: LegTemplate[];
  tailCount: number;
  hasWings: boolean;
  fingerCount: number;
  eyeMat: MeshStandardMaterial;
  boneNames: string[];
  disposables: { dispose(): void }[];
}

const _v = new Vector3();
const _q = new Quaternion();

function fin(n: number, fb: number): number {
  return Number.isFinite(n) ? n : fb;
}
function cl(n: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, fin(n, (a + b) * 0.5)));
}

class Geo {
  readonly p: number[] = [];
  readonly c: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly ix: number[] = [];

  vert(pos: Vector3, b0: number, b1: number, w0: number, region: number): number {
    const i = this.p.length / 3;
    this.p.push(pos.x, pos.y, pos.z);
    this.c.push(region / 8, 1, 1);
    const w = cl(w0, 0, 1);
    this.si.push(b0, b1, 0, 0);
    this.sw.push(w, 1 - w, 0, 0);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    if (a === b || b === c || a === c) return;
    this.ix.push(a, b, c);
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.c, 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.ix);
    g.computeVertexNormals();
    return g;
  }
}

interface Frame {
  c: Vector3;
  rx: number;
  ry: number;
  exp: number;
  b0: number;
  b1: number;
  w: number;
  region: number;
  belly: boolean;
  right?: Vector3;
  up?: Vector3;
}

function addLoft(g: Geo, frames: Frame[], radial: number): void {
  if (frames.length < 2) return;
  const rows: number[][] = [];
  let prevRight: Vector3 | null = null;
  const rights: Vector3[] = [];
  const ups: Vector3[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    let right: Vector3;
    let up: Vector3;
    if (f.right && f.up) {
      right = f.right.clone().normalize();
      up = f.up.clone().normalize();
    } else {
      const prev = frames[Math.max(0, i - 1)].c;
      const next = frames[Math.min(frames.length - 1, i + 1)].c;
      const t = _v.copy(next).sub(prev);
      if (t.lengthSq() < 1e-10) t.set(0, 0, 1);
      t.normalize();
      if (prevRight) {
        right = prevRight.clone().addScaledVector(t, -prevRight.dot(t));
        if (right.lengthSq() < 1e-8) right.crossVectors(Math.abs(t.y) > 0.8 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0), t);
      } else {
        const ref = Math.abs(t.y) > 0.82 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
        right = new Vector3().crossVectors(ref, t);
      }
      if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
      right.normalize();
      up = new Vector3().crossVectors(t, right).normalize();
      if (up.y < 0) {
        up.negate();
        right.negate();
      }
    }
    prevRight = right;
    rights.push(right);
    ups.push(up);
    const row: number[] = [];
    const exp = cl(f.exp, 1.2, 6);
    const pwr = 2 / exp;
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const c0 = Math.cos(a);
      const s0 = Math.sin(a);
      const c = Math.sign(c0) * Math.pow(Math.abs(c0), pwr) || 0;
      const s = Math.sign(s0) * Math.pow(Math.abs(s0), pwr) || 0;
      const pos = f.c.clone().addScaledVector(right, c * f.rx).addScaledVector(up, s * f.ry);
      let region = f.region;
      if (f.belly && s < -0.18 && region === REG_BODY) region = REG_BELLY;
      row.push(g.vert(pos, f.b0, f.b1, f.w, region));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      const a = rows[i][k];
      const b = rows[i][k2];
      const c = rows[i + 1][k];
      const d = rows[i + 1][k2];
      g.tri(a, b, c);
      g.tri(b, d, c);
    }
  }
  const cap = (row: number[], center: Vector3, frame: Frame, sign: number) => {
    const ci = g.vert(center, frame.b0, frame.b1, frame.w, frame.region);
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      if (sign > 0) g.tri(row[k], row[k2], ci);
      else g.tri(row[k], ci, row[k2]);
    }
  };
  cap(rows[0], frames[0].c, frames[0], -1);
  cap(rows[rows.length - 1], frames[frames.length - 1].c, frames[frames.length - 1], 1);
  void rights;
  void ups;
}

function paint(geo: BufferGeometry, region: number): BufferGeometry {
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = region / 8;
    col[i * 3 + 1] = 1;
    col[i * 3 + 2] = 1;
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  return geo;
}

function unitFeather(region: number): BufferGeometry {
  const g = new Geo();
  const segs = 4;
  const rows: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = Math.sin(t * Math.PI) * (1 - t * 0.25);
    const y = Math.sin(t * Math.PI) * 0.04;
    const row = [
      g.vert(new Vector3(t, y, -w * 0.5), 0, 0, 1, region),
      g.vert(new Vector3(t, y, w * 0.5), 0, 0, 1, region),
    ];
    rows.push(row);
  }
  for (let i = 0; i < segs; i++) {
    g.tri(rows[i][0], rows[i][1], rows[i + 1][0]);
    g.tri(rows[i][1], rows[i + 1][1], rows[i + 1][0]);
  }
  const geo = g.toGeometry();
  return geo;
}

function coatMesh(geo: BufferGeometry, mat: Material, regionRepaint?: number): Mesh {
  const g = regionRepaint !== undefined ? paint(geo, regionRepaint) : geo;
  const m = new Mesh(g, mat);
  m.userData.coat = 1;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function petalGeometry(length: number, width: number, pointed: boolean): BufferGeometry {
  const g = new Geo();
  const segs = 5;
  const rows: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const belly = pointed ? 1 - t : Math.sin(t * Math.PI);
    const w = width * (0.25 + 0.75 * belly) * (pointed ? 1 : 1);
    const fold = Math.sin(t * Math.PI) * width * 0.18;
    const row = [
      g.vert(new Vector3(-w * 0.5, t * length, fold), 0, 0, 1, REG_BODY),
      g.vert(new Vector3(w * 0.5, t * length, fold), 0, 0, 1, REG_BODY),
      g.vert(new Vector3(0, t * length, -width * 0.08), 0, 0, 1, REG_BELLY),
    ];
    rows.push(row);
  }
  for (let i = 0; i < segs; i++) {
    g.tri(rows[i][0], rows[i][1], rows[i + 1][1]);
    g.tri(rows[i][0], rows[i + 1][1], rows[i + 1][0]);
    g.tri(rows[i][2], rows[i + 1][2], rows[i][0]);
    g.tri(rows[i][0], rows[i + 1][2], rows[i + 1][0]);
  }
  return g.toGeometry();
}

function arcHornGeometry(length: number, radius: number, curl: number): BufferGeometry {
  const g = new Geo();
  const segs = 8;
  const radial = 7;
  const frames: Frame[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = t * curl;
    const c = new Vector3(Math.sin(ang) * length * 0.55, t * length * Math.cos(ang * 0.25), Math.sin(t * 1.2) * length * 0.12);
    const r = radius * (1 - t * 0.72);
    frames.push({ c, rx: Math.max(0.004, r), ry: Math.max(0.004, r * 0.82), exp: 2, b0: 0, b1: 0, w: 1, region: REG_HORN, belly: false });
  }
  addLoft(g, frames, radial);
  return g.toGeometry();
}

function finGeometry(length: number, height: number): BufferGeometry {
  const g = new Geo();
  const a = g.vert(new Vector3(0, 0, -length * 0.15), 0, 0, 1, REG_HORN);
  const b = g.vert(new Vector3(0, height * 0.25, length * 0.15), 0, 0, 1, REG_HORN);
  const c = g.vert(new Vector3(0, height, length * 0.55), 0, 0, 1, REG_HORN);
  const d = g.vert(new Vector3(0, height * 0.15, length), 0, 0, 1, REG_HORN);
  const e = g.vert(new Vector3(0.012, height * 0.4, length * 0.4), 0, 0, 1, REG_HORN);
  const f = g.vert(new Vector3(-0.012, height * 0.4, length * 0.4), 0, 0, 1, REG_HORN);
  g.tri(a, b, e);
  g.tri(b, c, e);
  g.tri(c, d, e);
  g.tri(a, f, b);
  g.tri(b, f, c);
  g.tri(c, f, d);
  return g.toGeometry();
}

function bone(parent: Object3D, name: string, x: number, y: number, z: number): Bone {
  const b = new Bone();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

function wp(b: Bone, out = new Vector3()): Vector3 {
  return b.getWorldPosition(out);
}

export function buildSpecies(species: SpeciesProfile, look: CreatureLook): SpeciesTemplate {
  const disposables: { dispose(): void }[] = [];
  const L = Math.max(0.15, fin(species.body.length, 1));
  const m = look.morphology;
  const torsoLen = Math.max(0.08, m.torso.length * L);
  const neckLen = Math.max(0.04, m.neck.length * L);
  const headLen = Math.max(0.05, m.head.length * L);
  const snoutLen = cl(m.head.snoutLength * L, 0, headLen * 0.92);
  const pitch = (cl(m.neck.pitchDeg, -60, 85) * Math.PI) / 180;
  const depth = cl(m.torso.depthRatio, 0.4, 2);
  const rxRear = Math.max(0.02, m.torso.girthRear * L);
  const rxMid = Math.max(0.02, m.torso.girthMid * L);
  const rxFront = Math.max(0.02, m.torso.girthFront * L);
  const hump = Math.max(0, m.torso.hump * L);
  const neckR = Math.max(0.015, m.neck.radius * L);
  const headRx = Math.max(0.02, m.head.width * L);
  const headRy = Math.max(0.02, m.head.height * L);
  const headReach = Math.max(0.05, fin(species.body.headReach, L * 0.6));

  const hind = m.legs.hind;
  const front = m.legs.pairs === 2 ? m.legs.front : null;
  const reach = (leg: LegSpec): number => {
    const Lu = leg.upper * L;
    const Ll = leg.lower * L;
    const Lf = leg.foot * L;
    if (!leg.digitigrade) return (Lu + Ll) * 0.985 + Lf * 0.92;
    return Lf * 0.8 + (Lu + Ll) * 0.9;
  };
  const hindY = reach(hind);
  const frontY = front ? reach(front) : hindY + Math.sin(cl(m.torso.backSlope, -0.6, 0.6)) * torsoLen * 0.5;
  const slope = cl(m.torso.backSlope, -0.6, 0.6);
  const chestY = frontY + Math.sin(slope) * torsoLen * 0.12;
  const pelvisY = hindY;

  const placeholder = new MeshStandardMaterial({ color: look.material.base, roughness: 0.8 });
  disposables.push(placeholder);
  const mesh = new SkinnedMesh(new BufferGeometry(), placeholder);
  mesh.name = 'body';
  mesh.userData.coat = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const root = bone(mesh, 'root', 0, 0, 0);
  const pelvis = bone(root, 'pelvis', 0, pelvisY, -torsoLen * 0.5);
  const spine = bone(pelvis, 'spine', 0, (chestY - pelvisY) * 0.48, torsoLen * 0.5);
  const chest = bone(spine, 'chest', 0, (chestY - pelvisY) * 0.52, torsoLen * 0.5);
  const neck = bone(chest, 'neck', 0, neckR * 0.15, 0);
  // Positive pitchDeg raises the neck. +X rotation points +Z down, so the sign is negated.
  neck.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -pitch);
  const curl = Math.max(0, pitch) * 0.22;
  const head = bone(neck, 'head', 0, -neckLen * curl, neckLen);
  head.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), pitch * 0.85);
  const jaw = bone(head, 'jaw', 0, -headRy * 0.22, headLen * 0.22);

  const dorsal = bone(chest, 'dorsal', 0, rxFront * depth * 0.55, -torsoLen * 0.05);

  // Tail. Child offset is in the parent frame; curl is a local +X rotation so the chain lifts or droops.
  const tailLen = Math.max(0, m.tail.length * L);
  const tailN = cl(Math.round(m.tail.segments), 2, 16) | 0;
  const tailBones: Bone[] = [];
  if (tailLen > 0.02) {
    const seg = tailLen / tailN;
    const curlSeg = cl(m.tail.restCurve, -2, 2) / tailN;
    let parentBone: Bone = pelvis;
    for (let i = 0; i < tailN; i++) {
      const t = bone(parentBone, `tail_${i}`, 0, 0, -seg);
      t.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), curlSeg);
      tailBones.push(t);
      parentBone = t;
    }
  }

  const legTemplates: LegTemplate[] = [];

  const buildLeg = (parentBone: Bone, id: LegTemplate['id'], side: number, isFront: boolean, spec: LegSpec, hipYOffset: number, hipZ: number) => {
    const Lu = Math.max(0.04, spec.upper * L);
    const Ll = Math.max(0.04, spec.lower * L);
    const Lf = Math.max(0.02, spec.foot * L);
    const hipLocal = new Vector3(side * spec.stanceWidth * L * 0.5, hipYOffset, hipZ);
    const upper = bone(parentBone, `leg_${id}_upper`, hipLocal.x, hipLocal.y, hipLocal.z);
    const lower = bone(upper, `leg_${id}_lower`, 0, -Lu, 0);
    const foot = bone(lower, `leg_${id}_foot`, 0, -Ll, 0);
    mesh.updateMatrixWorld(true);
    const hipW = wp(upper);
    const fwd = isFront && spec.digitigrade ? -1 : 1;
    let ankle: Vector3;
    let toe: Vector3;
    if (spec.digitigrade) {
      const pawF = Lf * (isFront ? 0.35 : 0.28);
      toe = new Vector3(hipW.x, 0, hipW.z + pawF);
      ankle = new Vector3(hipW.x, Lf * (isFront ? 0.72 : 0.84), hipW.z + (isFront ? pawF * 0.15 : -Lf * 0.42));
    } else {
      ankle = new Vector3(hipW.x, Lf * 0.96, hipW.z);
      toe = new Vector3(hipW.x, 0, hipW.z + Lf * 0.22);
    }
    const sideDir = new Vector3(side, 0, 0);
    const forward = new Vector3(0, 0, 1);
    const pole = limbPole(hipW, forward, sideDir, Lu, fwd, new Vector3());
    const knee = new Vector3();
    if (!spec.digitigrade) {
      const along = Lu / Math.max(0.001, Lu + Ll);
      knee.copy(hipW).lerp(ankle, along);
      knee.z += Lu * 0.1 * fwd;
      pole.copy(hipW).addScaledVector(forward, Lu * fwd).addScaledVector(new Vector3(0, 1, 0), Lu * 0.25);
    } else {
      solveTwoBone(hipW, ankle, pole, Lu, Ll, knee);
    }
    aimBone(upper, knee, pole);
    aimBone(lower, ankle, pole);
    aimBone(foot, toe, pole.clone().setY(hipW.y + Lu));
    legTemplates.push({
      id,
      side,
      isFront,
      digitigrade: spec.digitigrade,
      footStyle: spec.footStyle,
      footLen: Lf,
      homeX: toe.x,
      homeZ: toe.z,
    });
    return { upper, lower, foot, Lu, Ll, Lf };
  };

  const hindLegs = [
    buildLeg(pelvis, 'hl', -1, false, hind, -rxRear * depth * 0.12, torsoLen * 0.02),
    buildLeg(pelvis, 'hr', 1, false, hind, -rxRear * depth * 0.12, torsoLen * 0.02),
  ];
  const frontLegs = front
    ? [
        buildLeg(chest, 'fl', -1, true, front, -rxFront * depth * 0.05, torsoLen * 0.02),
        buildLeg(chest, 'fr', 1, true, front, -rxFront * depth * 0.05, torsoLen * 0.02),
      ]
    : [];

  // Ears, horns — bones only; meshes attached after bind.
  const earStyle = m.head.ears.style;
  const earLen = Math.max(0, m.head.ears.length * L);
  if (earStyle !== 'none' && earLen > 0.005) {
    const ex = headRx * (earStyle === 'frill' ? 0.15 : 0.72);
    const ey = headRy * (earStyle === 'frill' ? 0.05 : 0.55);
    const ez = headLen * (earStyle === 'frill' ? 0.08 : 0.22);
    const splay = earStyle === 'long' ? 0.55 : earStyle === 'pointed' ? 0.35 : 0.2;
    for (const side of [-1, 1]) {
      const e = bone(head, side < 0 ? 'ear_l' : 'ear_r', side * ex, ey, ez);
      e.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -side * splay);
      if (earStyle === 'long') e.rotateX(-0.35);
    }
  }
  const hornStyle = m.head.horns.style;
  const hornLen = Math.max(0, m.head.horns.length * L);
  const hornSpread = Math.max(0, m.head.horns.spread * L);
  if (hornLen > 0.005 && hornStyle !== 'none') {
    if (hornStyle === 'crest' || hornStyle === 'single_spike') {
      const c = bone(head, 'crest', 0, headRy * 0.72, headLen * (hornStyle === 'crest' ? 0.42 : 0.2));
      c.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), hornStyle === 'crest' ? -0.2 : -0.6);
    } else {
      for (const side of [-1, 1]) {
        const h = bone(head, side < 0 ? 'horn_l' : 'horn_r', side * hornSpread * 0.5, headRy * 0.55, headLen * 0.18);
        h.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -side * 0.45);
        h.rotateX(-0.35);
      }
    }
  }

  // Wings — extended bind pose (identity local axes, +X right). Animation folds them.
  const wings = m.wings;
  let fingerCount = 0;
  if (wings) {
    fingerCount = cl(Math.round(wings.fingers), 0, 10) | 0;
    const halfSpan = Math.max(0.2, wings.span * L * 0.5);
    const chord = Math.max(0.05, wings.chord * L);
    const rootX = rxFront * 0.85;
    const featherExtra = chord * (wings.style === 'membrane' ? 0.6 : 1.05);
    const chain = Math.max(chord, halfSpan - rootX - featherExtra);
    const hum = chain * 0.36;
    const midL = chain * 0.34;
    const handL = chain * 0.3;
    for (const side of [-1, 1] as const) {
      const tag = side > 0 ? 'r' : 'l';
      const upper = bone(chest, `wing_${tag}_upper`, side * rootX, rxFront * depth * 0.42, -torsoLen * 0.02);
      const mid = bone(upper, `wing_${tag}_mid`, side * hum, 0, 0);
      const hand = bone(mid, `wing_${tag}_hand`, side * midL, 0, 0);
      for (let i = 0; i < fingerCount; i++) {
        const splay = (i - (fingerCount - 1) / 2) * 0.11;
        const f = bone(hand, `wing_${tag}_f${i}`, side * handL, 0, 0);
        f.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), side > 0 ? splay : -splay);
      }
      upper.userData.seg = hum;
      mid.userData.seg = midL;
      hand.userData.seg = handL;
      upper.userData.chord = chord;
      upper.userData.wingStyle = wings.style;
    }
  }

  // Place snout on +Z = headReach by sliding the pelvis (children follow).
  mesh.updateMatrixWorld(true);
  const headPos = wp(head);
  head.getWorldQuaternion(_q);
  const headFwd = new Vector3(0, 0, 1).applyQuaternion(_q);
  const snout = headPos.clone().addScaledVector(headFwd, headLen);
  pelvis.position.z += headReach - snout.z;
  mesh.updateMatrixWorld(true);

  // Refresh foot homes after the slide.
  for (const leg of legTemplates) {
    const footB = mesh.getObjectByName(`leg_${leg.id}_foot`) as Bone;
    const origin = wp(footB);
    footB.getWorldQuaternion(_q);
    const toe = new Vector3(0, -leg.footLen, 0).applyQuaternion(_q).add(origin);
    leg.homeX = toe.x;
    leg.homeZ = toe.z;
  }

  const bones: Bone[] = [];
  root.traverse((o) => {
    if ((o as Bone).isBone) bones.push(o as Bone);
  });
  const indexOf = new Map<string, number>();
  bones.forEach((b, i) => indexOf.set(b.name, i));
  const id = (name: string) => indexOf.get(name) ?? 0;

  const g = new Geo();
  const frames: Frame[] = [];
  const push = (c: Vector3, rx: number, ry: number, b0: number, b1: number, w: number, region = REG_BODY, exp = 2, belly = true) => {
    frames.push({
      c: c.clone(),
      rx: Math.max(0.006, rx),
      ry: Math.max(0.006, ry),
      exp,
      b0,
      b1,
      w,
      region,
      belly,
    });
  };

  // Tail, tip → base. Wide plume / fan / club shapes live in the cross-section.
  if (tailBones.length) {
    const baseR = Math.max(0.008, m.tail.baseRadius * L);
    const tipR = Math.max(0.004, m.tail.tipRadius * L);
    const style = m.tail.style;
    const samples: { p: Vector3; t: number; bone: number; prev: number }[] = [];
    const last = tailBones[tailBones.length - 1];
    const before = tailBones.length > 1 ? tailBones[tailBones.length - 2] : pelvis;
    const tipDir = wp(last).sub(wp(before));
    if (tipDir.lengthSq() < 1e-8) tipDir.set(0, 0, -1);
    tipDir.normalize();
    samples.push({ p: wp(last).addScaledVector(tipDir, tailLen / tailN * 0.9), t: 1, bone: id(last.name), prev: id(before.name) });
    for (let i = tailBones.length - 1; i >= 0; i--) {
      const b = tailBones[i];
      const prevB = i > 0 ? tailBones[i - 1] : pelvis;
      samples.push({ p: wp(b), t: i / tailBones.length, bone: id(b.name), prev: id(prevB.name) });
    }
    samples.push({ p: wp(pelvis), t: 0, bone: id('pelvis'), prev: id('spine') });
    for (const s of samples) {
      const along = s.t;
      let rx = baseR + (tipR - baseR) * along;
      let ry = rx * 0.85;
      let exp = 2;
      if (style === 'plume') {
        const flare = Math.sin(along * Math.PI);
        rx *= 1.08 + flare * 0.45;
        ry = rx * 0.8;
        exp = 2.2;
      } else if (style === 'bushy') {
        rx *= 1.35 + Math.sin(along * Math.PI) * 0.8;
        ry = rx * 0.9;
      } else if (style === 'fan') {
        const fan = smooth01(along);
        rx *= 1 + fan * 3.2;
        ry *= 1 - fan * 0.75;
        exp = 2.6;
      } else if (style === 'club') {
        const bulb = smooth01((along - 0.72) / 0.28);
        rx *= 1 - along * 0.35 + bulb * 1.5;
        ry = rx;
      } else if (style === 'whip') {
        rx *= 1 - along * 0.55;
        ry = rx * 0.8;
      }
      push(s.p, rx, ry, s.bone, s.prev, 0.82, REG_BODY, exp, false);
    }
  }

  const pelvisP = wp(pelvis);
  const spineP = wp(spine);
  const chestP = wp(chest);
  const pushTorso = (p: Vector3, rx: number, b0: number, b1: number, w: number, humpAdd = 0) => {
    const c = p.clone();
    c.y += humpAdd * 0.35;
    push(c, rx, rx * depth + humpAdd * 0.7, b0, b1, w, REG_BODY, 2.15, true);
  };
  pushTorso(pelvisP, rxRear, id('pelvis'), id('spine'), 0.75);
  pushTorso(pelvisP.clone().lerp(spineP, 0.45), rxRear * 0.55 + rxMid * 0.45, id('pelvis'), id('spine'), 0.4);
  pushTorso(spineP, rxMid, id('spine'), id('pelvis'), 0.62);
  pushTorso(spineP.clone().lerp(chestP, 0.5), rxMid * 0.45 + rxFront * 0.55, id('spine'), id('chest'), 0.5);
  pushTorso(chestP, rxFront, id('chest'), id('spine'), 0.7, hump);

  const headP = wp(head);
  const neckSamples = 4;
  for (let i = 1; i <= neckSamples; i++) {
    const t = i / (neckSamples + 1);
    const p = chestP.clone().lerp(headP, t);
    const w = 1 - t * 0.85;
    const r = neckR * (1 - t * 0.18);
    push(p, r, r * 1.08, id('neck'), id('chest'), w, REG_BODY, 2, true);
  }

  head.getWorldQuaternion(_q);
  const hf = new Vector3(0, 0, 1).applyQuaternion(_q);
  const hu = new Vector3(0, 1, 0).applyQuaternion(_q);
  const hr = new Vector3(1, 0, 0).applyQuaternion(_q);
  const jawKind = m.head.jaw;
  const snoutStart = 1 - snoutLen / headLen;
  const headSlices = 7;
  for (let i = 0; i <= headSlices; i++) {
    const u = i / headSlices;
    const p = headP.clone().addScaledVector(hf, headLen * u);
    let rx = headRx;
    let ry = headRy;
    let exp = jawKind === 'blunt' ? 3.3 : jawKind === 'beaked' ? 2.15 : 2.3;
    if (u > snoutStart) {
      const st = (u - snoutStart) / Math.max(1e-4, 1 - snoutStart);
      const taper = cl(m.head.snoutTaper, 0, 1);
      rx *= 1 - st * (0.25 + taper * 0.7);
      ry *= jawKind === 'beaked' ? 1 - st * 0.72 : 1 - st * (0.15 + taper * 0.45);
      if (jawKind === 'beaked' && st > 0.45) p.addScaledVector(hu, -ry * 0.55 * (st - 0.45));
      if (jawKind === 'blunt') exp = 3.6;
    }
    // Slight crown.
    if (u < 0.35) ry *= 1.06;
    const region = jawKind === 'beaked' && u > 0.62 ? REG_HORN : REG_BODY;
    const onHead = u > 0.15;
    push(p, rx, ry, onHead ? id('head') : id('neck'), onHead ? id('neck') : id('chest'), onHead ? 0.8 : 0.55, region, exp, jawKind !== 'beaked');
    void hr;
  }

  addLoft(g, frames, 16);

  // Lower jaw wedge so the mouth can open without taking the cranium with it.
  {
    const jawFrames: Frame[] = [];
    const slices = 5;
    for (let i = 0; i <= slices; i++) {
      const u = 0.25 + (i / slices) * 0.75;
      const p = headP.clone().addScaledVector(hf, headLen * u).addScaledVector(hu, -headRy * (0.15 + u * 0.25));
      let rx = headRx * (u > snoutStart ? 0.55 : 0.72);
      let ry = headRy * 0.38;
      if (jawKind === 'beaked') {
        rx *= 0.7;
        ry *= 0.55;
      }
      jawFrames.push({
        c: p,
        rx: Math.max(0.01, rx),
        ry: Math.max(0.008, ry),
        exp: jawKind === 'blunt' ? 3.2 : 2,
        b0: id('jaw'),
        b1: id('head'),
        w: 0.86,
        region: jawKind === 'beaked' ? REG_HORN : REG_BODY,
        belly: true,
      });
    }
    addLoft(g, jawFrames, 8);
  }

  // Legs.
  const addLegLoft = (spec: LegSpec, upper: Bone, lower: Bone, foot: Bone) => {
    mesh.updateMatrixWorld(true);
    const hip = wp(upper);
    const knee = wp(lower);
    const ankle = wp(foot);
    foot.getWorldQuaternion(_q);
    const toe = new Vector3(0, -spec.foot * L, 0).applyQuaternion(_q).add(ankle);
    const r0 = Math.max(0.01, spec.radiusTop * L);
    const r1 = Math.max(0.008, spec.radiusBottom * L);
    const bi = [id(upper.name), id(lower.name), id(foot.name)];
    const socket = id(upper.parent?.name ?? 'pelvis');
    const pts = [hip, hip.clone().lerp(knee, 0.35), hip.clone().lerp(knee, 0.7), knee, knee.clone().lerp(ankle, 0.5), ankle, ankle.clone().lerp(toe, 0.55), toe];
    const weights: Array<[number, number, number]> = [
      [socket, bi[0], 0.72],
      [bi[0], socket, 0.55],
      [bi[0], bi[1], 0.82],
      [bi[1], bi[0], 0.5],
      [bi[1], bi[2], 0.72],
      [bi[2], bi[1], 0.62],
      [bi[2], bi[1], 0.9],
      [bi[2], bi[1], 0.97],
    ];
    const lf: Frame[] = pts.map((p, i) => {
      const t = i / (pts.length - 1);
      let rx = r0 + (r1 - r0) * t;
      let ry = rx;
      if (i === 0) rx *= 1.35;
      if (i === 3 || i === 5) rx *= 1.12; // joint bulge
      if (i >= pts.length - 2) {
        if (spec.footStyle === 'column') rx *= 1.35 + (i === pts.length - 1 ? 0.45 : 0);
        if (spec.footStyle === 'hoof') rx *= i === pts.length - 1 ? 1.15 : 0.85;
        if (spec.footStyle === 'pad') {
          rx *= 1.25;
          ry *= 0.55;
        }
        if (spec.footStyle === 'talon') rx *= 0.7;
      }
      const region = spec.footStyle === 'hoof' && i === pts.length - 1 ? REG_HORN : spec.footStyle === 'column' && i === pts.length - 1 ? REG_HORN : REG_BODY;
      return { c: p, rx, ry, exp: 2, b0: weights[i][0], b1: weights[i][1], w: weights[i][2], region, belly: false };
    });
    addLoft(g, lf, 8);
  };
  for (const leg of hindLegs) addLegLoft(hind, leg.upper, leg.lower, leg.foot);
  if (front) for (const leg of frontLegs) addLegLoft(front, leg.upper, leg.lower, leg.foot);

  // Moss mantle — the giant's broken topline. Other dorsal styles are parented meshes.
  if (m.dorsal.style === 'moss_mantle' && m.dorsal.height > 0) {
    const height = m.dorsal.height * L;
    const coverage = cl(m.dorsal.coverage, 0.05, 1);
    const steps = Math.max(6, Math.min(24, m.dorsal.count || 12));
    const mantle: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const along = t * coverage;
      const p = chestP.clone().lerp(spineP, Math.min(1, along * 1.4)).lerp(pelvisP, Math.max(0, along - 0.45) / 0.55);
      if (along < 0.5) p.copy(chestP).lerp(spineP, along / 0.5);
      else p.copy(spineP).lerp(pelvisP, (along - 0.5) / 0.5);
      const rx = rxFront + (rxRear - rxFront) * Math.min(1, along);
      const scallop = 0.9 + 0.1 * Math.sin(i * 0.9);
      const lift = height * (1.35 - t * 0.25) * (0.82 + 0.18 * Math.sin(i * 0.9));
      const hang = (rx * depth * 0.55 + height * 1.6) * (0.75 + Math.sin(t * Math.PI) * 0.35) * scallop;
      const b0 = along < 0.45 ? id('dorsal') : along < 0.75 ? id('spine') : id('pelvis');
      const b1 = along < 0.45 ? id('chest') : id('dorsal');
      const w = along < 0.45 ? 0.75 : 0.6;
      const ridge = p.clone();
      ridge.y += rx * depth + lift;
      // Hem stays near the flank and drops, so it reads as a cloak rather than a pair of arms.
      const left = p.clone();
      left.x -= rx * 1.02;
      left.y += rx * depth * 0.05 - height * 1.8;
      const right = p.clone();
      right.x += rx * 1.02;
      right.y += rx * depth * 0.05 - height * 1.8;
      const row = [g.vert(left, b0, b1, w, REG_DORSAL), g.vert(ridge, b0, b1, w, REG_DORSAL), g.vert(right, b0, b1, w, REG_DORSAL)];
      mantle.push(row);
    }
    for (let i = 0; i < mantle.length - 1; i++) {
      g.tri(mantle[i][0], mantle[i][1], mantle[i + 1][1]);
      g.tri(mantle[i][0], mantle[i + 1][1], mantle[i + 1][0]);
      g.tri(mantle[i][1], mantle[i][2], mantle[i + 1][2]);
      g.tri(mantle[i][1], mantle[i + 1][2], mantle[i + 1][1]);
    }
  }

  const geo = g.toGeometry();
  disposables.push(geo);
  mesh.geometry = geo;
  const skeleton = new Skeleton(bones);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();

  // ---- rigid attachments (parented to bones; they ride the skeleton without skin stretch)
  const eyeMat = createEyeMaterial(look.material.eye);
  disposables.push(eyeMat);
  const pupilMat = new MeshStandardMaterial({ color: '#14120f', roughness: 0.35 });
  disposables.push(pupilMat);
  const eyeGeo = new SphereGeometry(1, 12, 10);
  disposables.push(eyeGeo);
  const eyeR = cl(m.head.eyeSize, 0.04, 0.45) * m.head.height * L;
  const eyeFwd = cl(m.head.eyeForward, 0, 1);
  for (const side of [-1, 1]) {
    const eye = new Mesh(eyeGeo, eyeMat);
    eye.name = side < 0 ? 'eye_l' : 'eye_r';
    eye.castShadow = true;
    eye.scale.setScalar(Math.max(0.008, eyeR));
    const lateral = (1 - eyeFwd * 0.72) * headRx * 0.96;
    const forward = headLen * (0.28 + eyeFwd * 0.42);
    const up = headRy * (0.08 + (1 - eyeFwd) * 0.08);
    eye.position.set(side * lateral, up, forward);
    head.add(eye);
    const pupil = new Mesh(eyeGeo, pupilMat);
    pupil.name = 'pupil';
    const outward = new Vector3(side * (1 - eyeFwd * 0.85), 0.08, 0.25 + eyeFwd * 0.9).normalize();
    pupil.position.copy(outward).multiplyScalar(0.72);
    pupil.scale.setScalar(0.48);
    eye.add(pupil);
  }

  if (earStyle !== 'none' && earLen > 0.005) {
    const pointed = earStyle === 'pointed' || earStyle === 'long';
    const width = earLen * (earStyle === 'long' ? 0.42 : earStyle === 'round' ? 0.7 : earStyle === 'frill' ? 0.9 : 0.38);
    const geoEar = earStyle === 'round' ? paint(new SphereGeometry(1, 10, 8), REG_BODY) : petalGeometry(1, 1, pointed);
    disposables.push(geoEar);
    for (const side of [-1, 1]) {
      const eb = mesh.getObjectByName(side < 0 ? 'ear_l' : 'ear_r') as Bone | undefined;
      if (!eb) continue;
      if (earStyle === 'feathered') {
        const fg = unitFeather(REG_BODY);
        disposables.push(fg);
        for (let k = 0; k < 3; k++) {
          const fth = coatMesh(fg, placeholder, REG_BODY);
          fth.scale.set(earLen * 0.85, 1, earLen * 0.28);
          fth.position.set(0, 0, 0);
          fth.rotation.set(-0.4, side * (k - 1) * 0.35, side * 0.2);
          eb.add(fth);
        }
      } else if (earStyle === 'frill') {
        const fin = finGeometry(earLen * 1.4, earLen * 1.1);
        disposables.push(fin);
        const fr = coatMesh(fin, placeholder, REG_MANE);
        fr.rotation.y = Math.PI;
        eb.add(fr);
      } else {
        const em = coatMesh(geoEar, placeholder);
        if (earStyle === 'round') em.scale.set(width * 0.55, earLen * 0.55, width * 0.22);
        else em.scale.set(width, earLen, width * 0.35);
        eb.add(em);
      }
    }
  }

  if (hornLen > 0.005 && hornStyle !== 'none') {
    const radius = Math.max(0.01, hornLen * (hornStyle === 'crystal_branches' ? 0.12 : 0.14));
    if (hornStyle === 'crest') {
      const fin = finGeometry(hornLen * 1.3, hornLen);
      disposables.push(fin);
      const crest = mesh.getObjectByName('crest');
      crest?.add(coatMesh(fin, placeholder, REG_HORN));
    } else if (hornStyle === 'single_spike') {
      const cone = paint(new ConeGeometry(radius, hornLen, 6), REG_HORN);
      disposables.push(cone);
      const spike = coatMesh(cone, placeholder);
      spike.position.y = hornLen * 0.5;
      mesh.getObjectByName('crest')?.add(spike);
    } else if (hornStyle === 'crystal_branches') {
      const cone = paint(new ConeGeometry(1, 1, 5), REG_HORN);
      disposables.push(cone);
      for (const side of [-1, 1]) {
        const hb = mesh.getObjectByName(side < 0 ? 'horn_l' : 'horn_r');
        if (!hb) continue;
        for (let k = 0; k < 3; k++) {
          const c = coatMesh(cone, placeholder);
          c.scale.set(radius, hornLen * (1 - k * 0.22), radius);
          c.position.set(side * k * radius, hornLen * 0.3, k * radius);
          c.rotation.z = side * k * 0.25;
          hb.add(c);
        }
      }
    } else if (hornStyle === 'antlers') {
      const hornGeo = arcHornGeometry(hornLen, radius, 0.9);
      disposables.push(hornGeo);
      const tine = arcHornGeometry(hornLen * 0.45, radius * 0.6, 0.6);
      disposables.push(tine);
      for (const side of [-1, 1]) {
        const hb = mesh.getObjectByName(side < 0 ? 'horn_l' : 'horn_r');
        if (!hb) continue;
        hb.add(coatMesh(hornGeo, placeholder));
        const t = coatMesh(tine, placeholder);
        t.position.y = hornLen * 0.45;
        t.rotation.z = side * 0.8;
        hb.add(t);
      }
    } else {
      // curved (and any unexpected style that still has a length)
      const hornGeo = arcHornGeometry(hornLen, radius, hornStyle === 'curved' ? 1.15 : 0.7);
      disposables.push(hornGeo);
      for (const side of [-1, 1]) {
        const hb = mesh.getObjectByName(side < 0 ? 'horn_l' : 'horn_r');
        hb?.add(coatMesh(hornGeo, placeholder));
      }
    }
  }

  // Dorsal extras other than the skinned mantle.
  if (m.dorsal.style !== 'none' && m.dorsal.style !== 'moss_mantle' && m.dorsal.height > 0) {
    const h = m.dorsal.height * L;
    const n = Math.max(1, Math.min(20, m.dorsal.count || 6));
    if (m.dorsal.style === 'mane') {
      const card = petalGeometry(1, 0.35, true);
      disposables.push(card);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        for (const side of [-1, 1]) {
          const cardM = coatMesh(card, placeholder, REG_MANE);
          cardM.scale.set(h * 0.45, h * (1.1 - t * 0.35), h * 0.2);
          cardM.position.set(side * (rxFront * 0.18 + h * 0.05), h * 0.15, -torsoLen * m.dorsal.coverage * t);
          cardM.rotation.z = side * 0.55;
          cardM.rotation.x = 0.4;
          dorsal.add(cardM);
        }
      }
    } else {
      const cone = paint(new ConeGeometry(1, 1, m.dorsal.style === 'plates' ? 4 : 5), m.dorsal.style === 'crystal_ridge' ? REG_HORN : REG_DORSAL);
      disposables.push(cone);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        const piece = coatMesh(cone, placeholder);
        const ph = h * (m.dorsal.style === 'plates' ? 0.7 : 1);
        const pr = h * (m.dorsal.style === 'plates' ? 0.55 : 0.22);
        piece.scale.set(m.dorsal.style === 'frill' ? pr * 2.2 : pr, ph, m.dorsal.style === 'plates' ? pr * 0.35 : pr);
        piece.position.set(0, ph * 0.45, -torsoLen * cl(m.dorsal.coverage, 0, 1) * t);
        if (m.dorsal.style === 'frill') piece.scale.z = pr * 0.2;
        dorsal.add(piece);
      }
    }
  }

  // Tail extras.
  if (tailBones.length) {
    const last = tailBones[tailBones.length - 1];
    const tipR = Math.max(0.01, m.tail.tipRadius * L);
    if (m.tail.style === 'club') {
      const sph = paint(new SphereGeometry(1, 10, 8), REG_BODY);
      disposables.push(sph);
      const club = coatMesh(sph, placeholder);
      club.scale.setScalar(tipR * 1.7);
      club.position.set(0, 0, -tailLen / tailN * 0.35);
      last.add(club);
    } else if (m.tail.style === 'fan') {
      const fin = finGeometry(tipR * 6.5, tipR * 4.5);
      disposables.push(fin);
      const fan = coatMesh(fin, placeholder, REG_BODY);
      fan.rotation.set(-Math.PI / 2, 0, 0);
      last.add(fan);
    } else if (m.tail.style === 'plume') {
      // Volume comes from the loft. Extra quills were reading as dorsal spikes.
    }
  }

  // Feet.
  const addFeet = (spec: LegSpec, idName: string) => {
    const footB = mesh.getObjectByName(`leg_${idName}_foot`);
    if (!footB) return;
    const Lf = spec.foot * L;
    const r = Math.max(0.01, spec.radiusBottom * L);
    if (spec.footStyle === 'pad') {
      const pad = paint(new SphereGeometry(1, 10, 8), REG_BELLY);
      disposables.push(pad);
      const pm = coatMesh(pad, placeholder);
      pm.scale.set(r * 1.5, r * 0.45, r * 1.9);
      pm.position.set(0, -Lf, r * 0.25);
      footB.add(pm);
      for (let k = 0; k < 4; k++) {
        const toe = coatMesh(pad, placeholder);
        const ang = (k - 1.5) * 0.32;
        toe.scale.setScalar(r * 0.38);
        toe.position.set(Math.sin(ang) * r * 0.7, -Lf - r * 0.05, Math.cos(ang) * r * 0.55 + r * 0.3);
        footB.add(toe);
      }
    } else if (spec.footStyle === 'talon') {
      const cone = paint(new ConeGeometry(1, 1, 5), REG_HORN);
      disposables.push(cone);
      for (let k = 0; k < 3; k++) {
        const talon = coatMesh(cone, placeholder);
        talon.scale.set(r * 0.28, Lf * 0.85, r * 0.28);
        talon.position.set((k - 1) * r * 0.55, -Lf * 0.15, Lf * 0.15);
        talon.rotation.x = 1.15;
        footB.add(talon);
      }
    } else if (spec.footStyle === 'hoof') {
      const box = paint(new ConeGeometry(1, 1, 5), REG_HORN);
      disposables.push(box);
      const hoof = coatMesh(box, placeholder);
      hoof.scale.set(r * 1.15, Lf * 0.7, r * 1.45);
      hoof.position.set(0, -Lf * 0.55, Lf * 0.12);
      footB.add(hoof);
    } else {
      const disc = paint(new SphereGeometry(1, 10, 8), REG_HORN);
      disposables.push(disc);
      const base = coatMesh(disc, placeholder);
      base.scale.set(r * 1.35, r * 0.38, r * 1.45);
      base.position.set(0, -Lf, 0);
      footB.add(base);
    }
  };
  for (const leg of legTemplates) {
    const spec = leg.isFront && front ? front : hind;
    addFeet(spec, leg.id);
  }

  // Feathers / membranes.
  if (wings) {
    const feather = unitFeather(REG_WING);
    const primary = unitFeather(REG_PRIMARY);
    disposables.push(feather, primary);
    const chord = Math.max(0.05, wings.chord * L);
    const style = wings.style;
    const wide = style === 'membrane' ? 2.4 : style === 'leaf' ? 1.7 : 1;
    for (const side of [-1, 1]) {
      const tag = side > 0 ? 'r' : 'l';
      const upper = mesh.getObjectByName(`wing_${tag}_upper`) as Bone | undefined;
      const mid = mesh.getObjectByName(`wing_${tag}_mid`) as Bone | undefined;
      const hand = mesh.getObjectByName(`wing_${tag}_hand`) as Bone | undefined;
      if (!upper || !mid || !hand) continue;
      const hum = Number(upper.userData.seg) || chord;
      const midLen = Number(mid.userData.seg) || chord;
      const place = (parent: Bone, along: number, length: number, width: number, sweep: number, region: number) => {
        const fth = coatMesh(region === REG_PRIMARY ? primary : feather, placeholder);
        fth.scale.set(length, 1, width * wide);
        fth.position.set(side * along, 0, 0);
        fth.rotation.y = (side < 0 ? Math.PI : 0) + sweep;
        parent.add(fth);
      };
      const coverts = style === 'membrane' ? 3 : 4;
      for (let i = 0; i < coverts; i++) {
        const t = (i + 0.5) / coverts;
        place(upper, hum * t * 0.85, chord * (style === 'membrane' ? 0.85 : 0.55), chord * 0.34, 0.15, REG_WING);
      }
      const secondaries = style === 'membrane' ? 3 : 5;
      for (let i = 0; i < secondaries; i++) {
        const t = (i + 0.35) / secondaries;
        place(mid, midLen * t, chord * (style === 'feathered' ? 0.95 : 1.15), chord * 0.3, 0.42, REG_WING);
      }
      for (let i = 0; i < fingerCount; i++) {
        const fb = mesh.getObjectByName(`wing_${tag}_f${i}`);
        if (!fb) continue;
        const len = chord * (1.05 + (i / Math.max(1, fingerCount)) * 0.65);
        const width = Math.min(chord * 0.2, (chord * 0.85) / Math.max(3, fingerCount));
        place(fb as Bone, 0.02, len, width, 0.05, REG_PRIMARY);
      }
    }
  }

  mesh.updateMatrixWorld(true);
  geo.computeBoundingSphere();

  const shoulder = wp(chest).y;
  const hip = wp(pelvis).y;
  return {
    speciesId: species.id,
    family: species.family,
    mesh,
    hipHeight: hip,
    shoulderHeight: shoulder,
    torsoLength: torsoLen,
    bodyRx: rxMid,
    bodyRy: rxMid * depth,
    bodyLength: L,
    headReach,
    legs: legTemplates,
    tailCount: tailBones.length,
    hasWings: !!wings,
    fingerCount,
    eyeMat,
    boneNames: bones.map((b) => b.name),
    disposables,
  };
}

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
