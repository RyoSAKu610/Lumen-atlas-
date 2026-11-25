import type { ArtDirection, NarrationPack, RegionLayout } from '../data/schema';
import { hashString } from '../sim/rng';
import type { AgentId, AgentState, SimEvent } from '../sim/types';

export interface NarrationSources {
  narration: NarrationPack;
  art: ArtDirection;
  region: RegionLayout;
  agent: (id: AgentId) => Pick<AgentState, 'id' | 'speciesId'> | undefined;
}

/** Stable observer nickname. The same id always receives the same name. */
export function nicknameFor(pack: NarrationPack, speciesId: string, agentId: AgentId): string {
  const pool = pack.nicknames[speciesId];
  if (!pool || pool.length === 0) return `#${agentId}`;
  return pool[Math.abs(agentId) % pool.length] ?? `#${agentId}`;
}

export function speciesName(art: ArtDirection, speciesId: string): string {
  return art.creatures[speciesId]?.displayName.ja ?? speciesId;
}

export function placeName(region: RegionLayout, placeId: string | null): string {
  if (!placeId) return '谷';
  const landmark = region.landmarks.find((l) => l.id === placeId);
  if (landmark) return landmark.name.ja;
  const pool = region.pools.find((p) => p.id === placeId);
  if (pool) return pool.name.ja;
  const zone = region.zones.find((z) => z.id === placeId);
  if (zone) return zone.id;
  return placeId;
}

/** Clock label from a 0..24 hour. */
export function formatClock(timeOfDay: number): string {
  const wrapped = ((timeOfDay % 24) + 24) % 24;
  const h = Math.floor(wrapped);
  const m = Math.floor((wrapped - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function asText(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

/** Most specific template wins: type:kind:outcome, then type:kind, then type. */
export function templateKey(pack: NarrationPack, event: SimEvent): string {
  const kind = asText(event.data.kind);
  const outcome = asText(event.data.outcome);
  const keys = [
    kind && outcome ? `${event.type}:${kind}:${outcome}` : '',
    kind ? `${event.type}:${kind}` : '',
    event.type,
  ];
  return keys.find((key) => key && pack.templates[key]) ?? event.type;
}

function variant(pack: NarrationPack, key: string, event: SimEvent): string {
  const lines = pack.templates[key];
  if (!lines || lines.length === 0) return event.type;
  const index = hashString(`${key}:${event.seq}`) % lines.length;
  return lines[index] ?? lines[0]!;
}

function individual(sources: NarrationSources, id: AgentId | undefined, fallback: string): { full: string; name: string; species: string } {
  if (id === undefined) return { full: fallback, name: fallback, species: '' };
  const agent = sources.agent(id);
  if (!agent) return { full: fallback, name: fallback, species: '' };
  const name = nicknameFor(sources.narration, agent.speciesId, agent.id);
  const species = speciesName(sources.art, agent.speciesId);
  return { full: `${name}（${species}）`, name, species };
}

/** Documentary sentence for one journal event. Variant choice is a pure function of the event. */
export function narrateEvent(sources: NarrationSources, event: SimEvent): string {
  const key = templateKey(sources.narration, event);
  const labels = sources.narration.labels;
  const actor = individual(sources, event.actors[0], '誰か');
  const target = individual(sources, event.actors[1], '相手');
  const kind = asText(event.data.kind);
  const outcome = asText(event.data.outcome);
  const cause = asText(event.data.cause);
  const values: Record<string, string> = {
    actor: actor.full,
    target: target.full,
    actorName: actor.name,
    targetName: target.name,
    actorSpecies: actor.species,
    targetSpecies: target.species,
    place: placeName(sources.region, event.place),
    count: asText(event.data.count) || '0',
    season: labels.seasons[event.data.season as keyof typeof labels.seasons] ?? asText(event.data.season),
    weather: labels.weathers[event.data.weather as keyof typeof labels.weathers] ?? asText(event.data.weather),
    time: formatClock(event.timeOfDay),
    cause: labels.causesOfDeath[cause as keyof typeof labels.causesOfDeath] ?? cause,
    temperature: asText(event.data.temperature),
    kind: labels.interactionKinds[kind as keyof typeof labels.interactionKinds] ?? kind,
    outcome: labels.outcomes[outcome as keyof typeof labels.outcomes] ?? outcome,
    day: String(event.day),
  };
  return variant(sources.narration, key, event).replace(/\{([a-zA-Z]+)\}/g, (token, name: string) => values[name] ?? token);
}
