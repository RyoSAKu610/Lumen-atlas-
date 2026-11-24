# Technical Architecture — Target Design

## Runtime target
Unreal Engine 5 desktop application. The current HTML prototype is a temporary reference, not the production runtime.

## Core modules
- **WorldBootstrap** — validates configuration, loads species/habitat definitions, prepares critical assets, restores saves, runs offline catch-up, and starts simulation.
- **WorldState** — authoritative world clock, season, weather, resources, habitat condition and region metadata.
- **CreatureIdentity** — persistent IDs, species, age, sex, family links and life stage.
- **CreatureNeeds** — hunger, thirst, energy, stress, health, thermal comfort, curiosity and social drive.
- **Perception** — sight, hearing, scent, threat detection, environmental awareness and remembered locations.
- **DecisionAI** — Utility AI for competing needs plus StateTree / Behavior Trees for structured behavior.
- **SocialGraph** — familiarity, kinship, trust, affection, dominance, rivalry, fear and cooperation.
- **InteractionCoordinator** — reserves interaction partners, selects compatible paired/group animation, synchronizes phases, validates distance/contact, resolves interruption and outcome.
- **PredatorPrey** — detection, stalking, chase, escape, herd defense, attack resolution, feeding and recovery.
- **LifeCycle** — courtship, nesting, breeding, pregnancy/eggs, birth/hatching, parental care, growth, aging and death.
- **Ecology** — food web, vegetation, water, mineral / geothermal resources, migration pressure, population and carrying capacity.
- **Persistence** — versioned snapshots, deterministic event records, checkpoints and migration.
- **Observation** — camera, tracking, species dossier, field journal, timelines and event replay.

## Simulation levels
1. **Near field:** full perception, Utility AI, social interaction, animation, IK and physical contact.
2. **Mid field:** reduced decision frequency, simplified perception and animation LOD.
3. **Far field:** aggregate populations, resources, migration and event simulation.
4. **Offline catch-up:** deterministic time-step / event resolution using saved state and elapsed wall-clock time. The app does not execute while closed; it computes the elapsed interval on next launch.

## One-click bootstrap sequence
1. Validate project version, config and required assets.
2. Load species, biome, climate, behavior and animation metadata.
3. Mount active-region high-priority assets; prepare other regions through streaming.
4. Restore versioned world snapshot and event journal.
5. Compute offline progression and reconcile major events.
6. Initialize world clock, weather, resource fields and regional population state.
7. Spawn / restore active-region agents and establish perception & social references.
8. Start simulation only after critical dependencies pass validation.
9. Present a real progress state and actionable recovery diagnostics on failure.

Do not preload every maximum-resolution mesh and texture into RAM. Preload definitions and critical shared assets; stream high-cost geometry, textures and distant detail by observation region.

## Interaction state machine
Suggested lifecycle: `Approach → Orient → Signal → Response → Contact / Action → Resolve → Cooldown → Separate`.
Support interrupts such as fear, pain, threat, resource loss, partner departure, weather hazard or fatigue. Both participants must have compatible animation phases and a shared outcome.

## Persistence and determinism
- Persistent unique creature IDs.
- Versioned snapshots plus append-only world event journal.
- Seeded random streams per region / simulation subsystem.
- Save transaction and recovery checkpoint.
- Explicit simulation catch-up limits and batching for long offline periods.
- Record uncertainty / approximation for long time skips instead of pretending to reproduce every frame.

## Data model
Species profiles should be data-driven and include morphology, locomotion family, diet, habitat tolerance, sensory profile, social model, reproduction, animation set, and ecological role. Individual state should reference a species profile and contain needs, health, memories, relationships, history and current intent.

## Performance
Use simulation LOD, bounded perception queries, spatial partitioning, event-driven updates, pooled actors, animation budgets and profiling. Never silently disable essential ecology to reach a target frame rate.
