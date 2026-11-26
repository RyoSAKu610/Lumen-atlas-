import type { CauseOfDeath } from './ids';
import type { SimEvent } from './types';

/**
 * Mortality must be audited from the append-only event history, not the
 * currently retained AgentState array. Dead agents / carcasses may be pruned
 * after their remains are consumed, while their death events remain in the
 * journal. Counting only !agent.alive therefore under-counts old deaths.
 */
export function deathsByCause(events: readonly SimEvent[], cause: CauseOfDeath): SimEvent[] {
  return events.filter((event) => event.type === 'agent.died' && event.data.cause === cause);
}

export function mortalityBySpeciesAndCause(events: readonly SimEvent[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'agent.died') continue;
    const species = typeof event.data.species === 'string' ? event.data.species : 'unknown';
    const cause = typeof event.data.cause === 'string' ? event.data.cause : 'unknown';
    const key = `${species} / ${cause}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return totals;
}
