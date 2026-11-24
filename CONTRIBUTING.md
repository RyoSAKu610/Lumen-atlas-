# Contributing to LIVING ATLAS

## Before starting
1. Read `README.md`, `docs/PROJECT_STATUS.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and `docs/AI_COLLABORATION.md`.
2. Check existing issues and branches to avoid duplicate work.
3. Claim one focused workstream / issue before editing.
4. State assumptions, acceptance criteria, and files you intend to touch.

## Branching
Use:
- `feat/<area>-<short-name>`
- `art/<region-or-species>`
- `fix/<area>-<short-name>`
- `docs/<topic>`

Do not commit feature work directly to `main`.

## Pull requests
Every PR must include:
- Summary and motivation.
- Scope and files changed.
- How to run / reproduce.
- Exact tests executed and their results.
- Screenshots, video, animation captures or profiler output when relevant.
- Known gaps and follow-up issues.
- Any schema, API, animation contract or asset naming changes.

## Quality bar
A screenshot is not a working feature. A generated animation is not proof of a skeletal rig. A simulated event log is not proof that the physical interaction exists. Label work as **implemented**, **prototype**, **mocked**, or **planned** accurately.

## Asset provenance
Record source, license / rights, generation or capture method, resolution, format, color space, alpha convention, and intended use. Avoid franchise lookalikes. Keep raw editable sources where practical.

## Coordination
Do not overwrite another contributor's work or change an owned module without discussion. Cross-system changes must document interface impacts and migration steps.
