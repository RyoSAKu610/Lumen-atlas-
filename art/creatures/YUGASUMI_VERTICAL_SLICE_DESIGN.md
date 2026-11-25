# 湯霞の谷 — Vertical-Slice Creature Design Specification

**Creative owner:** ChatGPT — Art Direction  
**Target:** The four locked species in `prototypes/living-world/data/species/`  
**Status:** Art-to-model handoff specification, not a completed rig or production asset.

> Keep the four species IDs in the simulation data as the source of truth. Earlier five-species concept lists are future-roster candidates only; do not silently substitute their names or anatomy into this vertical slice.

## Shared visual rules

- Every species must read in silhouette at a small thumbnail size.
- Distinguish anatomy, gait and ecological role, not only colors or surface patterns.
- Use natural-history presentation: neutral three-quarter hero, side profile, front and rear views, scale comparison and behavior poses.
- No text baked into the creature render; labels and measurements belong in the accompanying sheet / data.
- Keep anatomy physically coherent: joint placement, foot contact, center of mass, tail counterbalance, wing loading, head reach and ground clearance must agree with the species JSON.
- Species designs are original. Avoid identifiable franchise silhouettes, generic cat / wolf swaps, four-legged dragon defaults, or mascot proportions.

## Locked scale comparison

| Species ID | Japanese name | English name | Length | Shoulder height | Mass | Role |
|---|---|---|---:|---:|---:|---|
| `giant_grazer` | 苔衣（こけごろも） | Mossmantle Colossus | 6.5 m | 3.2 m | 5,200 kg | Megafauna grazer |
| `kit_forager` | 薄尾（すすきお） | Reedbrush Kit | 0.9 m | 0.45 m | 14 kg | Social omnivore |
| `ridge_stalker` | 暮裂（くれさき） | Duskcleft Stalker | 2.6 m | 1.05 m | 160 kg | Apex predator |
| `thermal_glider` | 湯輪翔（ゆわとび） | Vaporwheel Glider | 1.4 m body | 0.7 m | 9 kg | Aerial scavenger |

The glider's 3.35 m wingspan is the correct visual scale reference while in flight. Do not compare only body length.

---

## 01 — 苔衣 / Mossmantle Colossus (`giant_grazer`)

**Read:** a walking ridgeline; massive, slow, quiet, protective.

### Silhouette and anatomy
- Four near-vertical, columnar weight-bearing legs under a deep barrel torso.
- The shoulder-to-hip moss mantle breaks the topline into a high, irregular ridge. It should look like an organic mat of lichen and coarse hair, not a turtle shell.
- Small, low-slung wedge head with blunt grazing muzzle.
- Short, heavy club tail used as a counterweight; no trunk, elephant ears or tusks.
- Short curved paired horns create a readable warning / herd-defense profile without turning it into a generic bull.
- Feet are broad and columnar; each step must visibly carry mass.

### Material and palette
- Charcoal-sage base coat, mineral-grey belly, lichen-green dorsal mantle, aged ivory horn and warm amber eye.
- Roughness is high; wet mantle and muzzle may catch small highlights, but the body must not look metallic.
- Moss can hold tiny plant fragments and water droplets. Keep the effect subtle.

### Movement and expression
- Walk: long planted steps with body inertia and slight shoulder roll.
- Graze: feet mostly planted; the neck sweeps a slow arc and the jaw keeps chewing after the head rises.
- Bath: tests the lip with one forefoot, descends weight-first, then settles belly-deep; exiting requires a deliberate push and full-body water shake.
- Vigilance: chewing stops first; the head aligns, then the nearby herd copies the stillness in a delayed wave.
- Defense: adults form an outer shoulder wall around calves; horns lower together, one stamp, controlled advance.
- Sleep: knees fold in sequence; the torso settles heavily; one sentinel may remain standing.

### Animation / rig notes
- Heavy body secondary motion must lag behind foot plant.
- Root motion owns locomotion; IK corrects the feet to uneven ground.
- Avoid quick pivots, repeated bouncing or full-body bobbing.
- Mantle should react to breathing, wind and impacts with low-frequency follow-through.

---

## 02 — 薄尾 / Reedbrush Kit (`kit_forager`)

**Read:** a small dusk-wanderer; social, curious, agile, expressive.

### Silhouette and anatomy
- Light arched quadruped with springy digitigrade hind legs and compact forelegs.
- Two tall petal-fold ears that can rotate independently.
- Narrow tapered muzzle and bright forward-set eyes; avoid oversized toy-like eyes.
- Signature reed-plume tail, nearly body-length, carried above the back. The tail is its key silhouette feature.
- Padded feet and a flexible spine support quick turns, pounces and small bounds.

### Material and palette
- Warm reed-brown base, pale cream underside, dark muted banding and wheat-gold tail plumes.
- Fur sheen is soft, not glossy. Ear interiors and tail fibres can catch dusk rim light.
- Juveniles are lighter, fluffier and less coordinated; do not simply shrink the adult.

### Movement and expression
- Greeting: tail lowers, ears open sideways, three quick nose-to-cheek sniffs, then a shoulder pass; familiar animals let their tails cross.
- Play: a short freeze precedes each burst; juveniles side-hop, pounce through tail plumes, tumble, then spring apart and invite pursuit.
- Forage: ears triangulate independently while the nose parts litter; discoveries are pinned with both forepaws before tasting.
- Alert: rises onto hind toes, holds tail horizontal as a family signal, and tracks home and danger separately with the ears.
- Flee: three bounding strides, broken-angle turn behind cover, then low sprint with folded ears and streaming tail.
- Sleep: family members coil nose-to-tail; young disappear under adult tail plumes.

