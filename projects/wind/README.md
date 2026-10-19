# Wind

The latest global wind forecast on a globe you can turn: near the surface and in the jet stream. Live at [michaelzg.com/projects/wind/](https://michaelzg.com/projects/wind/).

Drag to turn the globe, scroll or pinch to zoom, and click for a reading. The arrow keys turn it, plus and minus zoom, `0` returns to the starting view, Enter reads the center, Space pauses and Escape clears a reading. With reduced motion the wind starts paused.

## Architecture

```
gaia.nullschool.net ──EPak──▶ _source/server.py ──JSON──▶ api/<level>.json ──▶ wind-data.js
                                                          data/<level>.json (saved copy)
wind-data.js ──grid──▶ globe-renderer.js ──▶ one WebGL2 canvas
                          ├─ globe-geometry.js  land texture, coastlines, borders (D3, Natural Earth)
                          └─ wind-trails.js     the wind
app.js  title, key, toolbar, reading, About
```

- **Trails.** Each frame the CPU moves one head per trail through the exact grid by bilinear interpolation. The vertex shader then traces each tail back along the same steady field from a half-float copy of the grid, and draws it as a tapered, antialiased ribbon on the sphere. Trails keep no history, so they are smooth at any refresh rate, sharp at any zoom, and complete from the first frame, which is also what a paused or reduced-motion globe shows. Trails on the far hemisphere are skipped before they are traced. The count follows the globe's on-screen radius, and thins itself if frames run long.
- **Globe.** A sphere with an equirectangular land texture painted by D3, coastlines and borders as great-circle line segments, and a rim glow measured from where each view ray passes the globe. The camera control is custom: the surface follows the pointer, flicks coast, and zoom, keys and reset glide.
- **Colors.** Color management is off, so every color is a display value, as in CSS. The key's gradient and the trails share one palette, and each unit has its own round scale (0–100+ km/h at the surface, 0–300+ in the jet stream) that the trail colors follow, so the key always reads exactly. Faster winds also draw heavier strokes.
- **Readings** come from the same grid the trails use, at full precision: speed, meteorological direction (where the wind comes from) and place.

## Data

- Global Forecast System winds from NOAA's National Weather Service, regridded to 1° and hosted by [Earth / Nullschool](https://earth.nullschool.net/about.html). Surface is 10 m above ground; jet stream is the 250 hPa level, about 10.5 km up. 360 × 181 grid, north to south, m/s.
- `_source/server.py` decodes the upstream EPak files with the standard library only. `runTime` is the model initialization and `validTime` the forecast's represented time, both from the upstream metadata. Upstream requests time out after 12 s and are capped at 4 MB.
- On the static site, the deploy workflow runs `server.py --write projects/wind/api` before Jekyll builds, every three hours. If that fails, `api/` is simply absent.
- The page asks for `api/<level>.json`. If it is unavailable it uses the last field it fetched, marked as not refreshed, or else `data/<level>.json`: genuine fields from the 2026-10-17 18:00 UTC run, valid 22:00 UTC, labeled "Saved copy". A field more than nine hours from now is flagged as old. Nothing is ever shown as current that isn't.
- These are model forecasts, not station measurements. Trail motion is sped up about 60,000 times near the surface and 20,000 times in the jet stream.

## Local dev

From the repository root, with Python 3:

```bash
python3 projects/wind/_source/server.py
```

Then open <http://127.0.0.1:8766/projects/wind/>. The server serves the repository and answers `projects/wind/api/<level>.json` (and the original `/api/wind?level=<level>`) with live data, cached for 30 minutes. A plain static server shows the saved copy, labeled as such.

## Vendored

`lib/`: three.js r180 (minified build, MIT, see `LICENSE.three`), D3 7.9.0 and topojson-client 3.1.0 (ISC). `data/`: Natural Earth 1:110m land and countries via world-atlas.
