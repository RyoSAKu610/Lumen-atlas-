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
