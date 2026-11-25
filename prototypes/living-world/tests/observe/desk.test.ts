import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadGameDataOrThrow } from '../../src/data/load';
import { DocumentaryCamera, type CameraWorld } from '../../src/observe/camera';
import { narrateEvent, nicknameFor, templateKey } from '../../src/observe/narrate';
import type { SimEvent } from '../../src/sim/types';

const data = loadGameDataOrThrow();
const sources = {
  narration: data.narration,
  art: data.art,
  region: data.region,
  agent: (id: number) =>
      id === 24
      ? { id: 24, speciesId: 'giant_grazer' }
      : id === 25
        ? { id: 25, speciesId: 'giant_grazer' }
        : id === 7
          ? { id: 7, speciesId: 'kit_forager' }
          : undefined,
};

function event(partial: Partial<SimEvent> & Pick<SimEvent, 'type'>): SimEvent {
  return {
    seq: 1,
    time: 0,
    day: 1,
    timeOfDay: 6,
    actors: [],
    pos: null,
    place: 'yugasumi_spring',
    data: {},
    importance: 0.5,
    approximate: false,
    ...partial,
  };
}

describe('narration desk', () => {
  it('prefers the specific greeting outcome over the generic line', () => {
    const greet = event({
      type: 'interaction.resolved',
      seq: 4,
      actors: [24, 25],
      data: { kind: 'greet', outcome: 'bonded' },
    });
    expect(templateKey(data.narration, greet)).toBe('interaction.resolved:greet:bonded');
    const line = narrateEvent(sources, greet);
    expect(line).toContain('イワオ');
    expect(line).toContain('コケ');
    expect(line).not.toContain('{actor}');
  });

  it('assigns a stable nickname and translates a cause of death', () => {
    expect(nicknameFor(data.narration, 'kit_forager', 7)).toBe(data.narration.nicknames.kit_forager[7]);
    const line = narrateEvent(sources, event({ type: 'agent.died', actors: [24], data: { cause: 'predation' } }));
    expect(line).toContain('イワオ');
    expect(line).toContain('捕食');
  });
});

describe('documentary camera', () => {
  const world: CameraWorld = {
    agents: [
      {
        id: 1,
        speciesId: 'giant_grazer',
        alive: true,
        behavior: 'graze',
        groupId: 1,
        pos: { x: 0, y: 10, z: 0 },
        heading: 0,
        length: 6.5,
        shoulder: 3.2,
      },
    ],
    terrainHeight: () => 0,
    place: () => ({ x: 12, y: 8, z: -6 }),
    heart: () => ({ x: 12, y: 8, z: -6 }),
  };

  it('holds a contact shot against a quieter event and cuts for a chase', () => {
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    const director = new DocumentaryCamera(camera, data.shots);
    director.consider(event({ type: 'interaction.contact', actors: [1, 2], data: { kind: 'greet' }, seq: 3 }));
    const held = director.shotName.ja;
    director.consider(event({ type: 'world.weather_changed', data: { weather: 'fog' }, seq: 4 }));
    expect(director.shotName.ja).toBe(held);
    director.consider(event({ type: 'hunt.chase_started', actors: [7, 1], seq: 5 }));
    expect(director.shotName.ja).not.toBe(held);
  });

  it('places a low giant shot near the body and above the ground', () => {
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    const director = new DocumentaryCamera(camera, data.shots);
    director.consider(event({ type: 'hotspring.entered', actors: [1], seq: 2 }));
    director.update(2, world);
    const distance = Math.hypot(camera.position.x, camera.position.z);
    expect(distance).toBeGreaterThan(8);
    expect(distance).toBeLessThan(30);
    expect(camera.position.y).toBeGreaterThan(10);
    expect(camera.position.y).toBeLessThan(12);
  });
});
