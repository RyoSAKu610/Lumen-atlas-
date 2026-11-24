# Art and Asset Pipeline

## Creative ownership
ChatGPT is the creative / art-direction owner. The implementation / technical-art contributors own importing, rigging, shader setup, optimization and engine integration.

## Required source package for every creature
- Creature ID and species profile.
- Front / side / rear orthographic design.
- Three-quarter hero view.
- Silhouette read at thumbnail size.
- Scale reference against another species and terrain.
- Material sheet (skin, fur, feathers, shell, crystals, eyes, emissive areas).
- Anatomy notes: joints, spine, limb count, wing structure, tail, head / jaw, sensory organs.
- Locomotion family and center-of-mass notes.
- Behavior reference list.
- Color and value range.
- Asset provenance and intended usage.

## Required environment package
- 16:9 establishing composition.
- Terrain / elevation reference.
- Vegetation, water, weather and geological callouts.
- Day / dusk / night lighting directions.
- Landmark reference and factual / fictional annotation.
- Species distribution and resource zones.
- Gameplay camera viewpoints.
- Engine export and texture budget.

## Animation brief format
Describe:
1. Motivation / trigger.
2. Preparation and anticipation.
3. Main action.
4. Contact / interaction points.
5. Reaction from the other participant.
6. Follow-through and recovery.
7. Interrupt conditions.
8. Exit behavior.

Avoid "looping idle" as the only behavior. Social animation must account for both participants and contact.

## Naming
Use stable IDs: `BIO_<biome>_<species>`, `CR_<species>_<asset>`, `AN_<species-or-family>_<action>`, `ENV_<region>_<variant>`.

## Technical handoff
Document resolution, format, color space, normal map convention, alpha, pivot, scale, skeleton / retarget family, root-motion expectation, animation markers, collision expectations, and LODs.
