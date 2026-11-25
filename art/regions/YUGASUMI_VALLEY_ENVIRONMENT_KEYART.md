# 湯霞の谷 — Environment Key Art Brief

**Region ID:** `REG_yugasumi_valley`  
**Classification:** Fictional region. Japanese geothermal mountain landscapes are broad mood references only; do not claim this depicts Kusatsu, Noboribetsu or another real site.

## Composition
- 16:9 landscape, documentary establishing view from a slightly elevated overlook.
- Foreground: wet volcanic stones, moss, small flowers and cold river water; one small creature may establish scale.
- Left: asymmetrical flowering tree and root-held den, dark enough to frame the valley.
- Center: warm mineral spring with localized steam; cool river visibly flows past it.
- Right middle distance: meadow shelf with visible grazing tracks and animal paths.
- Background: White Veil Falls, layered cedar slopes and a distant snow ridge. No resort architecture, tourists or dominant castle.

## Match the data
- Main spring: `yugasumi_spring`, 40.5°C, radius 12.5 m, occupancy capacity 8.
- Secondary spring: `kiri_spring`, 44°C, radius 5.5 m, capacity 3.
- Cool river, meadow, sakura grove, cedar den, reed marsh, stalker lookout and glider roost must remain visually distinct.
- Region scale is 400 m across. Use JSON camera viewpoints and landmark coordinates rather than inventing new geography.

## Light and colour
Use `data/art/art-direction.json` as the single palette / lighting source. Dawn is peach horizon + cool blue ridge; noon is clear and readable; dusk is amber rim + slate shadows; night is indigo with sparse bioluminescence. Steam is localized to geothermal points and reacts to wind.

## Handoff
The generated 16:9 concept is an environment mood / composition reference only. It is not an engine-ready texture, photogrammetry, or a verified real Japanese location. Production must separate terrain, water, geothermal steam, vegetation, lighting and collision, with day / night and seasonal variants.
