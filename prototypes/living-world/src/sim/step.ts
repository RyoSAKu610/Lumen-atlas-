import { updateDecisions } from './ai';
import { updateEcology, updateSpringsAndHomes } from './ecology';
import { updateEnvironment } from './environment';
import type { SimState } from './internal';
import { updateInteractions } from './interaction';
import { updateLifecycle } from './lifecycle';
import { updateNeeds } from './needs';
import { updatePredation, updateScavenge } from './predation';
import { updatePerception } from './spatial';
import { refreshCentroids, updateSteering } from './steering';

/** One simulation step. `physDt` defaults to the fixed step; catch-up passes a coarser multiple. */
export function stepState(state: SimState, physDt = state.config.fixedDt): void {
  const sub = Math.max(1, Math.round(physDt / state.config.fixedDt));
  const used = sub * state.config.fixedDt;
  state.tick += sub;
  state.physTime = state.tick * state.config.fixedDt;
  const gameDt = used * state.config.clockScale;

  for (const agent of state.agents) {
    agent.prevPos.x = agent.pos.x;
    agent.prevPos.y = agent.pos.y;
    agent.prevPos.z = agent.pos.z;
    agent.prevHeading = agent.heading;
  }

  updateEnvironment(state, gameDt);
  state.spatial.rebuild(state.agents);
  updatePerception(state, used);
  updateNeeds(state, gameDt);
  updateLifecycle(state, gameDt);
  state.spatial.rebuild(state.agents);
  updateEcology(state, gameDt);
  updatePredation(state, used);
  updateDecisions(state, used);
  updateInteractions(state, used);
  refreshCentroids(state);
  updateSteering(state, used);
  updateSpringsAndHomes(state);
  updateScavenge(state, gameDt);

  for (const agent of state.agents) {
    if (agent.vocalization && agent.vocalization.until <= state.env.time) agent.vocalization = null;
  }
}
