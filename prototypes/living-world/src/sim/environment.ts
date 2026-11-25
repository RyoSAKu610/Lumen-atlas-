import { SEASONS, WEATHERS, type DayPhase, type Season, type Weather } from './ids';
import type { SimState } from './internal';
import { emit } from './journal';
import { moonPosition, sunPosition, yearFraction } from './sky';
import { wrapAngle } from './math';

/** Dawn ~5–7h, dusk ~17.5–19.5h. */
export function dayPhaseOf(hour: number): DayPhase {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 17.5) return 'day';
  if (h >= 17.5 && h < 19.5) return 'dusk';
  return 'night';
}

const WEATHER_TEMP: Record<Weather, number> = {
  clear: 1.4,
  cloudy: -0.8,
  rain: -3.2,
  fog: -1.6,
  snow: -6.5,
  storm: -4.2,
};

const WIND_MULT: Record<Weather, number> = {
  clear: 1,
  cloudy: 1.08,
  fog: 0.55,
  rain: 1.32,
  snow: 1.15,
  storm: 2.25,
};

export function initEnvironment(state: SimState): void {
  const cfg = state.config;
  state.env = {
    time: 0,
    day: 1,
    timeOfDay: cfg.startHour,
    dayPhase: dayPhaseOf(cfg.startHour),
    season: cfg.startSeason,
    seasonProgress: 0,
    year: 1,
    weather: 'clear',
    weatherIntensity: 0.65,
    temperatureC: 10,
    wind: { direction: state.region.wind.direction, speed: state.region.wind.speed },
    sun: { direction: { x: 0, y: 1, z: 0 }, elevation: 0 },
    moon: { direction: { x: 0, y: -1, z: 0 }, phase: 0 },
  };
  const hours = 3 + state.rngWeather.next() * 4.5;
  state.weatherUntil = hours * 3600;
  state.env.weatherIntensity = 0.45 + state.rngWeather.next() * 0.5;
  state.naturalWeather = pickWeather(state, cfg.startSeason, 'clear');
  state.naturalSeason = cfg.startSeason;
  state.env.weather = state.naturalWeather;
  recomputeDerived(state);
  state.prevDay = state.env.day;
  state.prevPhase = state.env.dayPhase;
  state.prevSeason = state.naturalSeason;
  state.prevWeather = state.env.weather;
  state.huntDay = state.env.day;
}

function pickWeather(state: SimState, season: Season, current: Weather): Weather {
  const table = state.region.climate.weather[season];
  const weights = WEATHERS.map((w) => (table[w] ?? 0) * (w === current ? 1.4 : 1));
  return state.rngWeather.weighted(WEATHERS, weights);
}

function recomputeDerived(state: SimState): void {
  const env = state.env;
  const cfg = state.config;
  const absHours = cfg.startHour + env.time / 3600;
  env.day = 1 + Math.floor(absHours / 24);
  env.timeOfDay = ((absHours % 24) + 24) % 24;
  env.dayPhase = dayPhaseOf(env.timeOfDay);

  const elapsedDays = env.time / 86400;
  const startIdx = SEASONS.indexOf(cfg.startSeason);
  const seasonFloat = cfg.daysPerSeason > 0 ? elapsedDays / cfg.daysPerSeason : 0;
  const idx = startIdx + Math.floor(seasonFloat);
  state.naturalSeason = SEASONS[((idx % 4) + 4) % 4];
  env.year = 1 + Math.floor(idx / 4);
  env.seasonProgress = seasonFloat - Math.floor(seasonFloat);
  env.season = state.overrides.season ?? state.naturalSeason;
  env.weather = state.overrides.weather ?? state.naturalWeather;

  const mean = state.region.climate.seasonalMeanC[env.season];
  const diurnal = Math.sin(((env.timeOfDay - 9) / 24) * Math.PI * 2) * (state.region.climate.diurnalRangeC / 2);
  const intensity = env.weatherIntensity;
  env.temperatureC = mean + diurnal + WEATHER_TEMP[env.weather] * (0.65 + 0.35 * intensity);

  const wobble = Math.sin(env.time * 0.00008) * 0.35;
  env.wind.direction = wrapAngle(state.region.wind.direction + wobble);
  env.wind.speed = state.region.wind.speed * WIND_MULT[env.weather] * (0.85 + 0.25 * intensity);

  const yf = yearFraction(env.season, env.seasonProgress);
  env.sun = sunPosition(env.timeOfDay, yf);
  const phase = ((yf * 365) / 29.530588) % 1;
  env.moon = { direction: moonPosition(env.timeOfDay, yf, phase).direction, phase };
}

