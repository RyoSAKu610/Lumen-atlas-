import type { Obstacle, Terrain } from './terrain';
import type { AgentState } from './types';
import type { FlightMode } from './ids';
import { rtOf, speciesOf, type SimState } from './internal';
import { emit } from './journal';
import { angDiff, clamp, distXZ, wrapAngle } from './math';

const obsScratch: Obstacle[] = [];

export function refreshCentroids(state: SimState): void {
  state.centroids.clear();
  for (const agent of state.agents) {
    if (!agent.alive || agent.groupId == null) continue;
    let c = state.centroids.get(agent.groupId);
    if (!c) {
      c = { x: 0, z: 0, n: 0 };
      state.centroids.set(agent.groupId, c);
    }
    c.x += agent.pos.x;
    c.z += agent.pos.z;
    c.n += 1;
  }
}

export function updateSteering(state: SimState, dt: number): void {
  for (const agent of state.agents) steer(state, agent, dt);
}

function steer(state: SimState, agent: AgentState, dt: number): void {
  const sp = speciesOf(state, agent);
  if (!agent.alive) {
    agent.speed = 0;
    agent.velocity.x = 0;
    agent.velocity.y = 0;
    agent.velocity.z = 0;
    const y = state.terrain.heightAt(agent.pos.x, agent.pos.z);
    if (Number.isFinite(y)) agent.pos.y = y;
    return;
  }
  const rt = rtOf(state, agent.id);
  let tx = agent.intent.target?.x ?? agent.pos.x;
  let tz = agent.intent.target?.z ?? agent.pos.z;

  if (agent.behavior === 'follow' && agent.motherId != null) {
    const mother = state.agentById.get(agent.motherId);
    if (mother && mother.alive) {
      const back = 0.8 + sp.body.radius;
      tx = mother.pos.x - Math.sin(mother.heading) * back;
      tz = mother.pos.z - Math.cos(mother.heading) * back;
      agent.lookAt = { x: mother.pos.x, y: mother.pos.y + speciesOf(state, mother).body.headHeight * mother.scale, z: mother.pos.z };
    }
  } else if (agent.behavior === 'flee' && agent.memory.lastThreatPos) {
    const mother = agent.motherId != null ? state.agentById.get(agent.motherId) : undefined;
    const t = agent.memory.lastThreatPos;
    if (agent.lifeStage === 'juvenile' && mother?.alive && distXZ(mother.pos.x, mother.pos.z, t.x, t.z) > 7) {
      tx = mother.pos.x;
      tz = mother.pos.z;
    } else {
      const dx = agent.pos.x - t.x;
      const dz = agent.pos.z - t.z;
      const d = Math.hypot(dx, dz) || 1;
      tx = agent.pos.x + (dx / d) * 26;
      tz = agent.pos.z + (dz / d) * 26;
    }
  } else if ((agent.behavior === 'chase' || agent.behavior === 'stalk') && agent.intent.targetAgent != null) {
    const prey = state.agentById.get(agent.intent.targetAgent);
    if (prey && prey.alive && agent.behavior === 'chase') {
      tx = prey.pos.x;
      tz = prey.pos.z;
    }
  } else if (agent.behavior === 'soar' || agent.behavior === 'glide') {
    const spring = nearestSpring(state, agent.pos.x, agent.pos.z);
    const cx = spring?.x ?? tx;
    const cz = spring?.z ?? tz;
    rt.circle += dt * (agent.behavior === 'soar' ? 0.22 : 0.12);
    const rad = spring ? spring.radius * 2.4 : 16;
    tx = cx + Math.sin(rt.circle + agent.id) * rad;
    tz = cz + Math.cos(rt.circle + agent.id * 0.7) * rad;
  }

  const model = sp.social.model;
  const cohesive =
    (model === 'herd' || model === 'family' || model === 'loose_flock') &&
    agent.behavior !== 'flee' &&
    agent.behavior !== 'bathe' &&
    agent.behavior !== 'chase' &&
    agent.behavior !== 'stalk' &&
    agent.behavior !== 'soar' &&
    agent.behavior !== 'glide' &&
    agent.behavior !== 'interact' &&
    agent.lifeStage !== 'juvenile';
  if (cohesive && agent.groupId != null) {
    const c = state.centroids.get(agent.groupId);
    if (c && c.n >= 2) {
      const ox = (c.x - agent.pos.x) / (c.n - 1);
      const oz = (c.z - agent.pos.z) / (c.n - 1);
      const d = Math.hypot(ox, oz);
      const comfort = model === 'herd' ? 11 : 6;
      if (d > comfort) {
        const pull = sp.social.cohesion * 0.5;
        tx = tx * (1 - pull) + (agent.pos.x + ox) * pull;
        tz = tz * (1 - pull) + (agent.pos.z + oz) * pull;
      }
    }
  }

  let sx = 0;
  let sz = 0;
  const myR = sp.body.radius * agent.scale;
  state.spatial.query(agent.pos.x, agent.pos.z, myR * 3 + 4, state.nearScratch);
  for (const other of state.nearScratch) {
    if (other.id === agent.id || !other.alive) continue;
    const dx = agent.pos.x - other.pos.x;
    const dz = agent.pos.z - other.pos.z;
    const d = Math.hypot(dx, dz) || 0.001;
    let need = myR + speciesOf(state, other).body.radius * other.scale;
    if (other.id === agent.motherId || agent.id === other.motherId) need *= 0.45;
    if (d < need * 1.2) {
      const push = (need * 1.2 - d) / need;
      sx += (dx / d) * push;
      sz += (dz / d) * push;
    }
  }
  if (agent.posture !== 'airborne' && agent.behavior !== 'soar' && agent.behavior !== 'glide') {
    const obs = state.terrain.obstaclesNear(agent.pos.x, agent.pos.z, myR + 2.2, obsScratch);
    for (const o of obs) {
      const dx = agent.pos.x - o.x;
      const dz = agent.pos.z - o.z;
      const d = Math.hypot(dx, dz) || 0.001;
      const need = o.radius + myR * 0.55;
      if (d < need + 0.8) {
        const push = (need + 0.8 - d) / (need + 0.8);
        sx += (dx / d) * push * 1.5;
        sz += (dz / d) * push * 1.5;
      }
    }
  }
  tx += sx * 2.4;
  tz += sz * 2.4;

  const airborne = agent.posture === 'airborne' || agent.behavior === 'soar' || agent.behavior === 'glide';
  const dx = tx - agent.pos.x;
  const dz = tz - agent.pos.z;
  const dist = Math.hypot(dx, dz);
  let desired = desiredSpeed(state, agent, dist);
  if (agent.needs.stamina < 0.18 && (agent.behavior === 'chase' || agent.behavior === 'flee' || agent.behavior === 'defend')) {
    desired = Math.min(desired, sp.locomotion.walkSpeed);
  }
  if (dist > 0.2) {
    // During a short stuck escape, preserve the detour heading instead of
    // immediately steering back into the same blocked line to the goal.
    if (rt.stuck >= 0) {
      const want = Math.atan2(dx, dz);
      const diff = angDiff(agent.heading, want);
      const speedForTurn = Math.max(agent.speed, sp.locomotion.walkSpeed * 0.45);
      const maxTurn = sp.locomotion.turnRate * dt * (0.6 + 0.8 * (sp.locomotion.walkSpeed / speedForTurn));
      const turn = clamp(diff, -maxTurn, maxTurn);
      agent.heading = wrapAngle(agent.heading + turn);
      if (airborne) agent.bank = clamp((-turn / Math.max(dt, 1e-3)) * 0.11, -0.75, 0.75);
      else agent.bank *= 0.86;
    } else {
      agent.bank *= 0.86;
    }
  } else agent.bank *= 0.9;

  const accel = sp.locomotion.acceleration * dt;
  agent.speed = Math.max(0, agent.speed + clamp(desired - agent.speed, -accel * 2, accel));
  if (agent.speed < 0.04) agent.speed = 0;

  let nx = agent.pos.x + Math.sin(agent.heading) * agent.speed * dt;
  let nz = agent.pos.z + Math.cos(agent.heading) * agent.speed * dt;
  if (!airborne) {
    const stepped = resolveStep(state, agent, nx, nz, tx, tz);
    nx = stepped.x;
    nz = stepped.z;
    if (stepped.heading != null) agent.heading = stepped.heading;
  }
  const clamped = state.terrain.clampToBounds(nx, nz, 3);
  if (clamped.x !== nx || clamped.z !== nz) {
    const inward = Math.atan2(-clamped.x, -clamped.z);
    agent.heading = wrapAngle(agent.heading + clamp(angDiff(agent.heading, inward), -0.4, 0.4));
  }
  const moved = distXZ(agent.pos.x, agent.pos.z, clamped.x, clamped.z);
  if (desired > 0.3 && moved < 0.015 * Math.max(1, dt) && dt < 1.2 && agent.behavior !== 'sleep' && agent.behavior !== 'rest') {
    if (rt.stuck < 0) {
      // Detour window expires whether or not the first alternate step succeeds.
      rt.stuck = Math.min(0, rt.stuck + dt);
    } else {
      rt.stuck += dt;
      if (rt.stuck > 1.5) {
        agent.heading = wrapAngle(agent.heading + 1.15);
        // Negative stuck time marks a short escape window. During it, local
        // collision resolution may take a safe sideways step even if that step
        // temporarily increases distance to the final target.
        rt.stuck = -2.0;
      }
    }
  } else if (moved > 0.05) {
    if (rt.stuck < 0) rt.stuck = Math.min(0, rt.stuck + dt);
    else rt.stuck = 0;
  }

  agent.pos.x = clamped.x;
  agent.pos.z = clamped.z;
  placeVertical(state, agent, dt);
  agent.velocity.x = Math.sin(agent.heading) * agent.speed;
  agent.velocity.z = Math.cos(agent.heading) * agent.speed;
  agent.velocity.y = dt > 0 ? (agent.pos.y - agent.prevPos.y) / dt : 0;
  agent.stats.distance += distXZ(agent.prevPos.x, agent.prevPos.z, agent.pos.x, agent.pos.z);
  if (!Number.isFinite(agent.pos.x) || !Number.isFinite(agent.pos.y) || !Number.isFinite(agent.pos.z)) {
    agent.pos.x = agent.prevPos.x;
    agent.pos.y = agent.prevPos.y;
    agent.pos.z = agent.prevPos.z;
    agent.speed = 0;
  }
}

