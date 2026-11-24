# Project Status

Last updated: 2026-11-24

## What exists now

### Browser prototype (reference only)
- A single-page HTML/CSS/JavaScript prototype exists at `prototypes/browser-demo/index.html`.
- It contains a 35-species catalogue and a seeded demo population of 148 agents.
- It defines five biome views and a Japanese bestiary / observation UI.
- It includes simplified needs and action state updates (e.g. hunger, energy, thirst, stress, social need), a time/season/weather presentation, action logs, creature selection and filtering.
- Five short generated storyboard-style GIF scenes were used as environment/action media in the local demo package.

### What this prototype is NOT
- It is not the production Unreal Engine 5 implementation.
- It does not implement independently rigged 3D anatomy per creature.
- It does not yet provide physically grounded paired interaction animations, true collision/contact, IK locomotion, or synchronized fighting.
- Predation, reproduction and population behavior in the browser prototype are simplified demo logic, not a validated ecological model.
- The five scene GIFs are not equivalent to continuous, independently animated 3D individuals.
- No performance testing for hundreds of full 3D skeletal agents has been completed.

### Repository packaging status
- HTML source is included.
- Required GIF assets are listed in [ASSET_MANIFEST.md](../prototypes/browser-demo/ASSET_MANIFEST.md), but are not yet committed here. The browser prototype will not render its intended scenes until those assets are added.
- Production UE5 project, C++ modules, skeletal assets, animation sets, and save-game system have not yet been committed.

## Immediate next steps
1. Add prototype media assets and verify the browser package runs from a clean clone.
2. Establish the UE5 project skeleton and CI / build documentation.
3. Implement deterministic world bootstrap and save/restore.
4. Define species data schema and a small vertical slice (3 species, one habitat).
5. Build creature rigs and locomotion before expanding population count.
6. Implement pairwise social interaction coordination and event history.
7. Validate predator-prey, reproduction, seasonal response, and offline catch-up.

## Definition of “done”
A feature is done only when source, assets, setup steps, and a reproducible test are committed. Mockups and generated images are art direction references, not proof of implemented runtime functionality.
