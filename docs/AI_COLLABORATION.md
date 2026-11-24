# Multi-AI Collaboration Protocol

## Goal
Use multiple AI assistants as specialist contributors while keeping one coherent architecture, visual language and source of truth. Assign work by demonstrated strength, not by brand name alone. All contributors must read this repository before editing.

## Workstream roles

| Workstream | Primary responsibility | Deliverables |
|---|---|---|
| **Creative Director — ChatGPT** | Visual direction, world tone, creature concepts, art prompts, visual critique, shot composition, Japanese landscape/fantasy blending | Art bible, concept briefs, creature sheets, environment briefs, animation reference briefs |
| **UE5 Core Engineer** | C++ project structure, bootstrap, save/load, world clock, subsystem boundaries, build pipeline | Compilable modules, architecture decisions, automated tests |
| **Creature AI Engineer** | Needs, perception, Utility AI, StateTree, memory, decision scoring | AI components, tuning data, decision debug view |
| **Animation / Character TD** | Skeleton families, rigs, Control Rig, IK, locomotion, paired/group interaction clips | Rig specifications, animation assets, interaction coordinator integration |
| **Ecology Simulation Engineer** | Food web, population, resources, migration, breeding, growth, mortality, offline catch-up | Deterministic simulation model, balance tests, event records |
| **Japan Environment Research / World Artist** | Real location research, terrain references, climate, vegetation, geothermal behavior, environment art | Factual reference packs, region briefs, playable graybox and final environment assets |
| **QA / Performance Engineer** | Test plans, reproducible scenarios, profiling, performance regressions, save corruption tests | Test reports, bug issues, performance captures |

ChatGPT's agreed ownership is **art direction and visual nuance**. It may review implementation and suggest changes, but should not silently rewrite core engineering modules owned by another contributor.

## Branch and PR protocol
- Branch names: `feat/<workstream>-<topic>`, `art/<topic>`, `fix/<topic>`, `docs/<topic>`.
- One task / one logical change per branch.
- Open a PR with: purpose, scope, touched modules, test steps, screenshots / captures, known limitations.
- No direct commits to `main` for feature work.
- Do not edit another workstream's owned files without coordination.
- All cross-system interfaces must be documented before parallel implementation.
- Do not merge untested code or mockups presented as finished systems.

## Shared contracts
- Stable IDs for species, individuals, regions, animations and events.
- Data-driven species profiles; never hard-code species-specific logic into shared controllers.
- Explicit ownership of C++ modules and asset folders.
- Versioned data schemas and migration rules.
- Animation interaction contracts specify participants, root motion, sync markers, contact points, interruption and recovery.
- Every feature has acceptance criteria and a reproducible test.

## AI hand-off template
1. Read README, status, architecture and relevant issue.
2. State assumptions and files to be changed.
3. Implement only the assigned scope.
4. Run available tests and report exact commands/results.
5. List incomplete work and integration risks.
6. Open a PR; do not claim success without evidence.

## Collaboration safety
Never expose secrets or credentials in prompts or commits. Do not overwrite another agent's work. Avoid duplicate tasks by checking open issues and branches first. Generated art must include source/provenance notes and must be checked for accidental text, UI artifacts, or franchise similarity.
