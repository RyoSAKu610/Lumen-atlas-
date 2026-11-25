/**
 * Step-cost bench. Founding population, then ~100 and ~300 agents by scaling spawns in memory.
 *   npm run bench
 */
import type { RegionLayout } from '../src/data/schema';
import { loadGameDataOrThrow } from '../src/data/load';
import { Simulation } from '../src/sim/Simulation';

const data = loadGameDataOrThrow();

function scaleRegion(region: RegionLayout, target: number): RegionLayout {
  const current = region.spawns.reduce((sum, spawn) => sum + spawn.count, 0);
  const factor = target / current;
  const counts = region.spawns.map((spawn) => Math.max(1, Math.round(spawn.count * factor)));
  let sum = counts.reduce((a, b) => a + b, 0);
  let i = 0;
  let guard = 0;
  while (sum > target && guard++ < 10000) {
    const idx = i % counts.length;
    if (counts[idx] > 1) {
      counts[idx] -= 1;
      sum -= 1;
    }
    i += 1;
  }
  while (sum < target) {
    counts[i % counts.length] += 1;
    sum += 1;
    i += 1;
  }
  return {
    ...region,
    spawns: region.spawns.map((spawn, index) => ({ ...spawn, count: counts[index] })),
  };
}

function bench(label: string, region: RegionLayout, measured: number): { agents: number; ms: number } {
  const sim = Simulation.create({ region, species: data.species }, { seed: 11 });
  for (let i = 0; i < 25; i++) sim.step();
  const t0 = performance.now();
  for (let i = 0; i < measured; i++) sim.step();
  const ms = (performance.now() - t0) / measured;
  console.log(`${label.padEnd(10)} ${String(sim.agents.length).padStart(4)} agents   ${ms.toFixed(3)} ms/step`);
  return { agents: sim.agents.length, ms };
}

const founding = bench('founding', data.region, 300);
const hundred = bench('~100', scaleRegion(data.region, 100), 120);
const crowd = bench('~300', scaleRegion(data.region, 300), 80);

const foundingOk = founding.ms <= 0.5;
const crowdOk = crowd.ms <= 5;
console.log(`\nfounding ≤ 0.5 ms/step: ${foundingOk ? 'PASS' : 'FAIL'} (${founding.ms.toFixed(3)})`);
console.log(`300 ≤ 5 ms/step: ${crowdOk ? 'PASS' : 'FAIL'} (${crowd.ms.toFixed(3)})`);
void hundred;
if (!foundingOk || !crowdOk) process.exit(1);
