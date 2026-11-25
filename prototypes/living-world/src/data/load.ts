import art from '../../data/art/art-direction.json';
import shots from '../../data/art/camera-shots.json';
import narration from '../../data/narration/ja.json';
import region from '../../data/region/yugasumi_valley.json';
import giantGrazer from '../../data/species/giant_grazer.json';
import kitForager from '../../data/species/kit_forager.json';
import ridgeStalker from '../../data/species/ridge_stalker.json';
import thermalGlider from '../../data/species/thermal_glider.json';
import type { GameData } from './schema';
import { validateGameData, type DataDiagnostic, type RawGameData } from './validate';

export const RAW_GAME_DATA: RawGameData = {
  region,
  species: {
    'giant_grazer.json': giantGrazer,
    'kit_forager.json': kitForager,
    'ridge_stalker.json': ridgeStalker,
    'thermal_glider.json': thermalGlider,
  },
  art,
  narration,
  shots,
};

export function loadGameData(raw: RawGameData = RAW_GAME_DATA): { data: GameData | null; diagnostics: DataDiagnostic[] } {
  return validateGameData(raw);
}

/** Throws with a readable message if the bundled data is invalid (tests, scripts, labs). */
export function loadGameDataOrThrow(raw: RawGameData = RAW_GAME_DATA): GameData {
  const { data, diagnostics } = validateGameData(raw);
  if (!data) {
    const lines = diagnostics.filter((x) => x.severity === 'error').map((x) => `${x.file} :: ${x.path} :: ${x.message}`);
    throw new Error(`Invalid game data:\n${lines.join('\n')}`);
  }
  return data;
}