function desiredSpeed(state: SimState, agent: AgentState, dist: number): number {
  const sp = speciesOf(state, agent);
  const L = sp.locomotion;
  let speed: number;
  switch (agent.behavior) {
    case 'idle':
    case 'sleep':
    case 'rest':
    case 'graze':
    case 'forage':
    case 'drink':
    case 'bathe':
    case 'feed':
    case 'vigilance':
    case 'perch':
      speed = dist > 1.5 ? L.walkSpeed * 0.85 : 0;
      break;
    case 'stalk':
      speed = L.walkSpeed * (sp.predation?.stalkSpeedFactor ?? 0.4);
      break;
    case 'chase':
    case 'flee':
      speed = L.sprintSpeed;
      break;
    case 'defend':
    case 'play':
      speed = L.runSpeed;
      break;
    case 'soar':
    case 'glide':
      speed = L.flight?.cruiseSpeed ?? L.trotSpeed;
      break;
    case 'interact': {
      const phase = agent.interaction?.phase;
      if (!phase || (phase !== 'approach' && phase !== 'separate')) return 0;
      if (phase === 'approach' && agent.interaction?.role === 'responder' && dist < 5) return 0;
      speed = L.walkSpeed * 0.95;
      break;
    }
    case 'follow':
      speed = dist > 2.2 ? L.trotSpeed : L.walkSpeed;
      break;
    default:
      speed = L.walkSpeed;
  }
  if (dist < 2.4 && agent.behavior !== 'flee' && agent.behavior !== 'chase' && agent.behavior !== 'soar' && agent.behavior !== 'glide') {
    speed *= clamp(dist / 2.4, 0, 1);
  }
  if (dist < 0.65 && agent.behavior !== 'flee' && agent.behavior !== 'chase') speed = 0;
  return speed;
}

