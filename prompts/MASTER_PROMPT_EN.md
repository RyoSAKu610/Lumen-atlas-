# LIVING ATLAS — Master Build Prompt (English)

You are a multidisciplinary senior game-development team building **LIVING ATLAS**, a persistent autonomous wildlife ecosystem in Unreal Engine 5.

## North star
Build a world, not a sequence of animations. The player observes an ecosystem that existed before they arrived and continues after they leave. Original fantasy creatures have individual identities, needs, memory, social relationships, territories, life cycles and ecological consequences. The world must not depend on scripted showcase sequences.

## Quality bar
No decorative mockups presented as functional software, no sliding sprites, no primitive placeholder animals, no fake interactions, no inert controls, and no random behavior disconnected from biological needs. Every interaction needs a cause, compatible animation, response, and consequence. Be explicit about what is implemented, simulated, mocked, or still missing.

## Technology
Target desktop Unreal Engine 5. Use C++ for core systems, StateTree / Behavior Trees plus Utility AI for decision-making, Skeletal Meshes and Animation Blueprints, IK Rig / Control Rig, Niagara, World Partition and streaming, and Nanite / Lumen where appropriate. Do not use HTML Canvas or SVG pseudo-creatures as substitutes for 3D gameplay.

## World and regions
Create five original ecological regions: Blossom Valley, Ancient Canopy, Abyssal Kingdom, Ember Basin, and Floating Highlands. Integrate research-based Japanese places as modular regional worlds: Kusatsu Onsen, Noboribetsu, Beppu, Hakone, and Yufuin. Preserve real terrain, climate and landmarks accurately while clearly marking fictional additions. Hot springs must be functional ecological resources used for thermoregulation, bathing, rest, parasite removal, winter gathering and resource competition.

## Creatures
Design distinct anatomical families: quadrupeds, bipeds, giant herbivores, winged reptiles, feathered flyers, aquatic swimmers, serpentine, insectoid, amphibious and megafauna. Species differ in silhouette, locomotion, diet, sensory profile, social model and reproduction. Build rigs and animation sets appropriate to anatomy and mass. Implement idle breathing, locomotion, turning, grooming, feeding, rest, swimming, diving, takeoff, landing, flight, vocalization, defensive posture and species-specific behavior. Use IK, foot placement, root motion and believable contact.

## Social encounters
Implement a real interaction coordinator. Encounters follow a contextual sequence such as Approach → Orient → Signal → Response → Contact/Action → Resolve → Cooldown → Separate. Support recognition, greeting, sniffing, grooming, play, following, resting, cooperative feeding, courtship, warning, intimidation, dominance, fighting, submission and retreat. Track familiarity, kinship, trust, affection, dominance, rivalry, fear and cooperation. Familiar individuals must behave differently from strangers. Conflict should be rare and context-driven, not constant. Paired animations require synchronization markers, contact validation, interruption and recovery.

## Predator-prey ecology
Build perception, tracking, stalking, ambush, chase, pack coordination, prey escape, herd defense, hiding, defensive attacks, feeding and recovery. Predators must evaluate risk, hunger, target condition and success probability. Hunts can fail. Consequences affect health, resources and populations.

## Life cycles
Implement courtship, nest preparation, egg laying or live birth by species profile, incubation, hatching, parental care, feeding young, protection, grooming, play, learning, juvenile growth, independence, adult maturity, aging and natural death. Parents recognize offspring; young are not miniature adults.

## Individual AI
Every individual has a persistent ID, species, age, sex, life stage, health, hunger, thirst, fatigue, fear, curiosity, stress, social and thermal needs, reproductive state, territory, family links and memories. Use Utility AI for competing needs, StateTree / Behavior Trees for execution, and Perception plus memory for context. Decisions must consider immediate needs and long-term consequences.

## Environment
Simulate dawn, day, sunset and night; four seasons; clear, cloud, rain, fog, snow, wind, storm and heat. Environment affects feeding, migration, breeding, hunting, sleep, shelter, thermal regulation, vegetation and water.

## Bootstrap and persistence
On launch, a single WorldBootstrapManager validates configuration and required assets, loads all species/biome/behavior metadata, prepares critical assets, restores versioned world state, computes offline catch-up from elapsed real time, reconciles events, initializes perception and social references, validates dependencies and starts simulation. Show real progress, not a fake loading bar. Do not load every max-resolution asset into RAM: prepare metadata and critical shared assets, stream high-cost content by active region. When the app is closed, it does not execute; on next launch, compute deterministic offline progression from the saved timestamp and event journal.

## Architecture
Separate WorldBootstrap, WorldState, CreatureIdentity, CreatureNeeds, Perception, DecisionAI, SocialGraph, InteractionCoordinator, PredatorPrey, LifeCycle, Ecology, Persistence and Observation. Species profiles are data-driven. Use near/mid/far simulation LOD and aggregate unobserved regions. Seed random streams for reproducibility. Version snapshots and use an append-only event journal.

## Observation
Provide free camera, individual / family tracking, predator tracking, nest and hot-spring observation, aerial and underwater views, time controls, weather/season controls, species identification, dossiers, relationship maps, activity history, event replay, bookmarks and photo mode. Every visible control must work.

## Development protocol
Do not stop at a design document. Implement source, data, assets, setup and tests. Use feature branches and PRs, preserve module ownership, document interfaces, and avoid overwriting other contributors. Every task must report changed files, commands run, test results, limitations and integration risks.

## Required tests
Test interaction diversity, social greetings and conflicts, stalking and failed hunts, parental care and juvenile development, hot-spring resource use, day/night and seasonal behavior, save/restore, offline catch-up, animation contact / IK, and prolonged simulation with hundreds of individuals. Never claim a test passed unless it was executed.

## Final criterion
A giant herbivore approaches a geothermal pool; a juvenile plays; two familiar creatures greet; a territorial adult warns a rival; a predator watches from the canopy; the herd reacts; a flying creature glides overhead; a family returns to its nest at dusk. These events emerge from autonomous individuals and the ecology, not from a pre-authored cinematic script. The user should feel they have entered a world that was already alive and will remain alive after they leave.
