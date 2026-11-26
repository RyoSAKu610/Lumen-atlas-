import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/types';
import { deathsByCause, mortalityBySpeciesAndCause } from '../../src/sim/death-ledger';

function death(seq: number, species: string, cause: string): SimEvent {
  return {
    seq,
    time: seq * 60,
    day: 1,
    timeOfDay: 6,
    type: 'agent.died',
    actors: [seq],
    pos: { x: seq, z: -seq },
    place: null,
    data: { species, cause, stage: 'adult' },
    importance: 0.9,
    approximate: false,
  };
}

describe('mortality audit ledger', () => {
  it('counts dehydration from death events even after an AgentState has been pruned', () => {
    const events = [
      death(1, 'giant_grazer', 'dehydration'),
      death(2, 'kit_forager', 'starvation'),
      death(3, 'giant_grazer', 'dehydration'),
    ];
    expect(deathsByCause(events, 'dehydration')).toHaveLength(2);
    expect(mortalityBySpeciesAndCause(events).get('giant_grazer / dehydration')).toBe(2);
    expect(mortalityBySpeciesAndCause(events).get('kit_forager / starvation')).toBe(1);
  });

  it('ignores non-death events and does not classify unrelated causes as dehydration', () => {
    const events: SimEvent[] = [
      death(1, 'giant_grazer', 'predation'),
      { ...death(2, 'kit_forager', 'dehydration'), type: 'agent.born' },
    ];
    expect(deathsByCause(events, 'dehydration')).toHaveLength(0);
    expect(mortalityBySpeciesAndCause(events).get('giant_grazer / predation')).toBe(1);
  });
});
