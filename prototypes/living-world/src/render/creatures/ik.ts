/**
 * Analytic two-bone IK and bone aiming shared by the bind pose and the runtime.
 * Local limb axis is -Y (child sits at (0, -length, 0)); local "front" is +Z.
 */
import { Bone, Quaternion, Vector3 } from 'three';

const _dir = new Vector3();
const _nd = new Vector3();
const _toPole = new Vector3();
const _axis = new Vector3();
const _bend = new Vector3();
const _align = new Quaternion();
const _twist = new Quaternion();
const _worldQ = new Quaternion();
const _parentQ = new Quaternion();
const _origin = new Vector3();
const _upNow = new Vector3();
const _poleDir = new Vector3();
const _twF = new Vector3();
const _twT = new Vector3();
const _twC = new Vector3();

export const AXIS_DOWN = new Vector3(0, -1, 0);
export const AXIS_UP = new Vector3(0, 1, 0);
export const AXIS_FWD = new Vector3(0, 0, 1);

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * Math.max(0, dt)));
}

/** Knee position for a two-bone chain. `target` is the ankle. Lengths are world metres. */
export function solveTwoBone(hip: Vector3, target: Vector3, pole: Vector3, l1: number, l2: number, outKnee: Vector3): Vector3 {
  _dir.subVectors(target, hip);
  const raw = _dir.length();
  const max = Math.max(1e-4, l1 + l2 - 1e-4);
  const min = Math.abs(l1 - l2) + 1e-4;
  const dist = Math.min(max, Math.max(min, raw));
  if (raw > 1e-6) _dir.multiplyScalar(dist / raw);
  else _dir.set(0, -dist, 0);
  const reach = Math.max(1e-6, _dir.length());
  const cosHip = clamp((reach * reach + l1 * l1 - l2 * l2) / (2 * reach * l1), -1, 1);
  const hipBend = Math.acos(cosHip);
  _nd.copy(_dir).multiplyScalar(1 / reach);
  _toPole.subVectors(pole, hip);
  _axis.crossVectors(_nd, _toPole);
  if (_axis.lengthSq() < 1e-10) {
    _axis.set(1, 0, 0);
    if (Math.abs(_nd.x) > 0.85) _axis.set(0, 0, 1);
  }
  _axis.normalize();
  _bend.crossVectors(_axis, _nd);
  if (_bend.dot(_toPole) < 0) _bend.negate();
  _bend.normalize();
  return outKnee.copy(hip).addScaledVector(_nd, Math.cos(hipBend) * l1).addScaledVector(_bend, Math.sin(hipBend) * l1);
}

function twistAround(axis: Vector3, from: Vector3, to: Vector3, out: Quaternion): Quaternion {
  _twF.copy(from).addScaledVector(axis, -from.dot(axis));
  _twT.copy(to).addScaledVector(axis, -to.dot(axis));
  if (_twF.lengthSq() < 1e-10 || _twT.lengthSq() < 1e-10) return out.identity();
  _twF.normalize();
  _twT.normalize();
  const dot = clamp(_twF.dot(_twT), -1, 1);
  _twC.crossVectors(_twF, _twT);
  const sign = Math.sign(_twC.dot(axis)) || 1;
  return out.setFromAxisAngle(axis, sign * Math.acos(dot));
}

/**
 * Aim `localAxis` at `worldTarget`. Twist so `localUp` points toward `worldPole`
 * as well as the hinge allows. Result is the bone's local quaternion.
 */
export function aimBone(bone: Bone, worldTarget: Vector3, worldPole: Vector3, localAxis: Vector3 = AXIS_DOWN, localUp: Vector3 = AXIS_FWD): void {
  const parent = bone.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  bone.getWorldPosition(_origin);
  _dir.subVectors(worldTarget, _origin);
  if (_dir.lengthSq() < 1e-10) return;
  _dir.normalize();
  _align.setFromUnitVectors(localAxis, _dir);
  _upNow.copy(localUp).applyQuaternion(_align);
  _poleDir.subVectors(worldPole, _origin);
  twistAround(_dir, _upNow, _poleDir, _twist);
  _worldQ.copy(_twist).multiply(_align);
  parent.getWorldQuaternion(_parentQ);
  bone.quaternion.copy(_parentQ.invert()).multiply(_worldQ);
}

/** World-space pole in front of (or behind) the hip, with a slight outward bias. */
export function limbPole(hip: Vector3, forward: Vector3, side: Vector3, length: number, forwardSign: number, out: Vector3): Vector3 {
  return out
    .copy(hip)
    .addScaledVector(forward, forwardSign * length)
    .addScaledVector(side, length * 0.18)
    .addScaledVector(AXIS_UP, length * 0.15);
}
