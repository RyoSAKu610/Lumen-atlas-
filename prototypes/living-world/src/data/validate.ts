import type { z } from 'zod';
import {
  ArtDirectionSchema,
  NarrationPackSchema,
  RegionLayoutSchema,
  ShotGrammarSchema,
  SpeciesProfileSchema,
  type GameData,
} from './schema';
import { BEHAVIOR_IDS, EVENT_TYPES } from '../sim/ids';

export interface DataDiagnostic {
  severity: 'error' | 'warning';
  file: string;
  path: string;
  message: string;
}

export interface RawGameData {
  region: unknown;
  species: Record<string, unknown>;
  art: unknown;
  narration: unknown;
  shots: unknown;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, file: string, out: DataDiagnostic[]): T | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    out.push({ severity: 'error', file, path: issue.path.join('.') || '(root)', message: issue.message });
  }
  return null;
}

/** Schema + cross-reference validation. Returns data only when there are no errors. */
export function validateGameData(raw: RawGameData): { data: GameData | null; diagnostics: DataDiagnostic[] } {
  const d: DataDiagnostic[] = [];
  const region = parse(RegionLayoutSchema, raw.region, 'data/region', d);
  const species = Object.entries(raw.species)
    .map(([file, value]) => parse(SpeciesProfileSchema, value, `data/species/${file}`, d))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const art = parse(ArtDirectionSchema, raw.art, 'data/art/art-direction.json', d);
  const narration = parse(NarrationPackSchema, raw.narration, 'data/narration/ja.json', d);
  const shots = parse(ShotGrammarSchema, raw.shots, 'data/art/camera-shots.json', d);

  const err = (file: string, path: string, message: string) => d.push({ severity: 'error', file, path, message });
  const warn = (file: string, path: string, message: string) => d.push({ severity: 'warning', file, path, message });
  const speciesIds = new Set(species.map((s) => s.id));

  for (const s of species) {
    const f = `data/species/${s.id}.json`;
    for (const prey of s.predation?.prey ?? []) if (!speciesIds.has(prey)) err(f, 'predation.prey', `unknown prey species "${prey}"`);
    if (s.family === 'winged_flyer' && !s.locomotion.flight) err(f, 'locomotion.flight', 'winged_flyer requires flight parameters');
    if (s.family !== 'winged_flyer' && s.locomotion.flight) err(f, 'locomotion.flight', 'only winged_flyer may fly');
    if (s.thermal.comfortMinC >= s.thermal.comfortMaxC) err(f, 'thermal', 'comfortMinC must be < comfortMaxC');
    if (s.lifeCycle.litterSize[0] > s.lifeCycle.litterSize[1]) err(f, 'lifeCycle.litterSize', 'min > max');
    if (!(s.lifeCycle.maturityDays < s.lifeCycle.elderDays && s.lifeCycle.elderDays < s.lifeCycle.maxAgeDays))
      err(f, 'lifeCycle', 'expected maturityDays < elderDays < maxAgeDays');
    const sp = s.locomotion;
    if (!(sp.walkSpeed <= sp.trotSpeed && sp.trotSpeed <= sp.runSpeed && sp.runSpeed <= sp.sprintSpeed))
      err(f, 'locomotion', 'expected walk <= trot <= run <= sprint');
  }

  if (region) {
    const f = 'data/region';
    const lim = region.size / 2;
    const ids = new Set<string>();
    const place = (id: string, c: readonly [number, number], path: string) => {
      if (ids.has(id)) err(f, path, `duplicate id "${id}"`);
      ids.add(id);
      if (Math.abs(c[0]) > lim - 4 || Math.abs(c[1]) > lim - 4) err(f, path, `"${id}" lies outside the region bounds`);
    };
    region.landmarks.forEach((l, i) => place(l.id, l.center, `landmarks.${i}`));
    region.pools.forEach((p, i) => place(p.id, p.center, `pools.${i}`));
    region.zones.forEach((z, i) => place(z.id, z.center, `zones.${i}`));
    region.spawns.forEach((s, i) => {
      if (!speciesIds.has(s.speciesId)) err(f, `spawns.${i}.speciesId`, `unknown species "${s.speciesId}"`);
      if (!ids.has(s.near)) err(f, `spawns.${i}.near`, `unknown landmark/zone/pool "${s.near}"`);
    });
    if (!region.pools.some((p) => p.kind === 'hot_spring')) err(f, 'pools', 'the slice requires at least one hot spring');
    const total = region.spawns.reduce((a, s) => a + s.count, 0);
    if (total < 12 || total > 60) warn(f, 'spawns', `founding population ${total} is outside the 12..60 vertical-slice range`);
  }

  if (art) {
    const f = 'data/art/art-direction.json';
    for (const id of speciesIds) {
      const look = art.creatures[id];
      if (!look) {
        err(f, `creatures.${id}`, 'missing creature look');
        continue;
      }
      if (look.speciesId !== id) err(f, `creatures.${id}.speciesId`, 'must equal its key');
      const prof = species.find((s) => s.id === id)!;
      const m = look.morphology;
      if (prof.family === 'winged_flyer') {
        if (!m.wings) err(f, `creatures.${id}.morphology.wings`, 'winged_flyer requires wings');
        if (m.legs.pairs !== 1) err(f, `creatures.${id}.morphology.legs.pairs`, 'winged_flyer stands on 1 leg pair');
      } else {
        if (m.legs.pairs !== 2 || !m.legs.front) err(f, `creatures.${id}.morphology.legs`, 'quadrupeds need pairs=2 and front legs');
        if (m.wings) err(f, `creatures.${id}.morphology.wings`, 'only winged_flyer has wings');
      }
    }
    const hours = art.lighting.map((k) => k.hour);
    for (let i = 1; i < hours.length; i++) if (hours[i] <= hours[i - 1]) err(f, 'lighting', 'keys must be sorted by strictly increasing hour');
  }

  if (narration) {
    const f = 'data/narration/ja.json';
    for (const id of speciesIds) if (!narration.nicknames[id]) err(f, `nicknames.${id}`, 'missing nickname pool');
    const known = new Set<string>(EVENT_TYPES);
    for (const key of Object.keys(narration.templates)) {
      if (!known.has(key.split(':')[0])) warn(f, `templates.${key}`, 'unknown event type prefix');
    }
    for (const t of EVENT_TYPES) {
      if (!Object.keys(narration.templates).some((k) => k === t || k.startsWith(`${t}:`))) warn(f, 'templates', `no template for "${t}"`);
    }
  }

  if (shots) {
    const f = 'data/art/camera-shots.json';
    const shotIds = new Set(shots.shots.map((s) => s.id));
    for (const id of shots.idleRotation) if (!shotIds.has(id)) err(f, 'idleRotation', `unknown shot "${id}"`);
    const behaviorSet = new Set<string>(BEHAVIOR_IDS);
    const eventSet = new Set<string>(EVENT_TYPES);
    shots.shots.forEach((s, i) => {
      for (const t of s.triggers) {
        if (t === 'idle') continue;
        if (t.startsWith('behavior:')) {
          if (!behaviorSet.has(t.slice(9))) warn(f, `shots.${i}.triggers`, `unknown behaviour "${t}"`);
        } else if (!eventSet.has(t.split(':')[0])) warn(f, `shots.${i}.triggers`, `unknown event "${t}"`);
      }
    });
  }

  const ok = !d.some((x) => x.severity === 'error') && region && art && narration && shots;
  return { data: ok ? { region: region!, species, art: art!, narration: narration!, shots: shots! } : null, diagnostics: d };
}
