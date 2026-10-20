/**
 * NOAA GFS wind fields in m/s: u eastward, v northward, on a grid whose columns
 * run east from lon0 and rows run south from lat0.
 *
 * The current field is api/<level>.json, served live by _source/server.py or
 * published at build time. Without it the page shows the field it last had, or
 * else the dated saved copy in data/, flagged so the interface says so.
 */
export const REFRESH_INTERVAL = 30 * 60 * 1000;
const OLD_AFTER = 9 * 3600 * 1000;
const cache = new Map();

async function fetchJson(path, signal, timeout = 16000) {
  const response = await fetch(new URL(path, import.meta.url),
    {cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)])});
  if (!response.ok) throw new Error(`The forecast is unavailable (status ${response.status}).`);
  return response.json();
}

function hydrate(raw, snapshot) {
  const u = Float32Array.from(raw.u ?? []), v = Float32Array.from(raw.v ?? []);
  if (!u.length || u.length !== raw.width * raw.height || v.length !== u.length ||
      !u.every(Number.isFinite) || !v.every(Number.isFinite) || !Date.parse(raw.validTime)) {
    throw new Error('The forecast arrived incomplete.');
  }
  return {...raw, u, v, snapshot, stale: snapshot || Math.abs(Date.now() - Date.parse(raw.validTime)) > OLD_AFTER};
}

/** The latest field for `level`, else the last one fetched, else the saved one. */
export async function loadWind(level, signal, force = false) {
  const prior = cache.get(level);
  if (prior && !force && Date.now() - prior.at < REFRESH_INTERVAL) return prior.grid;
  let grid;
  try {
    grid = hydrate(await fetchJson(`api/${level}.json`, signal), false);
  } catch (error) {
    // A cancelled request must not resurrect an obsolete layer through a fallback.
    if (signal.aborted) throw error;
    if (prior) return {...prior.grid, offline: true, stale: true};
    try {
      grid = hydrate(await fetchJson(`data/${level}.json`, signal, 8000), true);
    } catch {
      if (signal.aborted) throw error;
      throw new Error('The forecast and the saved copy are both unavailable.');
    }
  }
  cache.set(level, {at: Date.now(), grid});
  return grid;
}

/**
 * Named storms from the vitals that started the same model run as `grid`, so a
 * label always sits on the field it names: the current list, the saved one, or none.
 */
export async function loadStorms(grid, signal) {
  for (const path of ['api/storms.json', 'data/storms.json']) {
    const data = await fetchJson(path, signal, 8000).catch(() => null);
    if (data?.runTime === grid.runTime) return data.storms;
  }
  return [];
}

/** Bilinear interpolation of the grid at a longitude and latitude in degrees. */
export function sampleWind(grid, longitude, latitude) {
  const {width, height, lon0, lat0, dx, dy, u, v} = grid;
  const gx = (((longitude - lon0) / dx) % width + width) % width;
  const gy = (latitude - lat0) / dy;
  if (!(gy >= 0 && gy <= height - 1)) return null;
  const x0 = Math.floor(gx), x1 = (x0 + 1) % width, y0 = Math.floor(gy), y1 = Math.min(y0 + 1, height - 1);
  const tx = gx - x0, ty = gy - y0;
  const blend = values => (values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx) * (1 - ty)
    + (values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx) * ty;
  const east = blend(u), north = blend(v);
  return {u: east, v: north, speed: Math.hypot(east, north)};
}