### Animation / rig notes
- The plume tail is a balance organ and social signal, not decorative hair.
- Use springy but grounded foot contacts; no hovering or frictionless sliding.
- Ear rotation and tail shape must communicate intent before the main action.
- Juvenile play uses imperfect landings and pauses; adults respond with restrained invitation.

---

## 03 — 暮裂 / Duskcleft Stalker (`ridge_stalker`)

**Read:** a low moving shadow; patient, solitary, precise.

### Silhouette and anatomy
- Long horizontal line from wedge head through spine to whip tail.
- Low torso with oversized folded hindquarters and digitigrade limbs; do not resemble a conventional big cat.
- Short split shoulder-mane creates a dark notch, not spines or a shaggy lion mane.
- Small rounded ears, long low muzzle and forward-facing amber eyes.
- Flexible tail is a balance rudder during turns and leaps.

### Material and palette
- Slate-charcoal coat, smoke-grey underside, muted rust throat accent and very dark split mane.
- Low sheen; sparse broken striping, not leopard rosettes.
- Eyes reflect weak dusk light, but should not glow like a supernatural lamp.

### Movement and expression
- Stalk: shoulder blades alternate beneath a level spine; forepaw tests the ground; belly nearly touches cover; movement stops when prey looks up.
- Warn: turns broadside at a boundary, raises the split mane, hooks the tail and steps backward without turning away.
- Chase: hindquarters release in two explosive bounds; tail straightens as a rudder; mouth opens only near the final lunge.
- Flee: drops from view before accelerating, using two long bounds and a hard lateral cut into terrain shadow.
- Parent / young: the mother lies with head uphill and scans; young press under the rear ribcage and freeze when the tail tip stills.
- Sleep: chooses a lee hollow, curves spine around the belly, and leaves ears exposed.

### Animation / rig notes
- The silhouette depends on a low center of mass and long spine. Do not animate it as a tall wolf.
- Use tension before motion: eye / ear alignment, shoulder preload and tail stillness precede a lunge.
- Chase motion must be rare and expensive, not a constant idle loop.
- A warning should often resolve without contact. Fighting is not the default response to another animal's presence.

---

## 04 — 湯輪翔 / Vaporwheel Glider (`thermal_glider`)

**Read:** an ink-ring in the sky; patient, wind-aware, elegant.

### Silhouette and anatomy
- One pair of taloned legs; no extra forelimbs.
- Broad shallow-M wings with seven separated dark primary fingers.
- Pale belly, small diamond / fan tail and long S-shaped neck.
- Beaked head with a small crest / frill; avoid a dragon head.
- Perched, both wings fold in two visible layers and cross below the tail.
- In flight, the wing ellipse is unmistakable from a distance.

### Material and palette
- Ash-grey upper wings, pale ivory belly, smoke-dark primary fingers, muted rust underwing bar and aged-gold eye.
- Feather structure must show layered primaries, secondaries and coverts, with different stiffness at the tips.
- No glowing wing veins; silhouette and flight mechanics create the spectacle.

### Movement and expression
- Takeoff: two-foot launch from a ledge, wings open after the push, one powerful downstroke, then glide.
- Soar: enters the steam column with one deep wingbeat; primaries spread, tail makes small corrections, body traces widening circles.
- Glide: neck retracts, wings lock in shallow M, one tip drops to bank without flapping.
- Perch: feet reach together, wings flare to brake, fold in two layers, tail fans for balance.
- Groom: beak zips each primary from base to tip; the full wing is offered only after the partner settles its crest.
- Alarm: crest and neck frill flatten, wings snap half-open, and a two-note call sends nearby birds off the rock.

### Animation / rig notes
- Flight is driven by wind and thermal lift, not continuous fast flapping.
- Wing membrane / feather group motion must respect shoulder, elbow, wrist and finger joints.
- Landing requires speed reduction, foot reach and wing braking.
- On ground, locomotion is awkward two-foot hopping; do not animate it like a four-legged animal.

---

## Required model / animation handoff per species

Before rig production, deliver:
1. Orthographic side, front and rear views with metre scale.
2. Three-quarter hero view and silhouette-only thumbnail.
3. Major joint / pivot diagram, including tail and wing chains.
4. Material sheet with roughness / sheen guidance and colour IDs.
5. Neutral, alert, fearful, relaxed and social expression poses.
6. Walk / run / stop / turn / rest / feed plus one signature behavior.
7. One paired interaction sheet showing both participants and contact surfaces.
8. Root-motion ownership, IK / foot-placement notes and sync markers.

## Vertical-slice visual acceptance
- A viewer can identify all four species from silhouette alone.
- The giant reads as several tonnes; the kit reads as 14 kg; the stalker reads as a low ambush predator; the glider reads as a 3.35 m wingspan flyer.
- No species looks like another species recolored.
- Each body plan can perform its JSON behavior set without joint distortion.
- At least one parent / juvenile interaction, one greeting, one warning display and one glider thermal-soar are visually understandable without UI text.
