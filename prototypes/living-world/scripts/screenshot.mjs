/**
 * Headless Chrome screenshot of a running page (WebGL via SwiftShader; no GPU needed).
 *
 * Usage:
 *   npm run shot -- --url "http://127.0.0.1:5173/lab/environment.html?hour=18" --out preview/env.png
 * Options:
 *   --width 1600 --height 900   viewport
 *   --wait 3000                 extra milliseconds after the page signals readiness
 *   --ready-timeout 120000      max wait for window.__LA_READY === true (falls back to load + wait)
 *   --eval "js expression"      run in the page after readiness, before the capture (repeatable)
 *   --frames 3                  capture N frames spaced --interval ms apart (out-1.png, out-2.png, ...)
 * Console errors and page exceptions are printed so failures are visible to agents.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const evals = args.flatMap((a, i) => (a === '--eval' && args[i + 1] ? [args[i + 1]] : []));
const url = opt('url', 'http://127.0.0.1:5173/');
const out = resolve(opt('out', 'preview/shot.png'));
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
const wait = Number(opt('wait', '2500'));
const readyTimeout = Number(opt('ready-timeout', '120000'));
const frames = Math.max(1, Number(opt('frames', '1')));
const interval = Number(opt('interval', '1000'));
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    `--window-size=${width},${height}`,
  ],
});
let failed = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warn' || process.env.SHOT_VERBOSE) console.log(`[page ${type}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    failed = true;
    console.log(`[page exception] ${err.message}`);
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  try {
    await page.waitForFunction('window.__LA_READY === true', { timeout: readyTimeout, polling: 250 });
    console.log(`ready after ${Date.now() - t0} ms`);
  } catch {
    console.log(`window.__LA_READY not set within ${readyTimeout} ms; capturing anyway`);
  }
  for (const code of evals) {
    const result = await page.evaluate(code);
    if (result !== undefined) console.log(`[eval] ${typeof result === 'string' ? result : JSON.stringify(result)}`);
  }
  await new Promise((r) => setTimeout(r, wait));
  mkdirSync(dirname(out), { recursive: true });
  for (let f = 1; f <= frames; f++) {
    const path = frames === 1 ? out : out.replace(/\.png$/, `-${f}.png`);
    await page.screenshot({ path, type: 'png' });
    console.log(`saved ${path}`);
    if (f < frames) await new Promise((r) => setTimeout(r, interval));
  }
} finally {
  await browser.close();
}
process.exit(failed ? 2 : 0);
