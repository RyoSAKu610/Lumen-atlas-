# Team Assignments and AI Workstreams

The project uses specialist AI contributors. The workstream is assigned by task capability; do not assume one vendor/model is universally best. Each contributor must use the same source of truth and respect ownership.

| Workstream | Lead profile | Ownership | First deliverable |
|---|---|---|---|
| Creative / Art Direction | **ChatGPT (current assistant)** | World identity, visual nuance, creature concepts, mood, palette, environment composition, art prompts, image critique, Japanese-realism × fantasy art direction | Master art bible, first 5 habitat concept briefs, first 10 creature design briefs |
| UE5 Engineering | Strong code-generation / repository-editing agent | C++ project skeleton, bootstrap, persistence, subsystem architecture, build tooling | Compilable UE5 project skeleton and WorldBootstrap module |
| Creature AI | Strong reasoning + code agent | Needs, perception, Utility AI, StateTree, memory and decision debugging | Individual AI schema and 3-species behavior vertical slice |
| Animation / Character TD | Vision + rigging / animation capable agent | Skeleton families, Control Rig, IK, locomotion, paired/group interaction animation | Rig specification and synchronized greeting/play interaction prototype |
| Ecology Simulation | Strong simulation / math / code agent | Food web, population dynamics, resources, birth/death, migration and offline catch-up | Deterministic model and ecological validation scenarios |
| Japan Environment Research | Research + geospatial / visual capability | Real geography, climate, geology, vegetation, hot spring features, regional reference | Fact-checked Kusatsu / Noboribetsu regional research packs |
| QA / Performance | Testing and profiling capable agent | Reproducible testing, performance profiling, persistence integrity and regression reports | Test matrix and baseline profiling report |

## ChatGPT's explicit role
ChatGPT owns the **creative direction and art quality bar**:
- Define the emotional identity of each biome.
- Design original creature silhouettes, anatomy cues, materials and behavioral expression.
- Generate and critique visual concepts and reference images.
- Maintain consistency between environment art, creature art, animation intent and UI tone.
- Review work for visual coherence, readability, composition, scale, lighting and emotional nuance.
- Translate user feedback into actionable art direction briefs.

ChatGPT does **not** silently take ownership of UE5 core C++ or another contributor's modules. It can review those implementations and suggest improvements, while the engineering owner makes and tests code changes.

## Rules for parallel work
- One owner per module / asset directory.
- Define interfaces before parallel implementation.
- Use feature branches and PRs.
- Ask for review when changing shared schemas or animation contracts.
- Keep all large source assets and generated references traceable.
- No contributor may mark a task complete without a test or a clear statement that it is art-only / research-only.
