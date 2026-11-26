/**
 * Offline journal run.
 *   npm run simulate -- --days 3 --seed 7 [--json preview/journal.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadGameDataOrThrow } from '../src/data/load';
import { Simulation } from '../src/sim/Simulation';
import { generateDrinkSpots, nearestAccessibleDrinkSpot } from '../src/sim/spatial';
import { deathsByCause, mortalityBySpeciesAndCause } from '../src/sim/death-ledger';
import { findDrinkRoute } from '../src/sim/water-navigation';
import type { SimEvent } from '../src/sim/types';

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

const days = Number(flag('--days') ?? 3);
const seed = Number(flag('--seed') ?? 7);
const jsonPath = flag('--json');
if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number');
if (!Number.isFinite(seed)) throw new Error('--seed must be a number');

const data = loadGameDataOrThrow();
const sim = Simulation.create({ region: data.region, species: data.species }, { seed });
const counts = new Map<string, number>();
for (const event of sim.recentEvents(20)) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
sim.onEvent((event) => counts.set(event.type, (counts.get(event.type) ?? 0) + 1));

const stepsPerDay = Math.round(86400 / sim.config.clockScale / sim.config.fixedDt);
const t0 = performance.now();
for (let day = 0; day < days; day++) {
  for (let i = 0; i < stepsPerDay; i++) sim.step();
  const alive = sim.agents.filter((a) => a.alive).length;
  console.log(
    `day ${day + 1}  t=${sim.env.timeOfDay.toFixed(2)}h  ${sim.env.season}  ${sim.env.weather}  ${sim.env.temperatureC.toFixed(1)}°C  alive ${alive}`,
  );
}
const elapsed = (performance.now() - t0) / 1000;
const totalSteps = stepsPerDay * days;
console.log(`\n${totalSteps} steps in ${elapsed.toFixed(2)}s (${((elapsed * 1000) / totalSteps).toFixed(3)} ms/step)`);

const population = new Map<string, { alive: number; dead: number }>();
for (const agent of sim.agents) {
  const row = population.get(agent.speciesId) ?? { alive: 0, dead: 0 };
  if (agent.alive) row.alive += 1;
  else row.dead += 1;
  population.set(agent.speciesId, row);
}
console.log('\npopulation');
for (const [id, row] of population) console.log(`  ${id}: ${row.alive} alive, ${row.dead} dead`);

const journal = sim.recentEvents(2000);

const mortality = new Map<string, number>();
for (const event of journal) {
  if (event.type !== 'agent.died') continue;
  const key = `${String(event.data.species ?? 'unknown')} / ${String(event.data.stage ?? 'unknown')} / ${String(event.data.cause ?? 'unknown')}`;
  mortality.set(key, (mortality.get(key) ?? 0) + 1);
}
console.log('\nmortality by species / life stage / cause (event ledger)');
for (const [key, n] of [...mortality.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`  ${n.toString().padStart(3)}  ${key}`);
}
console.log(`  births recorded: ${journal.filter((event) => event.type === 'agent.born').length}`);

if (args.includes('--diagnose-water')) {
  console.log('\nwater access diagnostics (all species)');
  const drinkSpots = generateDrinkSpots(sim.terrain);
  console.log(`drink candidates: ${drinkSpots.length}; river samples: ${sim.terrain.riverSamples.length}`);
  const profiles = new Map(data.species.map((profile) => [profile.id, profile]));
  const dehydrationEvents = deathsByCause(journal, 'dehydration');
  for (const event of dehydrationEvents) {
    const id = event.actors[0] ?? -1;
    const species = String(event.data.species ?? 'unknown');
    const profile = profiles.get(species);
    const pos = event.pos;
    if (!pos || !profile) continue;
    const nearest = nearestAccessibleDrinkSpot(sim.terrain, drinkSpots, pos.x, pos.z, profile.locomotion.maxSlopeDeg);
    const route = profile.locomotion.flight || !nearest
      ? null
      : findDrinkRoute(sim.terrain, drinkSpots, pos, profile.locomotion.maxSlopeDeg, profile.body.radius);
    const nearestDistance = nearest ? Math.hypot(nearest.x - pos.x, nearest.z - pos.z) : null;
    const water = event.data.waterX == null || event.data.waterZ == null
      ? null
      : { x: Number(event.data.waterX), z: Number(event.data.waterZ) };
    const rememberedDistance = water ? Math.hypot(water.x - pos.x, water.z - pos.z) : null;
    const slopeDeg = sim.terrain.slopeAt(pos.x, pos.z) * (180 / Math.PI);
    console.log(
      `  DEATH #${id} ${species} at=(${pos.x.toFixed(1)},${pos.z.toFixed(1)}) slope=${slopeDeg.toFixed(1)}° thirst=${Number(event.data.thirst ?? 0).toFixed(3)} behavior=${String(event.data.behavior ?? '—')} decision=${String(event.data.decision ?? '—')} water=${water ? `(${water.x.toFixed(1)},${water.z.toFixed(1)})/${rememberedDistance?.toFixed(1)}m` : 'none'} nearest=${nearestDistance?.toFixed(1) ?? '—'}m route=${route ? `${route.distance.toFixed(1)}m/${route.waypoints.length}wp` : 'unreachable'} home=${String(event.data.homeId ?? 'none')} threat=(${String(event.data.threatX ?? '—')},${String(event.data.threatZ ?? '—')})`,
    );
  }
  const watch = sim.agents
    .filter((agent) => (!agent.alive && agent.causeOfDeath === 'dehydration') || (agent.alive && agent.needs.thirst > 0.65))
    .sort((a, b) => a.speciesId.localeCompare(b.speciesId) || a.id - b.id);
  for (const agent of watch) {
    const profile = profiles.get(agent.speciesId);
    const water = agent.memory.water;
    const target = agent.intent.target;
    const home = agent.homeId ? sim.terrain.getLandmark(agent.homeId) : undefined;
    const homeDistance = home ? Math.hypot(agent.pos.x - home.x, agent.pos.z - home.z) : null;
    const waterDistance = water ? Math.hypot(agent.pos.x - water.x, agent.pos.z - water.z) : null;
    const targetDistance = target ? Math.hypot(agent.pos.x - target.x, agent.pos.z - target.z) : null;
    const waterWalkable = water && profile
      ? sim.terrain.inBounds(water.x, water.z, 14) && sim.terrain.isWalkable(water.x, water.z, profile.locomotion.maxSlopeDeg, 0.35)
      : null;
    const nearest = profile
      ? nearestAccessibleDrinkSpot(sim.terrain, drinkSpots, agent.pos.x, agent.pos.z, profile.locomotion.maxSlopeDeg)
      : null;
    const nearestDistance = nearest ? Math.hypot(agent.pos.x - nearest.x, agent.pos.z - nearest.z) : null;
    const top = agent.decision?.options.slice(0, 3).map((option) => `${option.behavior}:${option.score.toFixed(2)}`).join(',') ?? '—';
    console.log(
      `  ${agent.speciesId} #${agent.id} ${agent.alive ? 'alive' : agent.causeOfDeath ?? 'dead'} stage=${agent.lifeStage} thirst=${agent.needs.thirst.toFixed(3)} fear=${agent.needs.fear.toFixed(3)} hunger=${agent.needs.hunger.toFixed(3)} fatigue=${agent.needs.fatigue.toFixed(3)} behavior=${agent.behavior} decision=${agent.decision?.chosen ?? '—'}(${agent.decision?.reason ?? '—'}) top=${top} speed=${agent.speed.toFixed(2)} pos=(${agent.pos.x.toFixed(1)},${agent.pos.z.toFixed(1)}) water=${water ? `(${water.x.toFixed(1)},${water.z.toFixed(1)})` : 'none'} waterDist=${waterDistance?.toFixed(1) ?? '—'} waterWalkable=${waterWalkable ?? '—'} targetDist=${targetDistance?.toFixed(1) ?? '—'} nearestDrinkDist=${nearestDistance?.toFixed(1) ?? '—'} home=${agent.homeId ?? 'none'} homeDist=${homeDistance?.toFixed(1) ?? '—'} threat=${agent.memory.lastThreatPos ? `(${agent.memory.lastThreatPos.x.toFixed(1)},${agent.memory.lastThreatPos.z.toFixed(1)})` : '—'}`,
    );
  }
}
if (args.includes('--assert-water-survival')) {
  // Use the event ledger, not sim.agents: consumed carcasses and old dead
  // AgentState records may be pruned before the end of a multi-day run.
  const dehydrationDeaths = deathsByCause(journal, 'dehydration');
  const bySpecies = new Map<string, number>();
  for (const event of dehydrationDeaths) {
    const species = String(event.data.species ?? 'unknown');
    bySpecies.set(species, (bySpecies.get(species) ?? 0) + 1);
  }
  const breakdown = [...bySpecies.entries()].map(([species, count]) => `${species}=${count}`).join(', ') || 'none';
  console.log(`\nwater-survival gate (death event ledger): dehydration deaths=${dehydrationDeaths.length} (${breakdown})`);
  if (dehydrationDeaths.length > 0) {
    throw new Error(`Water-survival regression: dehydration deaths detected: ${breakdown}`);
  }
}
console.log('\nevents');
const types = [...counts.entries()].sort((a, b) => b[1] - a[1]);
for (const [type, n] of types) console.log(`  ${n.toString().padStart(5)}  ${type}`);
const lines = [...journal].sort((a, b) => b.importance - a.importance || a.seq - b.seq).slice(0, 8);
console.log('\njournal');
for (const event of lines) console.log(formatEvent(event));

if (jsonPath) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify({ seed, days, counts: Object.fromEntries(counts), events: journal }, null, 2));
  console.log(`\nwrote ${jsonPath}`);
}

function formatEvent(event: SimEvent): string {
  const clock = `${event.day}d ${event.timeOfDay.toFixed(2)}h`;
  const who = event.actors.length ? ` agents ${event.actors.join(',')}` : '';
  const place = event.place ? ` @ ${event.place}` : '';
  return `  [${clock}] ${event.type}${place}${who}  ${JSON.stringify(event.data)}`;
}
