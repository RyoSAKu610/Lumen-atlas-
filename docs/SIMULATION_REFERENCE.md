# Reference Simulation: What It Proves and What It Does Not

The Python reference model is an executable contract for early systems design. It is intentionally small and dependency-free so contributors can run deterministic scenarios before the production Unreal Engine 5 runtime exists.

## Verified behaviors in v0.1
- Species profiles are loaded from a JSON catalog.
- Individual agents maintain needs, relationship values, memories and guardian links.
- A familiar pair greets once per tick; unfamiliar peers assess one another.
- Parent / offspring kinship is recognized from parent IDs.
- A dependent juvenile moves toward a separated guardian.
- Prey flees when it detects a nearby predator.
- Hungry predators stalk prey and resolve success / injury / failure outcomes.
- Territorial challenges require resource pressure or high hunger; they may resolve as warning displays or dominance conflict with retreat.
- Hungry herbivores consume matching resources; thirsty individuals consume freshwater.
- Cold-sensitive species seek geothermal pools, and pool occupancy is capacity-limited.
- Seeded simulation, JSON snapshot / restore and offline catch-up are deterministic in tested scenarios.
- A paired interaction coordinator owns greeting / play / grooming / warning / conflict phase sequences, participant locks, consent checks, interruption and recovery; active coordinator state can be serialized.
- A paired interaction coordinator owns greeting / play / grooming / warning / conflict phase sequences, pair locks, consent checks, interruption and recovery; active coordinator state can be serialized.

## Current automated test list
See simulation/reference_ecology/tests/test_ecosystem.py. Tests assert state changes and event outputs, not only function return values.

## Not yet verified / not implemented
- No Unreal Engine project or C++ runtime is included in this reference package.
- 2D point movement is a behavior test harness, not UE locomotion, collision, navigation mesh or IK.
- The coordinator does not yet call UE5 Animation Blueprints, sync markers, root motion, IK or physical contact; current action strings and events are only the reference interface.
- The simple conflict resolver models escalation and retreat, not physical strike animation, detailed damage, injury recovery or tactical combat.
- Birth, mating, egg incubation, gestation, aging, plant regrowth, carrying capacity and migration are not complete systems here.
- Long-duration ecological stability and hundreds-of-agents performance have not been validated.

## Porting sequence to UE5
1. Adopt stable IDs and data fields from the species / individual models.
2. Port motivation evaluation into Utility AI and execution into StateTree.
3. Port interaction events into the interaction coordinator using docs/INTERACTION_CONTRACT.md.
4. Replace point movement with NavMesh / custom movement, skeletal animation, IK and physical contacts.
5. Port persistence to versioned save snapshots + event journal.
6. Re-run scenario tests in-engine; passing Python tests is not evidence that UE5 has passed.
