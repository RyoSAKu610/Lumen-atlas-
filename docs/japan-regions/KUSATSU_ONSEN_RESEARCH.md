# Kusatsu Onsen — Verified Regional Research Pack

**Workstream:** Japan Environment Research / World Building  
**Status:** Initial fact-checked pack (2026-11-26)  
**Purpose:** Future real-Japan region module; this is separate from the fictional Yugasumi Valley vertical slice.

## 1. Important distinction

Kusatsu Onsen is a real, inhabited hot-spring town in Gunma Prefecture. Its central Yubatake is an urban landmark surrounded by streets, inns and public facilities. Do not turn the real town into a remote untouched fantasy valley or silently substitute Yugasumi's invented geography for Kusatsu.

Recommended content modes:
- **Documentary / real-Japan mode:** preserve the actual urban layout, Yubatake, wooden cooling channels, surrounding buildings and known landscape features. Keep the environment recognisable and geographically accurate.
- **Fantasy ecology overlay:** add original creatures only in clearly marked fictional zones such as designed forest-edge habitats or invented geothermal microhabitats. Do not imply that wild megafauna live in the real Yubatake town.

## 2. Verified Yubatake facts

Sources:
- Kusatsu Town, “About Kusatsu Onsen”: https://www.town.kusatsu.gunma.jp/s013/040/020/1485254967207/index.html
- Kusatsu Onsen Tourism Association, “Yubatake” (page dated 2026-04-26): https://www.kusatsu-onsen.ne.jp/kankou/1004.php
- Japan National Tourism Organization, “Kusatsu Onsen”: https://faq.japan-travel.jnto.go.jp/en/spot/1518/
- Gunma Official Tourist Guide, “Netsunoyu”: https://www.visit-gunma.jp/en/spots/netsunoyu/

### Source water and flow
- The town's official page states the principal spring water is strongly acidic, around pH 2.0. It says the Banzai source is about 94.5°C; other major sources are around 50°C when emerging.
- The town page describes heat exchange being used for the very hot Banzai source before it is used in baths.
- The Tourism Association describes Yubatake as producing about 4,000 litres per minute, flowing through seven wooden channels. The source is cooled in the conduits before distribution; the page gives pH 2.1.
- JNTO describes hot water emerging directly from the source and cooling as it passes through connected wooden chutes, preserving its natural mineral content.
- The Gunma guide says the water at Netsunoyu is over 51°C and too hot for bathing before the traditional yumomi cooling process.

**Do not collapse these measurements into one universal “Kusatsu water temperature.”** Sources differ by spring, measurement point and stage of cooling. Preserve source-specific values and attach provenance to every numeric field.

### Cultural / built-environment cues
- Yubatake is the central visual and spatial anchor of the town.
- Seven wooden conduits / channels are a signature repeating form.
- Netsunoyu stands directly in front of Yubatake and hosts yumomi, a traditional wooden-paddle water-cooling performance.
- The Tourism Association describes the hot-spring town as spreading outward around Yubatake.
- Sainokawara Park is a separate nearby natural hot-spring area; do not merge its landscape into the Yubatake basin without a correct route / terrain model.

## 3. Climate reference — JMA 1991–2020 normals

Official source: Japan Meteorological Agency, Kusatsu (Gunma), annual / monthly normals:
https://www.data.jma.go.jp/stats/etrn/view/nml_amd_ym.php?block_no=0343&prec_no=42

The table reports a 30-year normal period (1991–2020). Values below are the station's monthly mean temperature, precipitation, total snowfall depth and maximum snow depth.

| Month | Mean temp °C | Precipitation mm | Snowfall total cm | Max snow depth cm |
|---|---:|---:|---:|---:|
| Jan | -4.1 | 68.5 | 175 | 73 |
| Feb | -3.6 | 66.1 | 156 | 94 |
| Mar | -0.1 | 90.6 | 149 | 77 |
| Apr | 6.0 | 106.2 | 38 | 31 |
| May | 11.4 | 150.7 | 0 | 0 |
| Jun | 14.9 | 218.3 | 0 | 0 |
| Jul | 18.9 | 263.5 | 0 | 0 |
| Aug | 19.6 | 236.8 | 0 | 0 |
| Sep | 15.6 | 254.6 | 0 | 0 |
| Oct | 9.9 | 162.5 | 0 | 0 |
| Nov | 4.4 | 63.9 | 9 | 3 |
| Dec | -1.2 | 60.4 | 112 | 37 |
| **Annual** | **7.6** | **1,758.4** | **644** | **99** |

