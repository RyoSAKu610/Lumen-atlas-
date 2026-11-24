# LIVING ATLAS — 幻生図鑑

> **Build a world, not a sequence of animations.**

A persistent wildlife ecosystem where original creatures live, interact, learn, reproduce, migrate, compete, and adapt without player direction. The player's primary role is to observe, discover, document, and understand a world that existed before they arrived and continues after they leave.

**Repository:** https://github.com/RyoSAKu610/Lumen-atlas-

## Start here
- [Project status](docs/PROJECT_STATUS.md) — what exists, what is only a prototype, and what remains incomplete.
- [Art direction & world bible](docs/ART_DIRECTION.md) — visual language, original creature rules, and Japan × fantasy direction.
- [Technical architecture](docs/TECHNICAL_ARCHITECTURE.md) — UE5 system boundaries, bootstrap, AI, interactions, and persistence.
- [Multi-AI collaboration](docs/AI_COLLABORATION.md) — specialist roles, ownership, branch/PR protocol, and hand-off format.
- [Roadmap](docs/ROADMAP.md) — vertical-slice milestones and acceptance order.
- [English master prompt](prompts/MASTER_PROMPT_EN.md) — unified project-level instructions for coding agents.
- [Prototype asset manifest](prototypes/browser-demo/ASSET_MANIFEST.md) — local media required by the browser reference.

## Current implementation status
This repository is the collaboration source of truth for project specifications and prototypes. The browser reference prototype is **not** the production Unreal Engine 5 game.

Current reference prototype:
- 35 species entries and a seeded demo population of 148 individual agents.
- Five habitat views, creature selection / filtering, simplified needs and action state updates.
- Time, season, weather presentation and an observation event log.
- Storyboard-style environment/action GIFs in the locally generated demo package.

Not yet implemented or validated in the production sense:
- Independent 3D skeletal rigs and locomotion for each anatomical creature family.
- Synchronized paired/group interaction animation with physical contact, IK and interruption.
- Full predator-prey, breeding, development, and resource ecology.
- UE5 bootstrap, scalable simulation LOD, save/restore and deterministic offline catch-up.

See [PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for the exact boundary between prototype behavior and production requirements.

## World structure
The initial five fantasy ecosystems are:
1. Blossom Valley — flowered river valleys, cliffs, waterfalls, and geothermal springs.
2. Ancient Canopy — layered primeval forest and arboreal ecosystems.
3. Abyssal Kingdom — bioluminescent deep ocean, ruins, and migrating megafauna.
4. Ember Basin — volcanic terrain, mineral deposits, and hot geothermal zones.
5. Floating Highlands — aerial ecosystems, cloud forests, and wind corridors.

The Japan × fantasy program begins with research-based regional modules for Kusatsu, Noboribetsu, Beppu, Hakone, and Yufuin. Real geography and fictional ecological additions must be clearly distinguished.

## Target stack
Unreal Engine 5, C++ core systems, StateTree / Behavior Trees + Utility AI, Skeletal Meshes, Animation Blueprints, IK Rig / Control Rig, Niagara, World Partition / streaming, and Nanite / Lumen where appropriate.

## Collaboration rules
- Work in focused branches: `feat/<workstream>-<topic>`, `art/<topic>`, `fix/<topic>`, `docs/<topic>`.
- Open a pull request for each logical unit; do not push feature work directly to `main`.
- Read the architecture and AI collaboration contract before changing shared systems.
- Keep each specialist's ownership clear and coordinate interface changes.
- Generated concept art is a reference, not evidence that a runtime feature exists.
- No feature is complete until code/assets, setup instructions, and reproducible tests are included.

See [docs/AI_COLLABORATION.md](docs/AI_COLLABORATION.md) to choose a workstream and begin contributing.
