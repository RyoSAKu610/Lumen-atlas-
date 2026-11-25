import { hashString } from './rng';
import type { EventType } from './ids';
import type { SimState } from './internal';
import type { AgentId, SimEvent } from './types';

const IMPORTANCE: Partial<Record<EventType, number>> = {
  'system.world_created': 1,
  'system.restored': 0.6,
  'system.catchup': 0.7,
  'world.dawn': 0.45,
  'world.dusk': 0.45,
  'world.day_started': 0.35,
  'world.season_changed': 0.7,
  'world.weather_changed': 0.4,
  'world.override': 0.55,
  'agent.born': 0.75,
  'agent.matured': 0.4,
  'agent.elder': 0.45,
  'agent.died': 0.9,
  'interaction.started': 0.4,
  'interaction.contact': 0.5,
  'interaction.resolved': 0.6,
  'interaction.interrupted': 0.7,
  'hunt.stalk_started': 0.55,
  'hunt.chase_started': 0.7,
  'hunt.succeeded': 0.95,
  'hunt.failed': 0.5,
  'hunt.aborted': 0.75,
  'alarm.raised': 0.65,
  'herd.defense': 0.8,
  'hotspring.entered': 0.6,
  'hotspring.displaced': 0.55,
  'courtship.bonded': 0.85,
  'home.returned': 0.4,
  'flight.soaring': 0.35,
  'carcass.scavenged': 0.45,
};

/** Nearest landmark or pool id, or null when nothing is close. */
export function nearestPlace(state: SimState, x: number, z: number): string | null {
  let best: string | null = null;
  let bestScore = 42;
  for (const p of state.places) {
    const d = Math.hypot(p.x - x, p.z - z) - p.radius * 0.45;
    if (d < bestScore) {
      bestScore = d;
      best = p.id;
    }
  }
  return best;
}

export function emit(
  state: SimState,
  type: EventType,
  actors: readonly AgentId[],
  pos: { x: number; z: number } | null,
  data: Record<string, string | number | boolean | null>,
  importance?: number,
): SimEvent {
  const event: SimEvent = {
    seq: state.nextEventSeq++,
    time: state.env.time,
    day: state.env.day,
    timeOfDay: state.env.timeOfDay,
    type,
    actors,
    pos: pos ? { x: pos.x, z: pos.z } : null,
    place: pos ? nearestPlace(state, pos.x, pos.z) : state.anchor ? nearestPlace(state, state.anchor.x, state.anchor.z) : null,
    data,
    importance: importance ?? IMPORTANCE[type] ?? 0.3,
    approximate: state.approximate,
  };
  state.events.push(event);
  if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000);
  for (const listener of state.listeners) listener(event);
  return event;
}

/** Stable JSON used for the snapshot checksum. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function checksumOf(body: unknown): number {
  return hashString(stableStringify(body));
}