Use these values as a station reference, not as an exact temperature field for every point in the 3D region. Terrain aspect, elevation, shade, wind exposure and thermal-water proximity require spatial variation.

## 4. Environment art direction

### Composition anchors
1. **Yubatake core:** an accurate, compact urban landmark. The seven wooden channels, central basin / outlet, stone edges and surrounding building ring should be researched from maps and reference photography.
2. **Netsunoyu frontage:** the front-of-Yubatake relationship and building scale matter; yumomi is a cultural practice and should not become a generic fantasy animation.
3. **Town fabric:** closely spaced inns, streets, signs, public baths and pedestrian connections define the actual town. Do not use generic detached “Japanese houses” as substitutes.
4. **Sainokawara Park:** a separate park environment with its own paths, pools and stream / geothermal features; model it as a connected destination only after confirming routes and elevation.
5. **Outer mountain context:** forested highland slopes, winter snow, seasonal vegetation and mountain weather can provide the larger natural setting around the town.

### Lighting / seasonal identity
- Winter: snow cover, cold blue shade, visible contrast between cold air and geothermal steam; no blanket white-out that hides streets.
- Spring: thaw, wet paths, early leaf growth; avoid making the entire area cherry-blossom forest by default.
- Summer: lush mountain vegetation, frequent wet weather; the JMA normals show the warmest monthly mean is still below 20°C at the station.
- Autumn: early chill, coloured deciduous canopy, thin mist and shorter daylight.

## 5. Ecological simulation implications

**Critical safety / plausibility rule:** raw Yubatake water is not a generic wildlife bathing pool. The officially reported acidity and source temperatures make direct animal immersion an implausible default.

Represent geothermal resources as several distinct classes:
- **Hot source / channel:** high-temperature, strongly mineralised source; hazard / no-entry zone for ordinary wildlife. This is a world feature and data source, not an animal spa.
- **Managed cooled water route:** human-engineered channels and distribution; preserve their cultural / built-environment role in real-Japan mode. Do not give wildlife unrestricted access through the town.
- **Natural downstream or peripheral water:** only assign water temperature and chemistry when a reliable measurement exists. Otherwise mark fictional thermal refugia as invented additions.
- **Forest / stream / meadow habitats:** ordinary wildlife resources with normal water access, cover, forage and seasonal change. These are more plausible locations for the fantasy-ecology overlay.

For fictional creatures, define thermal tolerance, preferred body temperature and water-contact behavior per species. A species may seek a warm rock or steam plume without entering hot or acidic source water. Clearly label invented safe thermal refugia.

## 6. Data requirements before a playable replica

- Georeferenced Yubatake footprint and seven-channel layout.
- Buildings / street footprints around the central square.
- Netsunoyu position and frontage.
- Confirmed routes and terrain from Yubatake to Sainokawara Park.
- Digital elevation model and contour validation for the selected playable boundary.
- Climate time series / normals and seasonal snow cover.
- Source-specific temperature, flow and chemistry, each with measurement location and date.
- Separate factual map layers from fictional creature habitat layers.

## 7. Accuracy checklist

- [ ] The map is recognisably Kusatsu, not a generic hot-spring town.
- [ ] Yubatake's seven channels and surrounding town geometry are correctly represented.
- [ ] Hot-spring temperatures are source-specific and sourced.
- [ ] High acidity is represented as an environmental constraint, not a creature-friendly bath.
- [ ] JMA monthly normals use the 1991–2020 station values above.
- [ ] Fantasy ecology is visibly and data-wise separated from real-world facts.
- [ ] All references and derived values retain source URL and retrieval date.

## Sources
1. Kusatsu Town — About Kusatsu Onsen: https://www.town.kusatsu.gunma.jp/s013/040/020/1485254967207/index.html
2. Kusatsu Onsen Tourism Association — Yubatake (2026-04-26): https://www.kusatsu-onsen.ne.jp/kankou/1004.php
3. Japan Meteorological Agency — Kusatsu 1991–2020 normals: https://www.data.jma.go.jp/stats/etrn/view/nml_amd_ym.php?block_no=0343&prec_no=42
4. Japan National Tourism Organization — Kusatsu Onsen: https://faq.japan-travel.jnto.go.jp/en/spot/1518/
5. Gunma Official Tourist Guide — Netsunoyu: https://www.visit-gunma.jp/en/spots/netsunoyu/
6. Gunma Official Tourist Guide — Kusatsu destination: https://www.visit-gunma.jp/en/discover/destinations/kusatsu/
