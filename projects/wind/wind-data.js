/**
 * NOAA GFS wind fields in m/s: u is eastward and v northward, on a grid whose
 * columns run east from lon0 and rows run south from lat0.
 *
 * The current field is api/<level>.json beside this page, served live by
 * _source/server.py or published at build time. When it is unavailable the
 * page falls back to a dated saved field, flagged `snapshot` so the interface
 * can say so. Saved and cached fields keep their original timestamps.
 */
export const REFRESH_INTERVAL = 30 * 60 * 1000;
const STALE_AFTER = 9 * 3600 * 1000;
const cache = new Map();

const isOld = grid => Math.abs(Date.now() - Date.parse(grid.validTime)) > STALE_AFTER;

function hydrate(raw, flags = {}) {
  const count = raw.width * raw.height;
  if (!Number.isInteger(count) || count < 4 || raw.u?.length !== count || raw.v?.length !== count ||
      !Number.isFinite(raw.dx) || !Number.isFinite(raw.dy) || raw.dx <= 0 || raw.dy >= 0 ||
      !Number.isFinite(Date.parse(raw.validTime)) || !Number.isFinite(Date.parse(raw.runTime))) {
    throw new Error('The forecast arrived incomplete.');
  }
  const u = Float32Array.from(raw.u), v = Float32Array.from(raw.v);
  if (!u.every(Number.isFinite) || !v.every(Number.isFinite)) throw new Error('The forecast is missing wind values.');
  const grid = {...raw, u, v, snapshot: Boolean(raw.snapshot), offline: false, ...flags};
  return {...grid, stale: grid.snapshot || isOld(grid)};
}

async function fetchJson(url, {signal, timeout = 16000} = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(new Error('The forecast took too long to arrive.')), timeout);
  try {
    const response = await fetch(url, {signal: controller.signal, cache: 'no-store'});
    if (!response.ok) throw new Error(`The forecast is unavailable (status ${response.status}).`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** The latest field for `level`, the last one fetched, or the saved one, in that order. */
export async function loadWind({level, force = false, signal} = {}) {
  if (level !== 'surface' && level !== 'jet') throw new Error('Unknown level.');
  const prior = cache.get(level);
  if (!force && prior && Date.now() - prior.at < REFRESH_INTERVAL) return {...prior.grid, stale: prior.grid.stale || isOld(prior.grid)};
  try {
    const grid = hydrate(await fetchJson(new URL(`api/${level}.json`, import.meta.url), {signal}));
    cache.set(level, {at: Date.now(), grid});
    return grid;
  } catch (error) {
    // A cancelled request must not resurrect an obsolete layer through a fallback.
    if (signal?.aborted) throw error;
    // Keep whatever is already shown, saved copy included, rather than nothing.
    if (prior) return {...prior.grid, offline: true, stale: true};
    try {
      const grid = hydrate(await fetchJson(new URL(`data/${level}.json`, import.meta.url), {signal, timeout: 8000}), {snapshot: true});
      cache.set(level, {at: Date.now(), grid});
      return grid;
    } catch (snapshotError) {
      if (signal?.aborted) throw snapshotError;
      throw new Error('The forecast and the saved copy are both unavailable.');
    }
  }
}

/**
 * Named storms from the tropical cyclone vitals that started the same model
 * run as `grid`: the current list, else the saved one, else none. A storm list
 * from another run is never used, so labels always sit on the field they name.
 */
export async function loadStorms(grid, {signal} = {}) {
  for (const path of ['api/storms.json', 'data/storms.json']) {
    try {
      const data = await fetchJson(new URL(path, import.meta.url), {signal, timeout: 8000});
      if (data.runTime === grid.runTime && Array.isArray(data.storms)) {
        return data.storms.filter(storm => storm.name && storm.kind && Number.isFinite(storm.lat) && Number.isFinite(storm.lon));
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return [];
}

/** Bilinear interpolation of the grid at a longitude and latitude in degrees. */
export function sampleWind(grid, longitude, latitude) {
  if (!grid || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  const {width, height, lon0, lat0, dx, dy, u, v} = grid;
  const gx = (((longitude - lon0) / dx) % width + width) % width;
  const gy = (latitude - lat0) / dy;
  if (gy < 0 || gy > height - 1) return null;
  const x0 = Math.floor(gx), x1 = (x0 + 1) % width;
  const y0 = Math.floor(gy), y1 = Math.min(y0 + 1, height - 1);
  const tx = gx - x0, ty = gy - y0;
  const a = y0 * width + x0, b = y0 * width + x1;
  const c = y1 * width + x0, d = y1 * width + x1;
  const blend = values => (values[a] * (1 - tx) + values[b] * tx) * (1 - ty) + (values[c] * (1 - tx) + values[d] * tx) * ty;
  const east = blend(u), north = blend(v);
  return {u: east, v: north, speed: Math.hypot(east, north)};
}