/** Advance the world clock by `gameDt` game seconds and emit boundary events. */
export function updateEnvironment(state: SimState, gameDt: number): void {
  if (gameDt > 0) state.env.time += gameDt;
  // A coarse step can cross at most one weather boundary; loop a few times for safety.
  if (gameDt > 0) {
    for (let n = 0; n < 6 && state.env.time >= state.weatherUntil; n++) {
      const previous = state.naturalWeather;
      state.naturalWeather = pickWeather(state, state.naturalSeason, previous);
      const span = (3 + state.rngWeather.next() * 4.5) * 3600;
      state.weatherUntil = state.env.time + span;
      state.env.weatherIntensity = 0.4 + state.rngWeather.next() * 0.55;
      if (state.naturalWeather !== previous && !state.overrides.weather) {
        state.env.weather = state.naturalWeather;
        emit(
          state,
          'world.weather_changed',
          [],
          state.anchor,
          { from: previous, to: state.naturalWeather, temperature: round1(state.env.temperatureC) },
          0.4,
        );
      }
    }
  }
  const prevSeason = state.naturalSeason;
  const prevPhase = state.prevPhase;
  const prevDay = state.prevDay;
  const prevWeather = state.prevWeather;
  recomputeDerived(state);
  if (gameDt <= 0) {
    state.prevPhase = state.env.dayPhase;
    state.prevDay = state.env.day;
    state.prevSeason = state.naturalSeason;
    state.prevWeather = state.env.weather;
    return;
  }
  if (state.env.day !== prevDay) {
    emit(state, 'world.day_started', [], state.anchor, { day: state.env.day, season: state.env.season }, 0.35);
    if (state.huntDay !== state.env.day) {
      state.huntDay = state.env.day;
      state.huntsToday = 0;
    }
  }
  if (state.naturalSeason !== prevSeason) {
    emit(
      state,
      'world.season_changed',
      [],
      state.anchor,
      { from: prevSeason, to: state.naturalSeason, year: state.env.year },
      0.7,
    );
  }
  if (state.env.dayPhase !== prevPhase) {
    if (state.env.dayPhase === 'dawn') emit(state, 'world.dawn', [], state.anchor, { day: state.env.day }, 0.45);
    if (state.env.dayPhase === 'dusk') emit(state, 'world.dusk', [], state.anchor, { day: state.env.day }, 0.45);
  }
  if (state.env.weather !== prevWeather && state.overrides.weather == null) {
    // Natural transitions already emitted inside the weather loop. This catches
    // a change that recompute surfaced without a fresh roll (should be rare).
  }
  state.prevPhase = state.env.dayPhase;
  state.prevDay = state.env.day;
  state.prevSeason = state.naturalSeason;
  state.prevWeather = state.env.weather;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function applyOverrides(state: SimState): void {
  const beforeSeason = state.env.season;
  const beforeWeather = state.env.weather;
  recomputeDerived(state);
  state.prevSeason = state.naturalSeason;
  state.prevWeather = state.env.weather;
  state.prevPhase = state.env.dayPhase;
  emit(
    state,
    'world.override',
    [],
    state.anchor,
    {
      season: state.overrides.season,
      weather: state.overrides.weather,
      fromSeason: beforeSeason,
      fromWeather: beforeWeather,
      temperature: round1(state.env.temperatureC),
    },
    0.55,
  );
}
