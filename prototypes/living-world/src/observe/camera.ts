import * as THREE from 'three';
import type { ShotGrammar } from '../data/schema';
import { hashString } from '../sim/rng';
import type { AgentId, AgentState, SimEvent } from '../sim/types';

type Shot = ShotGrammar['shots'][number];

export interface CameraAgent {
  id: AgentId;
  speciesId: string;
  alive: boolean;
  behavior: AgentState['behavior'];
  groupId: number | null;
  pos: { x: number; y: number; z: number };
  heading: number;
  /** Body length and shoulder height in metres, already scaled for growth. */
  length: number;
  shoulder: number;
}

export interface CameraWorld {
  agents: readonly CameraAgent[];
  terrainHeight(x: number, z: number): number;
  place(id: string): { x: number; y: number; z: number } | null;
  /** Emotional centre of the valley, used when a landmark shot has no event place. */
  heart(): { x: number; y: number; z: number };
}

const OVERRIDE = new Set(['alarm.raised', 'hunt.chase_started', 'hunt.succeeded', 'agent.died', 'interaction.interrupted']);
const CONTACT = new Set(['interaction.started', 'interaction.contact']);
const DEG = Math.PI / 180;
const LANDMARK_LENGTH = 6;
const LANDMARK_SHOULDER = 2.2;

/**
 * Documentary camera. It chooses a shot from the grammar and eases the
 * perspective camera into place. It never writes simulation state.
 */
