# LIVING ATLAS — Yugasumi Valley Runtime Prototype

This package is the first running **Three.js / WebGL vertical slice** for the fictional Yugasumi Valley. It is a playable software prototype, not the final Unreal Engine 5 production game.

## Requirements
- Node.js 22+
- npm
- A desktop browser with WebGL 2 support
- No headless browser is required to run the project.

## Run locally

```bash
cd prototypes/living-world
npm ci
npm run dev
```

Open the local Vite URL shown in the terminal.

## What is implemented
- Deterministic fixed-step ecology simulation with individual IDs, needs, utility decisions and memory.
- Four species profiles: Mossmantle Colossus, Reedbrush Kit, Duskcleft Stalker and Vaporwheel Glider.
- Terrain height field, meadow / forest / river surfaces, waterfalls, hot springs and landmarks.
- WebGL environment renderer with sky, time-of-day lighting, seasonal grade, weather, foliage, water, steam and particles.
- Procedural skinned creature templates with species-driven morphology, skeleton bones, terrain-aware two-bone IK, gait, posture, flight and paired social expression.
- Greeting, grooming, play, warning and conflict interaction state coordination; predator stalking / chase / herd defense.
- Observation camera, event journal, individual dossier, season / weather and simulation-speed controls.
- Versioned local browser save / restore and offline catch-up, with deterministic simulation snapshots.

## Important implementation boundaries
- Creature bodies are procedural skinned meshes generated from the species morphology data. They are not hand-sculpted production meshes or motion-captured animation clips.
- The animation layer is procedural skeletal posing with IK and shared interaction phase clocks. It is not yet a full authored animation library with per-species mocap-quality clips.
- Offline progression is computed when the app opens; the browser does not run the simulation while closed.
- The ecology is a deterministic game model for this fictional world, not a scientifically validated ecosystem.
- This package is not an Unreal Engine 5 project.

## Persistence behavior
- Saves are region-scoped in browser local storage.
- Snapshot schema and storage-envelope versions are separate.
- The simulation's own snapshot checksum is verified during restore.
- Autosave occurs every 15 seconds, on tab hide / page hide, and during orderly app teardown.
- On return, elapsed wall-clock time is converted to game time and processed using coarse approximate catch-up.
- Offline catch-up is bounded by the simulation configuration. Very long absences are capped and reported.
- If storage is blocked, full, incompatible or corrupt, the scene falls back to a fresh in-memory world instead of crashing.

The saved seed is authoritative on restore, so simulation terrain and rendered terrain share the exact same height / water field.

## Validation

```bash
npm ci
npm run typecheck
npm test
npm run validate:data
npm run build
npm run simulate -- --days 3 --seed 20261126
npm run bench
```

GitHub Actions runs these checks for pull requests and relevant pushes. Tests verify logic and data contracts; they do not replace manual visual inspection of a WebGL scene.

## Useful debug URL parameters
- `?quality=low` — reduce renderer antialiasing / pixel ratio.
- `?quality=high` — use higher device pixel ratio (capped).
- `?seed=1234` — choose a reproducible new-world seed (ignored when restoring an existing save).
- `?hour=17.5` — choose the initial world hour for a new world.

## Controls
- Pause / speed: stop, 1×, 4×, 20×.
- Season: use the season buttons to override the current season.
- Weather: use the weather buttons to override current weather.
- Select a creature in the roster or click its body to follow and inspect it.
- Click the release control in the dossier to return to the wide documentary camera.
