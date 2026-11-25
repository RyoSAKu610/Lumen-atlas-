import { loadGameDataOrThrow } from '../../src/data/load';
import { hashString } from '../../src/sim/rng';
import type { Simulation } from '../../src/sim/Simulation';
import type { AgentState } from '../../src/sim/types';

export const data = loadGameDataOrThrow();
export const bundle = { region: data.region, species: data.species };

export function fingerprint(sim: Simulation): string {
  const pos = sim.agents
    .map(
      (a) =>
        `${a.id}:${a.pos.x.toFixed(6)},${a.pos.y.toFixed(6)},${a.pos.z.toFixed(6)}:${a.heading.toFixed(6)}:${a.alive ? 1 : 0}`,
    )
    .join(';');
  const ev = sim.recentEvents(8000).map((e) => `${e.seq}:${e.type}`).join('|');
  return String(hashString(`${pos}#${ev}`));
}

export function place(sim: Simulation, agent: AgentState, x: number, z: number): void {
  const p = sim.terrain.clampToBounds(x, z, 4);
  const y = sim.terrain.heightAt(p.x, p.z);
  agent.pos.x = p.x;
  agent.pos.y = y;
  agent.pos.z = p.z;
  agent.prevPos.x = p.x;
  agent.prevPos.y = y;
  agent.prevPos.z = p.z;
}

/** Walkable point farthest from the current population. */
export function farthestClearing(sim: Simulation): { x: number; z: number; clearance: number } {
  let best = { x: 0, z: 0, clearance: -1 };
  for (let x = -150; x <= 150; x += 12) {
    for (let z = -150; z <= 150; z += 12) {
      if (!sim.terrain.isWalkable(x, z, 32, 0.4)) continue;
      let clearance = Infinity;
      for (const agent of sim.agents) {
        const d = Math.hypot(agent.pos.x - x, agent.pos.z - z);
        if (d < clearance) clearance = d;
      }
      if (clearance > best.clearance) best = { x, z, clearance };
    }
  }
  return best;
}

export function step(sim: Simulation, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}
