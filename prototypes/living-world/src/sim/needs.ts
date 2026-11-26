import type { CauseOfDeath } from './ids';
import type { AgentState } from './types';
import { sampleVeg, speciesOf, rtOf, type SimState } from './internal';
import { killAgent } from './lifecycle';

/**
 * Needs drift on game time. Hunger/thirst/fatigue use the species rates.
 * Cold and heat respond to the valley temperature, wetness, hot springs and kin.
 */
export function updateNeeds(state: SimState, gameDt: number): void {
  const hours = gameDt / 3600;
  if (hours <= 0) return;
  const temp = state.env.temperatureC;
  const weather = state.env.weather;

  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const sp = speciesOf(state, agent);
    const rt = rtOf(state, agent.id);
    const rates = sp.needsRates;
    const speedRatio = agent.speed / Math.max(0.2, sp.locomotion.sprintSpeed);

    const inSpring = agent.behavior === 'bathe' && rt.inSpringId != null;
    const eating =
      (agent.behavior === 'graze' || agent.behavior === 'forage' || agent.behavior === 'feed') &&
      agent.speed < sp.locomotion.trotSpeed * 0.55;
    if (eating) {
      const quality = agent.behavior === 'feed' ? 0.85 : sampleVeg(state, agent.pos.x, agent.pos.z);
      if (quality > 0.06) {
        const rate = sp.diet.feedRatePerHour * (agent.behavior === 'feed' ? 1.4 : quality);
        agent.needs.hunger = Math.max(0, agent.needs.hunger - rate * hours);
      } else {
        agent.needs.hunger = Math.min(1, agent.needs.hunger + rates.hungerPerHour * hours);
      }
    } else {
      const extra = agent.behavior === 'chase' || agent.behavior === 'flee' ? 1.35 : 1;
      agent.needs.hunger = Math.min(1, agent.needs.hunger + rates.hungerPerHour * extra * hours);
    }

    // Moving slowly is not enough to count as drinking: a creature can be
    // blocked beside a rock or stuck on a slope while still in the drink state.
    // Only restore thirst at a generated safe bank that the individual has
    // actually reached. This prevents "drinking the air" from masking a
    // navigation failure.
    const drinking =
      agent.behavior === 'drink' &&
      agent.speed < 0.4 &&
      isAtDrinkBank(state, agent);
    if (drinking) agent.needs.thirst = Math.max(0, agent.needs.thirst - 4.2 * hours);
    else agent.needs.thirst = Math.min(1, agent.needs.thirst + rates.thirstPerHour * hours);

    const resting = agent.behavior === 'sleep' || agent.behavior === 'rest' || agent.behavior === 'perch';
    const sprinting = agent.behavior === 'chase' || agent.behavior === 'flee' || agent.behavior === 'defend';
    if (resting) {
      const gain = agent.behavior === 'sleep' ? 1.35 : 0.85;
      agent.needs.fatigue = Math.max(0, agent.needs.fatigue - rates.recoveryPerHour * gain * hours);
      agent.needs.stamina = Math.min(1, agent.needs.stamina + 1.3 * hours);
    } else {
      agent.needs.fatigue = Math.min(1, agent.needs.fatigue + rates.fatiguePerHour * (0.4 + speedRatio) * hours);
      if (sprinting) agent.needs.stamina = Math.max(0, agent.needs.stamina - (1.05 + speedRatio * 1.45) * hours);
      else if (speedRatio > 0.55) agent.needs.stamina = Math.max(0, agent.needs.stamina - speedRatio * speedRatio * 4.2 * hours);
      else agent.needs.stamina = Math.min(1, agent.needs.stamina + 0.45 * hours);
    }

    const socialising =
      agent.behavior === 'socialize' ||
      agent.behavior === 'play' ||
      agent.behavior === 'interact' ||
      agent.behavior === 'court' ||
      agent.behavior === 'care';
    if (socialising) agent.needs.social = Math.max(0, agent.needs.social - 0.7 * hours);
    else agent.needs.social = Math.min(1, agent.needs.social + rates.socialPerHour * hours);

    const exploring = agent.behavior === 'wander' || agent.behavior === 'patrol' || agent.behavior === 'soar' || agent.behavior === 'glide';
    if (exploring) agent.needs.curiosity = Math.max(0, agent.needs.curiosity - rates.curiosityPerHour * 1.6 * hours);
    else agent.needs.curiosity = Math.min(1, agent.needs.curiosity + rates.curiosityPerHour * hours);

    const threatRecent = agent.memory.lastThreatAt != null && state.env.time - agent.memory.lastThreatAt < 1500;
    agent.needs.fear = Math.max(0, agent.needs.fear - (threatRecent ? 0.08 : 0.55) * hours);

    let coldRate = 0;
    if (temp < sp.thermal.comfortMinC) {
      const sev = (sp.thermal.comfortMinC - temp) / 8;
      coldRate = sev * (1 - sp.thermal.insulation * 0.7) * (1 + rt.wetness * 0.85) * 0.9;
    } else coldRate = -0.4;
    if (inSpring) coldRate = -2.4;
    else if (resting && nearKin(state, agent)) coldRate -= 0.28;
    agent.needs.cold = clamp01(agent.needs.cold + coldRate * hours);

    if (temp > sp.thermal.comfortMaxC) {
      const sev = (temp - sp.thermal.comfortMaxC) / 8;
      const heat = sev * (1 - sp.thermal.insulation * 0.45) * 0.75;
      agent.needs.heat = clamp01(agent.needs.heat + heat * hours);
    } else agent.needs.heat = Math.max(0, agent.needs.heat - 0.4 * hours);
    if (inSpring && temp > sp.thermal.comfortMaxC - 4) {
      agent.needs.heat = clamp01(agent.needs.heat + 0.15 * hours);
    }

    if (inSpring || agent.posture === 'swim' || weather === 'rain' || weather === 'storm') {
      rt.wetness = Math.min(1, rt.wetness + (inSpring ? 2.4 : 0.85) * hours);
    } else if (weather === 'snow') rt.wetness = Math.min(1, rt.wetness + 0.28 * hours);
    else rt.wetness = Math.max(0, rt.wetness - 0.6 * hours);

    const inSeason = sp.lifeCycle.breedingSeasons.includes(state.env.season);
    const pop = state.counts.get(agent.speciesId) ?? 0;
    if (agent.lifeStage === 'adult' && inSeason && !agent.pregnancy && pop < sp.carryingCapacity) {
      const room = 1 - pop / sp.carryingCapacity;
      agent.needs.breeding = Math.min(1, agent.needs.breeding + 0.07 * Math.max(0.25, room) * hours);
    } else agent.needs.breeding = Math.max(0, agent.needs.breeding - 0.09 * hours);

    let damage = 0;
    if (agent.needs.hunger > 0.97) damage += (agent.needs.hunger - 0.97) * 0.35;
    if (agent.needs.thirst > 0.97) damage += (agent.needs.thirst - 0.97) * 0.55;
    if (agent.needs.cold > 0.93) damage += (agent.needs.cold - 0.93) * 0.85;
    if (agent.needs.heat > 0.93) damage += (agent.needs.heat - 0.93) * 0.85;
    if (damage > 0) agent.needs.health = Math.max(0, agent.needs.health - damage * hours);
    else agent.needs.health = Math.min(1, agent.needs.health + 0.02 * hours);

    if (agent.needs.health <= 0.001) {
      let cause: CauseOfDeath = 'injury';
      if (agent.needs.thirst > 0.9) cause = 'dehydration';
      else if (agent.needs.hunger > 0.9) cause = 'starvation';
      else if (agent.needs.cold > 0.85 || agent.needs.heat > 0.85) cause = 'exposure';
      killAgent(state, agent, cause);
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function nearKin(state: SimState, agent: AgentState): boolean {
  if (agent.groupId == null) return false;
  state.spatial.query(agent.pos.x, agent.pos.z, 5.5, state.nearScratch);
  for (const other of state.nearScratch) {
    if (other.id === agent.id || !other.alive) continue;
    if (other.groupId === agent.groupId) return true;
    if (other.id === agent.motherId || agent.id === other.motherId) return true;
  }
  return false;
}

function isAtDrinkBank(state: SimState, agent: AgentState): boolean {
  const target = agent.intent.target;
  if (!target) return false;
  const profile = speciesOf(state, agent);
  const reach = Math.max(1.8, profile.body.radius * agent.scale * 0.9);
  const d = Math.hypot(agent.pos.x - target.x, agent.pos.z - target.z);
  if (d > reach) return false;
  // Intent targets can be stale / manually authored. Require that the target
  // still belongs to the safe, shallow bank catalogue built from this terrain.
  return state.drinkSpots.some((spot) => Math.hypot(spot.x - target.x, spot.z - target.z) < 0.05);
}
