import type { GameData } from '../data/schema';
import { NEED_IDS } from '../sim/ids';
import type { AgentId, AgentState, Relationship, SimulationView } from '../sim/types';
import { nicknameFor, speciesName } from './narrate';

export interface DossierModel {
  id: AgentId;
  name: string;
  species: string;
  line: string;
  phrase: string;
  needs: { id: string; label: string; value: number; urgency: boolean }[];
  why: string[];
  relations: string[];
}

const URGENCY = new Set(['hunger', 'thirst', 'fatigue', 'cold', 'heat', 'social', 'fear']);

export function buildDossier(sim: SimulationView, data: GameData, id: AgentId): DossierModel | null {
  const agent = sim.getAgent(id);
  if (!agent || !agent.alive) return null;
  const labels = data.narration.labels;
  const name = nicknameFor(data.narration, agent.speciesId, agent.id);
  const species = speciesName(data.art, agent.speciesId);
  const sex = labels.sexes[agent.sex];
  const stage = labels.lifeStages[agent.lifeStage];
  const dayLength = 24 * 3600;
  const ageDays = Math.max(0, (sim.env.time - agent.bornAt) / dayLength);
  return {
    id,
    name,
    species,
    line: `${sex} · ${stage} · ${ageDays.toFixed(1)}日`,
    phrase: labels.behaviorPhrases[agent.behavior],
    needs: NEED_IDS.map((need) => ({
      id: need,
      label: labels.needs[need],
      value: agent.needs[need],
      urgency: URGENCY.has(need),
    })),
    why: whyLines(agent, labels.behaviors),
    relations: relationLines(sim, data, agent),
  };
}

function whyLines(agent: AgentState, behaviors: GameData['narration']['labels']['behaviors']): string[] {
  const decision = agent.decision;
  if (!decision) return ['まだ判断の記録がない。'];
  const lines = [`${decision.reason}`];
  for (const option of decision.options.slice(0, 4)) {
    const bits = option.considerations
      .slice(0, 3)
      .map((c) => `${c.name} ${c.output.toFixed(2)}`)
      .join(' · ');
    lines.push(`${behaviors[option.behavior]} ${option.score.toFixed(2)}${bits ? ` — ${bits}` : ''}`);
  }
  return lines;
}

function relationLines(sim: SimulationView, data: GameData, agent: AgentState): string[] {
  const rows = [...sim.getRelationships(agent.id).entries()]
    .filter(([, rel]) => rel.familiarity > 0.05 || rel.kin !== 'none')
    .sort((a, b) => b[1].familiarity - a[1].familiarity)
    .slice(0, 5);
  if (rows.length === 0) return ['まだ深い顔見知りはいない。'];
  return rows.map(([id, rel]) => {
    const other = sim.getAgent(id);
    const name = other ? nicknameFor(data.narration, other.speciesId, other.id) : `#${id}`;
    return `${name} · ${kinLabel(rel)} · 馴染み ${rel.familiarity.toFixed(2)}`;
  });
}

function kinLabel(rel: Relationship): string {
  switch (rel.kin) {
    case 'parent':
      return '親';
    case 'offspring':
      return '子';
    case 'sibling':
      return '兄弟';
    case 'mate':
      return 'つがい';
    default:
      return rel.rivalry > 0.5 ? 'ライバル' : '知り合い';
  }
}
