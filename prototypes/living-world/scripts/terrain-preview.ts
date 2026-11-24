/**
 * Render a top-down hill-shaded preview of the region terrain (no WebGL needed).
 * Usage: npm run terrain:preview -- [--seed 1234] [--out preview/terrain.png] [--scale 3]
 * Writes the shaded map plus a legend of landmarks/pools/spawns to stdout.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { loadGameDataOrThrow } from '../src/data/load';
import { SURFACE_KINDS, type SurfaceKind } from '../src/sim/ids';
import { Terrain } from '../src/sim/terrain';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const seed = Number(arg('seed', '20261124'));
const out = resolve(arg('out', 'preview/terrain.png'));
const scale = Math.max(1, Math.min(6, Number(arg('scale', '3'))));

const data = loadGameDataOrThrow();
const t0 = performance.now();
const terrain = Terrain.build(data.region, seed);
const buildMs = performance.now() - t0;

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const pal = data.art.terrain;
const water = data.art.water;
const SURFACE_COLOR: Record<SurfaceKind, [number, number, number]> = {
  meadow: hex(pal.meadow),
  flower_field: [196, 170, 120],
  sakura_grove: [214, 160, 180],
  cedar_forest: [44, 74, 52],
  maple_wood: [150, 96, 60],
  reed_marsh: hex(pal.marsh),
  moss_rocks: hex(pal.moss),
  rock: hex(pal.rock),
  cliff: hex(pal.cliff),
  sinter: hex(pal.sinter),
  riverbed: hex(pal.riverbed),
  river: hex(water.shallow),
  pool: hex(water.deep),
  hot_spring: hex(water.hotSpringShallow),
};

const res = terrain.res;
const W = (res - 1) * scale;
const png = new PNG({ width: W, height: W });
const light = (() => {
  const v = [-0.5, 0.8, -0.35];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / l);
})();
let minH = Infinity;
let maxH = -Infinity;
for (const h of terrain.heights) {
  minH = Math.min(minH, h);
  maxH = Math.max(maxH, h);
}

for (let py = 0; py < W; py++) {
  for (let px = 0; px < W; px++) {
    const x = -terrain.half + (px / W) * terrain.size;
    const z = -terrain.half + (py / W) * terrain.size;
    const kind = terrain.surfaceAt(x, z);
    const n = terrain.normalAt(x, z);
    const shade = Math.max(0.25, n.x * light[0] + n.y * light[1] + n.z * light[2]);
    const h = terrain.heightAt(x, z);
    const alt = 0.85 + 0.3 * ((h - minH) / (maxH - minH || 1));
    let [r, g, b] = SURFACE_COLOR[kind];
    const isWater = kind === 'river' || kind === 'pool' || kind === 'hot_spring';
    const k = isWater ? 1 : shade * alt;
    r = Math.min(255, r * k);
    g = Math.min(255, g * k);
    b = Math.min(255, b * k);
    const o = (py * W + px) * 4;
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = 255;
  }
}

const dot = (x: number, z: number, radiusM: number, color: [number, number, number], ring = false) => {
  const cx = ((x + terrain.half) / terrain.size) * W;
  const cy = ((z + terrain.half) / terrain.size) * W;
  const rp = Math.max(2, (radiusM / terrain.size) * W);
  for (let py = Math.floor(cy - rp - 2); py <= cy + rp + 2; py++) {
    for (let px = Math.floor(cx - rp - 2); px <= cx + rp + 2; px++) {
      if (px < 0 || py < 0 || px >= W || py >= W) continue;
      const d = Math.hypot(px - cx, py - cy);
      if (ring ? Math.abs(d - rp) > 1.2 : d > rp) continue;
      const o = (py * W + px) * 4;
      png.data[o] = color[0];
      png.data[o + 1] = color[1];
      png.data[o + 2] = color[2];
    }
  }
};

for (const tr of terrain.trees) {
  const c: [number, number, number] = tr.kind === 'sakura' ? [250, 190, 210] : tr.kind === 'maple' ? [200, 90, 50] : tr.kind === 'pine' ? [30, 70, 50] : [24, 52, 34];
  dot(tr.x, tr.z, Math.max(0.8, tr.canopyRadius * 0.45), c);
}
for (const lm of terrain.landmarks.values()) dot(lm.x, lm.z, lm.radius, [255, 220, 90], true);
for (const p of terrain.pools) dot(p.x, p.z, p.radius + 1.5, [255, 255, 255], true);
for (const wf of terrain.waterfalls) dot(wf.top.x, wf.top.z, 3, [255, 255, 255]);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, PNG.sync.write(png));

const counts = new Map<string, number>();
for (const s of terrain.surface) counts.set(SURFACE_KINDS[s], (counts.get(SURFACE_KINDS[s]) ?? 0) + 1);
const total = terrain.surface.length;
console.log(`Terrain ${data.region.id} seed=${seed} built in ${buildMs.toFixed(0)} ms → ${out} (${W}×${W}px, north = top, +X = right)`);
console.log(`Height range ${minH.toFixed(1)} .. ${maxH.toFixed(1)} m; trees ${terrain.trees.length}; rocks ${terrain.rocks.length}; waterfalls ${terrain.waterfalls.length}`);
console.log('Surface coverage:', [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v / total) * 100).toFixed(1)}%`).join(', '));
for (const p of terrain.pools) console.log(`  pool ${p.id} (${p.kind}) at [${p.x}, ${p.z}] r=${p.radius} surfaceY=${p.surfaceY.toFixed(1)}`);
for (const lm of terrain.landmarks.values()) console.log(`  landmark ${lm.id} (${lm.kind}) at [${lm.x}, ${lm.z}] y=${lm.y.toFixed(1)} surface=${terrain.surfaceAt(lm.x, lm.z)}`);
for (const wf of terrain.waterfalls) console.log(`  waterfall drop ${(wf.top.y - wf.bottom.y).toFixed(1)} m at [${wf.top.x.toFixed(0)}, ${wf.top.z.toFixed(0)}]`);
for (const s of data.region.spawns) console.log(`  spawn ${s.count}× ${s.speciesId} near ${s.near}`);
