/**
 * Offline journal run.
 *   npm run simulate -- --days 3 --seed 7 [--json preview/journal.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadGameDataOrThrow } from '../src/data/load';
import { Simulation } from '../src/sim/Simulation';
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
console.log('\nmortality by species / life stage / cause');
for (const [key, n] of [...mortality.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`  ${n.toString().padStart(3)}  ${key}`);
}
console.log(`  births recorded: ${journal.filter((event) => event.type === 'agent.born').length}`);

if (args.includes('--diagnose-water')) {
  console.log('\nwater access diagnostics (kit_forager)');
  
  const kitProfile = data.species.find((sp) => sp.id === 'kit_forager');
  const drinkCandidates: Array<{ x: number; z: number }> = [];
  let lastX = Infinity;
  let lastZ = Infinity;
  for (const sample of sim.terrain.riverSamples) {
    if (Math.hypot(sample.x - lastX, sample.z - lastZ) < 16) continue;
    const ox = Math.cos(sample.flowDir) * (sample.halfWidth + 1.4);
    const oz = -Math.sin(sample.flowDir) * (sample.halfWidth + 1.4);
    for (const point of [
      { x: sample.x + ox, z: sample.z + oz },
      { x: sample.x - ox, z: sample.z - oz },
    ]) {
      if (sim.terrain.inBounds(point.x, point.z, 4)) drinkCandidates.push(point);
    }
    lastX = sample.x;
    lastZ = sample.z;
  }
  for (const pool of sim.terrain.pools) {
    if (pool.kind === 'hot_spring' && pool.temperatureC > 36) continue;
    for (let k = 0; k < 6; k++) {
      const angle = (k / 6) * Math.PI * 2;
      const point = { x: pool.x + Math.cos(angle) * (pool.radius + 1.3), z: pool.z + Math.sin(angle) * (pool.radius + 1.3) };
      if (sim.terrain.inBounds(point.x, point.z, 4)) drinkCandidates.push(point);
    }
  }
  console.log(`drink candidates: ${drinkCandidates.length}; river samples: ${sim.terrain.riverSamples.length}`);
  for (const agent of sim.agents.filter((a) => a.speciesId === 'kit_forager').sort((a, b) => a.id - b.id)) {
    const nearest = drinkCandidates
      .map((point) => ({ ...point, distance: Math.hypot(agent.pos.x - point.x, agent.pos.z - point.z) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map((point) => {
        const walkable = kitProfile ? sim.terrain.isWalkable(point.x, point.z, kitProfile.locomotion.maxSlopeDeg, 0.6) : false;
        const surface = sim.terrain.waterSurfaceAt(point.x, point.z);
        return `(${point.x.toFixed(1)},${point.z.toFixed(1)}) d=${point.distance.toFixed(1)} walk=${walkable} water=${surface === null ? 'dry' : 'wet'}`;
      });
    console.log(`  nearest for #${agent.id}: ${nearest.join(' | ')}`);
  }

  for (const agent of sim.agents.filter((a) => a.speciesId === 'kit_forager').sort((a, b) => a.id - b.id)) {
    const water = agent.memory.water;
    const target = agent.intent.target;
    const waterDistance = water ? Math.hypot(agent.pos.x - water.x, agent.pos.z - water.z) : null;
    const targetDistance = target ? Math.hypot(agent.pos.x - target.x, agent.pos.z - target.z) : null;
    const waterWalkable = water && kitProfile
      ? sim.terrain.isWalkable(water.x, water.z, kitProfile.locomotion.maxSlopeDeg, 0.6)
      : null;
    const waterDepth = water ? sim.terrain.waterDepthAt(water.x, water.z) : null;
    const waterSurface = water ? sim.terrain.waterSurfaceAt(water.x, water.z) !== null : null;
    console.log(
      `  #${agent.id} ${agent.alive ? 'alive' : agent.causeOfDeath ?? 'dead'} stage=${agent.lifeStage} thirst=${agent.needs.thirst.toFixed(3)} behavior=${agent.behavior} speed=${agent.speed.toFixed(2)} pos=(${agent.pos.x.toFixed(1)},${agent.pos.z.toFixed(1)}) water=${water ? `(${water.x.toFixed(1)},${water.z.toFixed(1)})` : 'none'} waterDist=${waterDistance?.toFixed(1) ?? '—'} walkable=${waterWalkable ?? '—'} depth=${waterDepth?.toFixed(2) ?? '—'} hasSurface=${waterSurface ?? '—'} targetDist=${targetDistance?.toFixed(1) ?? '—'}`,
    );
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