function resolveStep(
  state: SimState,
  agent: AgentState,
  nx: number,
  nz: number,
  tx: number,
  tz: number,
): { x: number; z: number; heading: number | null } {
  if (occupiable(state, agent, nx, nz)) return { x: nx, z: nz, heading: null };
  let bestX = agent.pos.x;
  let bestZ = agent.pos.z;
  let bestH: number | null = null;
  const currentDistance = distXZ(agent.pos.x, agent.pos.z, tx, tz);
  let bestD = currentDistance;
  const rt = rtOf(state, agent.id);
  const detouring = rt.stuck < 0;
  let bestEscapeTurn = Infinity;
  const step = Math.max(0.35, agent.speed * 0.1);
  for (let k = 0; k < 8; k++) {
    const h = wrapAngle(agent.heading + (k - 3.5) * 0.45);
    const sx = agent.pos.x + Math.sin(h) * step;
    const sz = agent.pos.z + Math.cos(h) * step;
    if (!occupiable(state, agent, sx, sz)) continue;
    const d = distXZ(sx, sz, tx, tz);
    if (d < bestD - 0.01) {
      bestD = d;
      bestX = sx;
      bestZ = sz;
      bestH = h;
    } else if (detouring && d <= currentDistance + step * 1.1) {
      // The greedy step may have to move around a rock / steep edge before it
      // can reduce goal distance. Permit a tiny safe detour, preferring the
      // heading with the smallest turn from the current escape direction.
      const turn = Math.abs(angDiff(agent.heading, h));
      if (turn < bestEscapeTurn) {
        bestEscapeTurn = turn;
        if (bestD >= currentDistance - 0.01) {
          bestX = sx;
          bestZ = sz;
          bestH = h;
        }
      }
    }
  }
  return { x: bestX, z: bestZ, heading: bestH };
}

