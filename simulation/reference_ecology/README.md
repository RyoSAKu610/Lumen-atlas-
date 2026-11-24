# Reference Ecology Simulation

A deterministic, engine-independent Python reference model for validating LIVING ATLAS behavior contracts before porting them into Unreal Engine 5. It is **not** the production game runtime and is not a scientifically validated ecological model.

## Run

Requires Python 3.11+ and no third-party dependencies.

```bash
cd simulation/reference_ecology
PYTHONPATH=src python -m unittest discover -s tests -v
PYTHONPATH=src python -m living_atlas.cli --minutes 180 --seed 17
```

## Implemented in this reference slice
- Individual hunger, thirst, energy, stress, fear and thermal-comfort needs.
- Juvenile follow / reunite behavior and parent-offspring kin recognition.
- Familiar greetings versus unfamiliar first-meeting assessment.
- Pair-event de-duplication within a simulation tick.
- Threat detection and prey flee response.
- Predator stalking, needs-driven attack resolution, hunt success / injury / failure outcomes.
- Resource-pressure territorial warning displays and dominance conflict / retreat.
- Food and freshwater consumption with resource depletion.
- Geothermal spring seeking, capacity limit, waiting, warmth relief and rest.
- Seeded deterministic stepping, JSON snapshot / restore and offline catch-up.
- Paired interaction coordinator with approach / signal / response / contact / resolution / recovery phases, participant locks, consent checks, interruption handling and active-state serialization.

## Explicit limitations
- Movement is 2D point navigation, not UE5 locomotion, collision or IK.
- Social / conflict results are event and state contracts, not synchronized skeletal animations.
- Mating, gestation, birth, aging, vegetation regrowth, migration and long-run population dynamics are not implemented yet.
- The rules are simplified decision scaffolding, not a validated natural science model.

## UE5 porting rule
Use this code as an executable behavior reference and test oracle. Port stable data and event semantics into UE5 C++ / StateTree / animation systems. Do not port its 2D movement as final creature locomotion.
