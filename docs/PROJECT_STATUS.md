# Project Status

Last updated: 2026-11-24

## What exists now

### Browser visual prototype (reference only)
- A single-page HTML/CSS/JavaScript prototype exists at `prototypes/browser-demo/index.html`.
- It contains a 35-species catalogue and a seeded demo population of 148 agents.
- It defines five biome views, creature selection / filtering, simplified needs and action state updates, plus time / season / weather presentation and an observation event log.
- Storyboard-style GIF scenes exist in the locally generated demo package, but the five media assets are not yet committed to this repository. The browser prototype is not self-contained until they are added.

### Executable Python reference simulation
Location: `simulation/reference_ecology/`

- Five data-driven species and nine seeded demo individuals.
- Individual needs, parent / offspring kin recognition and juvenile guardian following.
- Familiar greeting versus unfamiliar assessment, with pair-event de-duplication.
- Predator threat detection, prey flee, predator stalking and success / injury / failure outcomes.
- Resource-driven territorial warning displays and dominance conflict / retreat.
- Food and freshwater consumption, plus geothermal spring affinity, capacity and waiting behavior.
- Paired interaction coordinator for greeting, play, grooming, warning and conflict. It models observe / signal / response / approach / contact / resolve / cooldown / separate phases, participant locks, refusal, interruption, recovery, consequences and active-state serialization.
- One-command scripts for macOS/Linux and Windows PowerShell.
- **21 automated scenario tests passed** locally and in GitHub Actions on Python 3.11. The CI job also completed a seeded 180-minute smoke simulation with all nine demo individuals alive.

Run it with:
- macOS / Linux: `cd simulation/reference_ecology && bash scripts/run_reference_demo.sh`
- Windows PowerShell: `cd simulation/reference_ecology; .\scripts\run_reference_demo.ps1`

### Art direction and collaboration
- Shared visual direction, first five-species roster and body-language / paired-interaction art briefs are in the draft Art Direction PR.
- AI workstream roles, English prompts, branch protocol and technical hand-off templates are committed.

## What is not yet production-complete

- No production Unreal Engine 5 project or C++ runtime has been committed.
- Python movement is 2D point navigation, not UE5 locomotion, collision, Navigation Mesh, IK or skeletal animation.
- The InteractionCoordinator is a state / event reference. It does not play actual Animation Blueprint clips, synchronize root motion, validate contact sockets, or prove that two creatures physically interact in-engine.
- Full mating, birth / hatching, development, aging, migration, vegetation regrowth, carrying capacity and long-duration ecological stability are not implemented / validated yet.
- The reference model is a simplified test harness, not a scientifically validated ecology.
- No performance testing for hundreds of full 3D skeletal agents has been completed.

## Immediate next steps
1. Commit the five browser prototype GIF assets and verify a clean-clone launch.
2. Build the production UE5 project skeleton and WorldBootstrap using the Python scenarios as a behavior reference.
3. Create the first three distinct creature rigs and locomotion sets.
4. Connect the InteractionCoordinator phases to real paired animations, sync markers, contact sockets and safe interrupts.
5. Port AI perception / needs / social memory into UE5 Utility AI + StateTree.
6. Extend ecological simulation with courtship, birth, parental care, growth, resources, migration and long-run balance.
7. Build and fact-check the first Japanese geothermal region.

## Definition of done
A feature is done only when source, required assets, setup steps and a reproducible test are committed. A reference model or generated image is not proof that a production runtime feature exists.