function occupiable(state: SimState, agent: AgentState, x: number, z: number): boolean {
  const sp = speciesOf(state, agent);
  const terrain = state.terrain;
  if (agent.behavior === 'bathe') {
    const pool = nearestSpring(state, x, z);
    if (pool) {
      const d = distXZ(x, z, pool.x, pool.z);
      if (d <= pool.radius + 1.2) return terrain.inBounds(x, z, 2);
      if (d <= pool.radius * 2.4 + 8) return walkable(terrain, x, z, sp.locomotion.maxSlopeDeg + 20, 2.2);
    }
  }
  const maxWater = agent.behavior === 'bathe' ? 3 : sp.locomotion.canSwim ? 1.55 : 0.45;
  const slope = sp.locomotion.maxSlopeDeg + (agent.behavior === 'flee' ? 8 : 0);
  return walkable(terrain, x, z, slope, maxWater);
}

function walkable(terrain: Terrain, x: number, z: number, maxSlopeDeg: number, maxWater: number): boolean {
  if (!terrain.inBounds(x, z, 3)) return false;
  if (terrain.waterDepthAt(x, z) > maxWater) return false;
  return slopeCos(terrain, x, z) >= Math.cos((maxSlopeDeg * Math.PI) / 180);
}

/** Up-component of the interpolated normal, without allocating. */
function slopeCos(terrain: Terrain, x: number, z: number): number {
  const r = terrain.res;
  const gx = Math.min(r - 1.000001, Math.max(0, (x + terrain.half) / terrain.cell));
  const gz = Math.min(r - 1.000001, Math.max(0, (z + terrain.half) / terrain.cell));
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const w0 = (1 - fx) * (1 - fz);
  const w1 = fx * (1 - fz);
  const w2 = (1 - fx) * fz;
  const w3 = fx * fz;
  const i00 = (j * r + i) * 3;
  const N = terrain.normals;
  const nx = N[i00] * w0 + N[i00 + 3] * w1 + N[i00 + r * 3] * w2 + N[i00 + r * 3 + 3] * w3;
  const ny = N[i00 + 1] * w0 + N[i00 + 4] * w1 + N[i00 + r * 3 + 1] * w2 + N[i00 + r * 3 + 4] * w3;
  const nz = N[i00 + 2] * w0 + N[i00 + 5] * w1 + N[i00 + r * 3 + 2] * w2 + N[i00 + r * 3 + 5] * w3;
  const len = Math.hypot(nx, ny, nz) || 1;
  return ny / len;
}

function nearestSpring(state: SimState, x: number, z: number) {
  let best: (typeof state.terrain.pools)[number] | null = null;
  let bestD = Infinity;
  for (const pool of state.terrain.pools) {
    if (pool.kind !== 'hot_spring') continue;
    const d = distXZ(x, z, pool.x, pool.z);
    if (d < bestD) {
      bestD = d;
      best = pool;
    }
  }
  return best;
}

