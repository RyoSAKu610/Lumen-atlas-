# Roadmap

## Phase 0 — Collaboration foundation
- [x] Identify the existing GitHub repository and establish it as the project home.
- [x] Commit initial vision, status, architecture, AI workstreams and roadmap.
- [ ] Add the browser prototype's GIF assets and verify a clean-clone launch.
- [ ] Add issue templates, labels and branch protection.\n- [x] Add Python reference ecology model, paired interaction coordinator, 21 tests and GitHub Actions CI.
- [ ] Decide UE5 version, source-control strategy for large binary assets, and target hardware baseline.

## Phase 1 — First real UE5 vertical slice
Scope: one compact valley, 3 species, 20–30 individuals.
- [ ] Create UE5 project and module skeleton.\n- [ ] Port the tested Python interaction and ecology contracts into UE5 C++ / StateTree; do not carry over 2D movement as final locomotion.
- [ ] Implement one-click WorldBootstrap and versioned save/restore.
- [ ] Implement CreatureIdentity, Needs and world clock.
- [ ] Create one rigged quadruped, one small social species and one predator.
- [ ] Implement high-quality walk / run / idle / eat / rest animations with IK.
- [ ] Implement one paired greeting and one playful interaction with synchronized contact.
- [ ] Add a basic food-web and resource loop.
- [ ] Verify save, reload and offline catch-up.

## Phase 2 — Social ecology
- [ ] Social graph and relationship memory.
- [ ] Greeting, grooming, play, avoidance, warning, dominance and conflict.
- [ ] Coordinated fighting / escape / herd defense.
- [ ] Parent-offspring recognition and juvenile learning.
- [ ] Observation log and interaction replay.

## Phase 3 — Life cycles and ecological consequences
- [ ] Breeding, nests / eggs or live birth per species profile.
- [ ] Parental care, growth stages, aging and death.
- [ ] Vegetation, water, geothermal resources and carrying capacity.
- [ ] Seasonal migration, predator-prey balance and population feedback.
- [ ] Long-duration stability and edge-case tests.

## Phase 4 — Japanese regional worlds
- [ ] Research pack: Kusatsu.
- [ ] Research pack: Noboribetsu.
- [ ] Research pack: Beppu.
- [ ] Research pack: Hakone.
- [ ] Research pack: Yufuin.
- [ ] Build one authentic geothermal region as a playable biome.
- [ ] Introduce modular regional packages for later prefectures.

## Phase 5 — Five major fantasy biomes
- [ ] Blossom Valley.
- [ ] Ancient Canopy.
- [ ] Abyssal Kingdom.
- [ ] Ember Basin.
- [ ] Floating Highlands.

## Phase 6 — Scale, polish and release
- [ ] Hundreds of individuals with simulation LOD.
- [ ] High-fidelity creature families and interaction animation library.
- [ ] Rich observation tools and photo / field journal systems.
- [ ] Full performance, persistence and accessibility pass.
- [ ] Reproducible release build and documentation.
