# Wind

The latest global wind forecast on a globe you can turn, near the surface and in the jet stream, with named storms labeled. Live at [michaelzg.com/projects/wind/](https://michaelzg.com/projects/wind/).

Drag to turn the globe, scroll or pinch to zoom, and click for a reading. The arrow keys turn it, plus and minus zoom, `0` returns to the starting view, Enter reads the center, Space pauses and Escape clears a reading. With reduced motion the wind starts paused.

## How it works

- **`wind-trails.js`** draws the wind. Each frame the CPU moves one head per trail through the grid. The vertex shader then traces each tail back along the same steady field and draws it as a tapered ribbon. Trails keep no history, so they are smooth at any frame rate, sharp at any zoom and complete from the first frame. Motion eases off as wind strengthens, and a tail fades once it has curled about 115°, so a storm reads as a pinwheel.
- **`globe-renderer.js`** holds the scene, the camera control, picking and the frame loop. The camera lets the surface follow the pointer, flicks coast, and zoom and reset glide. The trail count follows the globe's on-screen radius and thins itself if frames run long. Color management is off, so every color is a display value, as in CSS.
- **`app.js`** handles the title, the key, the toolbar, readings and storm labels. Each unit has a round color scale that the trail colors follow, so the key always reads exactly. Readings use bilinear interpolation of the same grid.
- **`wind-data.js`** loads fields and storms. **`globe-geometry.js`** draws lines on the sphere.

Measured against the original `~/d3/wind` at 1440 × 900 on an Apple M4, this draws 3.3 times as many trails, covers 1.8 times as many pixels, and updates the picture 60 times a second instead of 30.

## Data

- Winds come from NOAA's Global Forecast System, regridded to 1° and hosted by [Earth / Nullschool](https://earth.nullschool.net/about.html). The surface layer is 10 m above ground; the jet stream is the 250 hPa level. `_source/server.py` decodes the upstream EPak files with the standard library only.
- Storms come from the tropical cyclone vitals that started the same GFS run, from NHC and JTWC. Tropical storms and stronger are labeled, with NHC's own classification taking precedence, so post-tropical storms go unlabeled. Each label sits on the model's spiral and carries the advisory's peak sustained wind. Labels show only beside a field from the same run.
- The page asks for `api/<name>.json`. On the site, the deploy workflow writes these files every three hours. If they are missing, the page keeps the last field it had, or else falls back to `data/`: genuine fields from the 2026-10-17 18:00 UTC run, labeled "Saved copy". A field more than nine hours from now is flagged as old.

## Local dev

```bash
python3 projects/wind/_source/server.py
```

Then open <http://127.0.0.1:8766/projects/wind/>. The server serves the repository and answers `api/<name>.json` with live data, cached for 30 minutes.

## Vendored

`lib/`: three.js r180 (MIT, see `LICENSE.three`), D3 7.9.0 and topojson-client 3.1.0 (ISC). `data/`: Natural Earth 1:110m land and countries, via world-atlas.