function placeVertical(state: SimState, agent: AgentState, dt: number): void {
  const sp = speciesOf(state, agent);
  const flight = sp.locomotion.flight;
  const rt = rtOf(state, agent.id);
  const ground = state.terrain.heightAt(agent.pos.x, agent.pos.z);
  if (flight && (agent.behavior === 'soar' || agent.behavior === 'glide' || agent.posture === 'airborne' || (agent.behavior === 'perch' && rt.altitude > 0.4))) {
    const spring = nearestSpring(state, agent.pos.x, agent.pos.z);
    const overThermal = spring != null && distXZ(agent.pos.x, agent.pos.z, spring.x, spring.z) < spring.radius * 3.2;
    const landing = agent.behavior === 'perch' || agent.behavior === 'sleep' || agent.behavior === 'rest' || agent.behavior === 'drink';
    let mode: FlightMode;
    if (landing) {
      mode = 'landing';
      rt.altitude = Math.max(0, rt.altitude - flight.sinkRate * 1.6 * dt);
      if (rt.altitude <= 0.35) {
        rt.altitude = 0;
        mode = 'landing';
        agent.flightMode = null;
        agent.posture = agent.behavior === 'perch' ? 'perch' : agent.behavior === 'sleep' ? 'sleep' : agent.behavior === 'rest' ? 'lie' : 'stand';
        agent.pos.y = Number.isFinite(ground) ? ground : agent.pos.y;
        agent.bank = 0;
        return;
      }
    } else if (rt.altitude < 2.2) {
      mode = 'takeoff';
      rt.altitude += flight.climbRate * dt;
      agent.posture = 'airborne';
      agent.speed = Math.max(agent.speed, flight.minSpeed * 0.35);
    } else if (agent.behavior === 'soar' && overThermal) {
      mode = 'soar';
      rt.altitude = Math.min(flight.cruiseAltitude + 18, rt.altitude + flight.soarClimbRate * 0.55 * dt);
      agent.posture = 'airborne';
    } else if (agent.behavior === 'glide') {
      mode = 'glide';
      rt.altitude = Math.max(flight.cruiseAltitude * 0.45, rt.altitude - flight.sinkRate * dt);
      agent.posture = 'airborne';
    } else {
      mode = 'flap';
      const target = flight.cruiseAltitude * (0.75 + 0.15 * ((agent.id % 5) / 5));
      rt.altitude += clamp(target - rt.altitude, -flight.sinkRate, flight.climbRate) * dt;
      agent.posture = 'airborne';
    }
    rt.altitude = clamp(rt.altitude, 0, flight.maxAltitude);
    if (agent.posture === 'airborne') {
      agent.flightMode = mode;
      if (mode === 'soar' && !rt.soarAnnounced && rt.altitude > 8) {
        rt.soarAnnounced = true;
        emit(state, 'flight.soaring', [agent.id], { x: agent.pos.x, z: agent.pos.z }, { altitude: Math.round(rt.altitude) }, 0.35);
      }
      if (rt.altitude < 2) rt.soarAnnounced = false;
      const min = mode === 'takeoff' ? flight.minSpeed * 0.3 : flight.minSpeed;
      if (agent.speed < min) agent.speed = min;
      if (agent.speed > flight.cruiseSpeed * 1.15) agent.speed = flight.cruiseSpeed;
    }
    agent.pos.y = (Number.isFinite(ground) ? ground : 0) + rt.altitude;
    return;
  }
  rt.altitude = 0;
  agent.flightMode = null;
  const depth = state.terrain.waterDepthAt(agent.pos.x, agent.pos.z);
  const surface = state.terrain.waterSurfaceAt(agent.pos.x, agent.pos.z);
  if (agent.posture === 'bathe' || (depth > 0.75 && sp.locomotion.canSwim && agent.behavior !== 'sleep' && agent.behavior !== 'rest' && agent.posture !== 'dead')) {
    if (agent.behavior !== 'bathe' && agent.posture !== 'bathe') agent.posture = 'swim';
    agent.pos.y = surface ?? ground;
  } else {
    if (agent.posture === 'swim') agent.posture = 'stand';
    agent.pos.y = ground;
  }
  if (!Number.isFinite(agent.pos.y)) agent.pos.y = agent.prevPos.y;
}
