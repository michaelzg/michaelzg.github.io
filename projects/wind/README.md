# Wind

The latest global wind forecast on a globe you can turn: near the surface and in the jet stream, with named storms labeled. Live at [michaelzg.com/projects/wind/](https://michaelzg.com/projects/wind/).

Drag to turn the globe, scroll or pinch to zoom, and click for a reading. The arrow keys turn it, plus and minus zoom, `0` returns to the starting view, Enter reads the center, Space pauses and Escape clears a reading. With reduced motion the wind starts paused.

## Architecture

```
gaia.nullschool.net ──EPak──▶ _source/server.py ──JSON──▶ api/<level>.json ──▶ wind-data.js
nomads.ncep.noaa.gov ─vitals─▶                    ──JSON──▶ api/storms.json
                                                          data/*.json (saved copy)
wind-data.js ──grid──▶ globe-renderer.js ──▶ one WebGL2 canvas
                          ├─ globe-geometry.js  land texture, coastlines, borders (D3, Natural Earth)
                          └─ wind-trails.js     the wind
app.js  title, key, toolbar, reading, About
```

- **Trails.** Each frame the CPU moves one head per trail through the exact grid by bilinear interpolation. The vertex shader then traces each tail back along the same steady field from a half-float copy of the grid, and draws it as a tapered, antialiased ribbon on the sphere. Motion eases off as wind strengthens, and a tail fades once it has curled about 115°, so a storm reads as a pinwheel rather than a whirling disc. Trails keep no history, so they are smooth at any refresh rate, sharp at any zoom, and complete from the first frame, which is also what a paused or reduced-motion globe shows. Trails on the far hemisphere are skipped before they are traced. The count follows the globe's on-screen radius, and thins itself if frames run long.
- **Globe.** A sphere with an equirectangular land texture painted by D3, coastlines and borders as great-circle line segments, and a rim glow measured from where each view ray passes the globe. The camera control is custom: the surface follows the pointer, flicks coast, and zoom, keys and reset glide.
- **Colors.** Color management is off, so every color is a display value, as in CSS. The key's gradient and the trails share one palette, and each unit has its own round scale (0–100+ km/h at the surface, 0–300+ in the jet stream) that the trail colors follow, so the key always reads exactly. Faster winds also draw heavier strokes.
- **Readings** come from the same grid the trails use, at full precision: speed, meteorological direction (where the wind comes from) and place.
- **Named storms** come from the tropical cyclone vitals that started the same GFS run: each active storm's name, position and maximum sustained wind from NHC and JTWC. Tropical storms and stronger are labeled (Hurricane, Typhoon or Cyclone by basin above 64 knots); NHC's own classification overrides, so a post-tropical storm goes unlabeled. A storm list is used only with the field from the same run, and each name is placed on the model's spiral: the strongest cyclonic spin within 3° of the reported position. Each label carries the advisory's peak sustained wind, in the reader's unit, because the 1° field smooths a storm's core below its official strength. Labels show on the surface layer only.

## Compared with the original

Measured in the same headless Chrome (Apple M4, Metal), 1440 × 900 at 2×, with the original at `~/d3/wind` served beside this one:

| | Original | This version |
| --- | --- | --- |
| Trails drawn | 7,406 (one per 175 pixels of window) | 24,640 (64 per pixel of globe radius) |
| Trail coverage of a central ocean window | 4.0% of pixels | 7.3% of pixels |
| Picture updates per second | 30 (trails step on a fixed 30 Hz clock) | 60 (every display frame; 120 on a 120 Hz screen) |
| Frame pacing, median and 99th percentile | 16.7 and 16.8 ms | 16.7 and 16.8 ms |
| A typhoon's core (Champi, 50 m/s in the field) | about 0.3 s per turn, tails wrapping the eye | about 1.1 to 1.3 s per turn, tails fading before a full curl |

Coverage counts pixels at least 5% brighter than their 7 × 7 neighborhood, so flat land, ocean and smooth shading don't count. A frame here costs about 1.4 ms on the CPU and 7 to 8 ms on the GPU, of which about 4.4 ms is the globe itself at retina resolution.

## Data

- Global Forecast System winds from NOAA's National Weather Service, regridded to 1° and hosted by [Earth / Nullschool](https://earth.nullschool.net/about.html). Surface is 10 m above ground; jet stream is the 250 hPa level, about 10.5 km up. 360 × 181 grid, north to south, m/s.
- `_source/server.py` decodes the upstream EPak files with the standard library only. `runTime` is the model initialization and `validTime` the forecast's represented time, both from the upstream metadata. Upstream requests time out after 12 s and are capped at 4 MB.
- On the static site, the deploy workflow runs `server.py --write projects/wind/api` before Jekyll builds, every three hours. If that fails, `api/` is simply absent.
- The page asks for `api/<level>.json`. If it is unavailable it uses the last field it fetched, marked as not refreshed, or else `data/<level>.json`: genuine fields from the 2026-10-17 18:00 UTC run, valid 22:00 UTC, labeled "Saved copy". A field more than nine hours from now is flagged as old. Nothing is ever shown as current that isn't.
- These are model forecasts, not station measurements. Trail motion is sped up about 50,000 times for ordinary surface winds, less as winds strengthen (about 20,000 times in a typhoon's core), and 10,000 to 20,000 times in the jet stream.

## Local dev

From the repository root, with Python 3:

```bash
python3 projects/wind/_source/server.py
```

Then open <http://127.0.0.1:8766/projects/wind/>. The server serves the repository and answers `projects/wind/api/<level>.json`, `api/storms.json` (and the original `/api/wind?level=<level>`) with live data, cached for 30 minutes. A plain static server shows the saved copy, labeled as such.

## Vendored

`lib/`: three.js r180 (minified build, MIT, see `LICENSE.three`), D3 7.9.0 and topojson-client 3.1.0 (ISC). `data/`: Natural Earth 1:110m land and countries via world-atlas.