export class DocumentaryCamera {
  private shot: Shot | null = null;
  private shotTime = 0;
  private duration = 12;
  private subjectId: AgentId | null = null;
  private holdContact = false;
  private recentIdle: string[] = [];
  private idleCursor = 0;
  private manualUntil = 0;
  private followId: AgentId | null = null;
  private placeId: string | null = null;
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private primed = false;
  readonly shotName = { ja: '', en: '' };

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly grammar: ShotGrammar,
  ) {}

  /** Pin the view to one individual. Pass null to return to the grammar. */
  follow(id: AgentId | null): void {
    this.followId = id;
    this.manualUntil = 0;
    if (id !== null) {
      const quiet = this.grammar.shots.find((s) => s.id === 'quiet_field_observation') ?? this.grammar.shots[0];
      if (quiet) this.begin(quiet, id, 1);
    }
  }

  /** Observer grabbed the camera. Automatic cuts wait `seconds` of real time. */
  suppress(seconds: number): void {
    this.manualUntil = Math.max(this.manualUntil, seconds);
  }

  consider(event: SimEvent): void {
    if (this.manualUntil > 0 && !OVERRIDE.has(event.type)) return;
    if (this.followId !== null && !OVERRIDE.has(event.type)) return;
    if (this.holdContact && !OVERRIDE.has(event.type) && !event.type.startsWith('interaction.resolved')) return;
    if (OVERRIDE.has(event.type) || event.type === 'interaction.resolved' || event.type === 'interaction.interrupted') {
      this.holdContact = false;
    }
    if (event.place) this.placeId = event.place;
    const shot = this.bestShot(event);
    if (!shot) return;
    const forced = OVERRIDE.has(event.type);
    if (!forced && this.shot && shot.priority < this.shot.priority && this.shotTime < this.duration) return;
    const subject = event.actors[0] ?? null;
    this.begin(shot, subject, event.seq);
    if (CONTACT.has(event.type)) this.holdContact = true;
  }

  update(dt: number, world: CameraWorld): void {
    if (this.manualUntil > 0) {
      this.manualUntil = Math.max(0, this.manualUntil - dt);
      return;
    }
    if (!this.shot) this.beginIdle(world);
    this.shotTime += dt;
    if (this.shot && this.shotTime >= this.duration && !this.holdContact) this.beginIdle(world);
    const shot = this.shot;
    if (!shot) return;
    const frame = this.compose(shot, world);
    if (!frame) return;
    const lift = world.terrainHeight(this.desiredPos.x, this.desiredPos.z) + 0.45;
    if (this.desiredPos.y < lift) this.desiredPos.y = lift;
    const k = 1 - Math.exp(-dt * (this.shotTime < 0.8 ? 2.4 : 1.3));
    if (!this.primed) {
      this.camera.position.copy(this.desiredPos);
      this.look.copy(this.desiredLook);
      this.primed = true;
    } else {
      this.camera.position.lerp(this.desiredPos, k);
      this.look.lerp(this.desiredLook, k);
    }
    this.camera.fov += (shot.fovDeg - this.camera.fov) * k;
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }

  private begin(shot: Shot, subject: AgentId | null, salt: number): void {
    this.shot = shot;
    this.subjectId = subject;
    this.shotTime = 0;
    const span = shot.durationSec[1] - shot.durationSec[0];
    const u = (hashString(`${shot.id}:${salt}`) % 1000) / 1000;
    this.duration = shot.durationSec[0] + u * span;
    if (shot.triggers.includes('idle')) this.duration = Math.max(8, this.duration);
    this.shotName.ja = shot.name.ja;
    this.shotName.en = shot.name.en;
    if (shot.triggers.includes('idle')) {
      this.recentIdle.push(shot.id);
      if (this.recentIdle.length > 3) this.recentIdle.shift();
    }
  }

  private beginIdle(world: CameraWorld): void {
    if (this.followId !== null) {
      const quiet = this.grammar.shots.find((s) => s.id === 'quiet_field_observation') ?? this.grammar.shots[0];
      if (quiet) this.begin(quiet, this.followId, this.idleCursor + 1);
      return;
    }
    const active = this.notable(world);
    if (active) {
      this.begin(active.shot, active.agent.id, this.idleCursor + 1);
      return;
    }
    const rotation = this.grammar.idleRotation;
    for (let i = 0; i < rotation.length; i++) {
      const id = rotation[(this.idleCursor + i) % rotation.length];
      if (!id || this.recentIdle.includes(id)) continue;
      const shot = this.grammar.shots.find((s) => s.id === id);
      if (!shot) continue;
      this.idleCursor = (this.idleCursor + i + 1) % rotation.length;
      this.begin(shot, null, this.idleCursor);
      return;
    }
    const fallback = this.grammar.shots.find((s) => s.triggers.includes('idle')) ?? this.grammar.shots[0];
    if (fallback) this.begin(fallback, null, this.idleCursor);
  }

  private notable(world: CameraWorld): { shot: Shot; agent: CameraAgent } | null {
    let best: { shot: Shot; agent: CameraAgent } | null = null;
    for (const agent of world.agents) {
      if (!agent.alive) continue;
      for (const shot of this.grammar.shots) {
        if (!shot.triggers.includes(`behavior:${agent.behavior}`)) continue;
        if (shot.priority < 0.55) continue;
        if (!best || shot.priority > best.shot.priority) best = { shot, agent };
      }
    }
    return best;
  }

  private bestShot(event: SimEvent): Shot | null {
    let best: Shot | null = null;
    for (const shot of this.grammar.shots) {
      if (!shot.triggers.some((trigger) => triggerMatches(trigger, event))) continue;
      if (!best || shot.priority > best.priority) best = shot;
    }
    return best;
  }

  private compose(shot: Shot, world: CameraWorld): { position: THREE.Vector3; look: THREE.Vector3 } | null {
    const subject = this.resolveSubject(shot, world);
    if (!subject) return null;
    const az = subject.heading + (shot.azimuthDeg + shot.orbitDegPerSec * this.shotTime) * DEG;
    const dist = Math.max(1.2, shot.distance * subject.length);
    this.desiredPos.set(subject.x + Math.sin(az) * dist, subject.y + shot.height * subject.shoulder, subject.z + Math.cos(az) * dist);
    this.desiredLook.set(subject.x, subject.y + subject.shoulder * 0.72, subject.z);
    return { position: this.desiredPos, look: this.desiredLook };
  }

  private resolveSubject(shot: Shot, world: CameraWorld): { x: number; y: number; z: number; heading: number; length: number; shoulder: number } | null {
    const focus = this.followId !== null ? world.agents.find((a) => a.id === this.followId && a.alive) : undefined;
    const pinned = focus ?? (this.subjectId !== null ? world.agents.find((a) => a.id === this.subjectId && a.alive) : undefined);
    if (shot.subject === 'landmark') {
      const place = (this.placeId ? world.place(this.placeId) : null) ?? world.heart();
      return { ...place, heading: 0.4, length: LANDMARK_LENGTH, shoulder: LANDMARK_SHOULDER };
    }
    if (shot.subject === 'event_position' || shot.subject === 'actor') {
      if (!pinned) return this.fallbackAgent(world);
      return pinnedBody(pinned);
    }
    if (shot.subject === 'pair_midpoint' || shot.subject === 'group_centroid') {
      const group = this.groupOf(pinned, world);
      if (group.length === 0) return pinned ? pinnedBody(pinned) : this.fallbackAgent(world);
      const x = group.reduce((s, a) => s + a.pos.x, 0) / group.length;
      const y = group.reduce((s, a) => s + a.pos.y, 0) / group.length;
      const z = group.reduce((s, a) => s + a.pos.z, 0) / group.length;
      const lead = pinned ?? group[0]!;
      return { x, y, z, heading: lead.heading, length: lead.length, shoulder: lead.shoulder };
    }
    return pinned ? pinnedBody(pinned) : this.fallbackAgent(world);
  }

  private groupOf(pinned: CameraAgent | undefined, world: CameraWorld): CameraAgent[] {
    if (!pinned) return world.agents.filter((a) => a.alive).slice(0, 6);
    return world.agents.filter((a) => a.alive && (a.groupId !== null ? a.groupId === pinned.groupId : a.speciesId === pinned.speciesId));
  }

  private fallbackAgent(world: CameraWorld): { x: number; y: number; z: number; heading: number; length: number; shoulder: number } | null {
    const agent = world.agents.find((a) => a.alive);
    if (!agent) {
      const heart = world.heart();
      return { ...heart, heading: 0.4, length: LANDMARK_LENGTH, shoulder: LANDMARK_SHOULDER };
    }
    return pinnedBody(agent);
  }
}

function pinnedBody(agent: CameraAgent): { x: number; y: number; z: number; heading: number; length: number; shoulder: number } {
  return { x: agent.pos.x, y: agent.pos.y, z: agent.pos.z, heading: agent.heading, length: agent.length, shoulder: agent.shoulder };
}

function triggerMatches(trigger: string, event: SimEvent): boolean {
  if (trigger === 'idle' || trigger.startsWith('behavior:')) return false;
  if (trigger === event.type) return true;
  if (!trigger.startsWith(`${event.type}:`)) return false;
  const [kind, outcome] = trigger.slice(event.type.length + 1).split(':');
  if (kind && event.data.kind !== kind) return false;
  if (outcome && event.data.outcome !== outcome) return false;
  return true;
}
