import './shell.css';
import type { GameData } from '../data/schema';
import type { Season, Weather } from '../sim/ids';
import type { AgentId } from '../sim/types';
import type { DossierModel } from '../observe/dossier';

export interface ClockReadout {
  day: number;
  clock: string;
  season: string;
  weather: string;
  temp: string;
  speed: string;
}

export interface JournalLine {
  time: string;
  text: string;
}

export interface RosterEntry {
  id: AgentId;
  label: string;
  detail: string;
}

export interface Shell {
  viewport: HTMLElement;
  setClock(readout: ClockReadout): void;
  setShot(name: string): void;
  setStatus(text: string | null): void;
  pushJournal(line: JournalLine): void;
  setDossier(model: DossierModel | null): void;
  setRoster(entries: RosterEntry[]): void;
  onSpeed(cb: (speed: number) => void): void;
  onSeason(cb: (season: Season | null) => void): void;
  onWeather(cb: (weather: Weather | null) => void): void;
  onSelect(cb: (id: AgentId | null) => void): void;
}

const SPEEDS = [
  ['静止', 0],
  ['1×', 1],
  ['4×', 4],
  ['20×', 20],
] as const;

const SEASON_BUTTONS: [string, Season | null][] = [
  ['季節', null],
  ['春', 'spring'],
  ['夏', 'summer'],
  ['秋', 'autumn'],
  ['冬', 'winter'],
];

const WEATHER_BUTTONS: [string, Weather | null][] = [
  ['天候', null],
  ['晴', 'clear'],
  ['曇', 'cloudy'],
  ['雨', 'rain'],
  ['霧', 'fog'],
  ['雪', 'snow'],
  ['嵐', 'storm'],
];

export function mountShell(root: HTMLElement, data: GameData): Shell {
  const ui = data.art.ui;
  root.style.setProperty('--ink', ui.ink);
  root.style.setProperty('--paper', ui.paper);
  root.style.setProperty('--paper-dim', hexAlpha(ui.paper, 0.9));
  root.style.setProperty('--accent', ui.accent);
  root.style.setProperty('--calm', ui.calm);
  root.style.setProperty('--danger', ui.danger);
  root.style.setProperty('--display', ui.displayFont);
  root.style.setProperty('--body', ui.bodyFont);
  root.replaceChildren();

  const viewport = el('div', 'la-viewport');
  const dawn = data.art.lighting.find((key) => key.hour >= 5.5) ?? data.art.lighting[0];
  if (dawn) viewport.style.background = `linear-gradient(${dawn.skyZenith}, ${dawn.skyHorizon})`;

  const clock = el('section', 'la-panel la-clock');
  clock.innerHTML = `<p class="la-kicker">LIVING ATLAS</p><h1 class="la-title">${data.region.name.ja}</h1><p class="la-meta"></p><p class="la-shot"></p>`;
  const meta = clock.querySelector('.la-meta') as HTMLElement;
  const shot = clock.querySelector('.la-shot') as HTMLElement;

  const status = el('p', 'la-panel la-status');
  status.hidden = true;

  const journal = el('section', 'la-panel la-journal');
  journal.innerHTML = '<h2>観察記</h2>';
  const journalList = el('div', 'la-entries');
  journal.append(journalList);

  const dossier = el('section', 'la-panel la-dossier');
  dossier.hidden = true;

  const roster = el('section', 'la-panel la-roster');
  roster.hidden = true;
  const controls = el('section', 'la-panel la-controls');
  root.append(viewport, clock, status, journal, dossier, roster, controls);

  let speedCb: (speed: number) => void = () => {};
  let seasonCb: (season: Season | null) => void = () => {};
  let weatherCb: (weather: Weather | null) => void = () => {};
  let selectCb: (id: AgentId | null) => void = () => {};

  const speedButtons = buttonRow(SPEEDS, '1×', (value) => speedCb(value));
  const seasonButtons = buttonRow(SEASON_BUTTONS, '季節', (value) => seasonCb(value));
  const weatherButtons = buttonRow(WEATHER_BUTTONS, '天候', (value) => weatherCb(value));
  controls.append(speedButtons, seasonButtons, weatherButtons);

  const journalLines: HTMLElement[] = [];

  return {
    viewport,
    setClock(readout) {
      meta.textContent = `${readout.day}日目 ${readout.clock} · ${readout.season} · ${readout.weather} · ${readout.temp} · ${readout.speed}`;
    },
    setShot(name) {
      shot.textContent = name;
    },
    setStatus(text) {
      status.hidden = !text;
      status.textContent = text ?? '';
    },
    pushJournal(line) {
      const row = el('p', 'la-entry');
      row.innerHTML = `<time>${escapeHtml(line.time)}</time>${escapeHtml(line.text)}`;
      journalList.prepend(row);
      journalLines.push(row);
      while (journalLines.length > 40) journalLines.shift()?.remove();
    },
    setDossier(model) {
      dossier.classList.toggle('open', model !== null);
      if (!model) {
        dossier.hidden = true;
        dossier.replaceChildren();
        return;
      }
      dossier.hidden = false;
      const needs = model.needs
        .map((need) => {
          const warn = need.urgency ? need.value > 0.65 : need.value < 0.35;
          return `<div class="la-need"><span>${escapeHtml(need.label)}</span><div class="la-track"><div class="la-fill${warn ? ' warn' : ''}" style="width:${Math.round(need.value * 100)}%"></div></div><span>${need.value.toFixed(2)}</span></div>`;
        })
        .join('');
      dossier.innerHTML = `<h2>個体</h2><h3>${escapeHtml(model.name)}</h3><p class="la-sub">${escapeHtml(model.species)} · ${escapeHtml(model.line)}</p><p class="la-phrase">${escapeHtml(model.phrase)}</p>${needs}<ul class="la-why">${model.why.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul><ul class="la-rel">${model.relations.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul><button type="button" class="la-release">観察を戻す</button>`;
      dossier.querySelector('.la-release')?.addEventListener('click', () => selectCb(null));
    },
    setRoster(entries) {
      roster.replaceChildren();
      roster.hidden = entries.length === 0;
      for (const entry of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${entry.label} · ${entry.detail}`;
        button.addEventListener('click', () => selectCb(entry.id));
        roster.append(button);
      }
    },
    onSpeed(cb) {
      speedCb = cb;
    },
    onSeason(cb) {
      seasonCb = cb;
    },
    onWeather(cb) {
      weatherCb = cb;
    },
    onSelect(cb) {
      selectCb = cb;
    },
  };
}

function buttonRow<T>(items: readonly (readonly [string, T])[], pressedLabel: string, onPick: (value: T) => void): HTMLElement {
  const wrap = el('div', 'la-row');
  const buttons: HTMLButtonElement[] = [];
  for (const [label, value] of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', label === pressedLabel ? 'true' : 'false');
    button.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      onPick(value);
    });
    buttons.push(button);
    wrap.append(button);
  }
  return wrap;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}
