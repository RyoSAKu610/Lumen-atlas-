# Yugasumi Valley — creative brief

Author: Creative Direction pass completed under Grok after the GPT pass wrote palettes, morphology, camera grammar, and the valley layout. Narration in `data/narration/ja.json` is this pass. Region, art direction, and shot grammar were authored as GPT Creative Direction data and validated against the schema.

## North star

A compact fictional geothermal valley that feels inhabited before it feels explained. The emotional heart is **湯霞の泉** (`yugasumi_spring`): warm water in cold air, steam as a vertical light volume, giants using it as a real resource. Scale should read in one glance — a moss-mantled colossus, a low dusk-coloured hunter, a reed-tailed kit, a wheel of wings over the steam.

Reference mood: hand-painted 1990s Japanese OVA backgrounds (layered value, painted atmosphere) plus modern cinematic light (one key, readable shadows, restrained saturation). Not a theme park, not a franchise creature sheet.

## Species (ids are fixed)

| id | name | read |
| --- | --- | --- |
| `giant_grazer` | 苔衣 / Mossmantle Colossus | Columnar, slow, a walking ridgeline. Mantle breaks the topline. Herd mass is the defence. |
| `kit_forager` | 薄尾 / Reedbrush Kit | Light, crepuscular, family-dense. Juveniles bounce; adults are precise. |
| `ridge_stalker` | 暮裂 / Duskcleft Stalker | Long, low, digitigrade. The silhouette should read as a crack in the slope, not a big cat costume. |
| `thermal_glider` | 湯輪翔 / Vaporwheel Glider | Unmistakable wing ellipse. On the ground, one pair of legs and folded wings. In the air, a ring above the spring. |

Binomials in the art file are invented. Do not converge on any living franchise silhouette (no Poké-adjacent faces, no wyverns, no Ghibli mascots, no Avatar hexapods).

## What the valley must be able to show

A giant entering the spring; a kit juvenile playing; two familiars greeting; a territorial adult warning a rival; a predator in cover; the herd turning; a glider overhead; a family at the den by dusk. Camera grammar for these beats is in `data/art/camera-shots.json`. Journal voice is in `data/narration/ja.json`: present tense, warm, unsentimental, tension during hunts, dignity at death.

## Requests to engineering

- Drive light, fog, exposure, and creature materials from `data/art/art-direction.json`. Do not hard-code a second palette.
- Foot planting and bathing waterlines must use the shared terrain (`heightAt`, `waterSurfaceAt`). The spring is a behaviour, not a prop.
- Documentary UI copy should prefer narration labels over raw ids. Nicknames come from the narration pack, assigned stably by agent id.
- Low camera + longer lens on giants; compressed telephoto on stalks; two-shots on greetings; aerial follow on gliders. The shot file is the spec.
