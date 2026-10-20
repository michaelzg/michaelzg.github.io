import {loadWind, loadStorms, sampleWind, REFRESH_INTERVAL} from './wind-data.js';
import {WindGlobe, PALETTE} from './globe-renderer.js';

const $ = id => document.getElementById(id);
const d3 = window.d3;

// Trail motion is sped up for visibility, and eases off above `ease` m/s so storms
// stay legible; the jet stream is sped up less because it is faster.
// `key` is each unit's color scale: its top speed and tick spacing, round in that
// unit. Trail colors follow the scale shown, so the key always reads exactly.
const LEVELS = {
  surface: {dek: 'Near the surface, 10 meters up', name: 'surface', speedScale: .0132, ease: 8, trail: 1.3,
    key: {'km/h': [100, 25], 'm/s': [25, 5], knots: [50, 10]}},
  jet: {dek: 'In the jet stream, about 10 kilometers up', name: 'jet stream', speedScale: .0042, ease: 35, trail: 1.3,
    key: {'km/h': [300, 100], 'm/s': [80, 20], knots: [160, 40]}},
};
const UNITS = [
  {label: 'km/h', name: 'kilometers per hour', factor: 3.6, digits: 0},
  {label: 'm/s', name: 'meters per second', factor: 1, digits: 1},
  {label: 'knots', name: 'knots', factor: 1.943844, digits: 0},
];
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast',
  'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
// Natural Earth abbreviates these; readings spell them out.
const PLACE_NAMES = {
  'United States of America': 'United States', 'Dem. Rep. Congo': 'Democratic Republic of the Congo',
  'Central African Rep.': 'Central African Republic', 'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea', 'Bosnia and Herz.': 'Bosnia and Herzegovina', 'S. Sudan': 'South Sudan',
  'W. Sahara': 'Western Sahara', 'N. Cyprus': 'Northern Cyprus', 'Solomon Is.': 'Solomon Islands',
  'Falkland Is.': 'Falkland Islands', 'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands',
};
const motion = matchMedia('(prefers-reduced-motion: reduce)');

const clock = (() => {
  const options = {month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'};
  let format;
  try {
    format = new Intl.DateTimeFormat('en-US', {...options, timeZoneName: 'longGeneric'});
  } catch {
    format = new Intl.DateTimeFormat('en-US', {...options, timeZoneName: 'long'});
  }
  return date => {
    const part = Object.fromEntries(format.formatToParts(new Date(date)).map(({type, value}) => [type, value]));
    // Zones without an English name come back as an offset such as "GMT+01:00".
    const zone = /\b[A-Z]{2,}\b/.test(part.timeZoneName) ? 'local time' : part.timeZoneName;
    return `${part.month} ${part.day}, ${part.hour}:${part.minute} ${zone}`;
  };
})();

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ } },
};

function describe(wind, unit) {
  const speed = (wind.speed * unit.factor).toFixed(unit.digits);
  if (wind.speed < .3) return {speed, from: 'Calm', bearing: null};
  // Meteorological direction: where the wind comes from, clockwise from north.
  const bearing = (Math.atan2(-wind.u, -wind.v) * 180 / Math.PI + 360) % 360;
  return {speed, from: `From the ${COMPASS[Math.round(bearing / 22.5) % 16]}`, bearing};
}

/**
 * Where the model draws a storm: the strongest cyclonic spin within 3° of the
 * warning center's position, so its name sits on the spiral it labels.
 */
function vortexCenter(grid, lon, lat) {
  const spin = lat >= 0 ? 1 : -1, h = .5;
  let center = [lon, lat], strongest = 4; // m/s per degree; weaker spin keeps the reported position
  for (let dy = -3; dy <= 3; dy += .25) {
    for (let dx = -3; dx <= 3; dx += .25) {
      if (dx * dx + dy * dy > 9) continue;
      const y = lat + dy, stretch = Math.cos(y * Math.PI / 180), x = lon + dx / stretch;
      const east = sampleWind(grid, x + h / stretch, y), west = sampleWind(grid, x - h / stretch, y);
      const north = sampleWind(grid, x, y + h), south = sampleWind(grid, x, y - h);
      if (!east || !west || !north || !south) continue;
      const vorticity = spin * (east.v - west.v - north.u + south.u) / (2 * h);
      if (vorticity > strongest) [strongest, center] = [vorticity, [x, y]];
    }
  }
  return center;
}

function coordinates([lon, lat]) {
  const part = (value, positive, negative) => `${Math.abs(value).toFixed(1)}° ${value >= 0 ? positive : negative}`;
  return `${part(lat, 'north', 'south')}, ${part(lon, 'east', 'west')}`;
}

async function start() {
  const state = {
    level: 'surface', unit: Math.max(0, UNITS.findIndex(unit => unit.label === storage.get('wind-unit'))),
    paused: motion.matches, grid: null, selected: null, storms: [], loading: false, request: 0,
  };
  let controller, poll, pageCached = false;
  const dialog = $('about-dialog');
  const reading = $('reading');
  const stormLayer = $('storms');
  const announce = text => { $('status').textContent = text; };

  const globe = new WindGlobe($('globe'), {
    reducedMotion: motion.matches,
    onPick: point => select(point),
    onFrame: () => {
      placeReading();
      placeStorms();
    },
  });

  function select(point) {
    if (!point) return clearSelection();
    if (!state.grid) return;
    state.selected = point;
    globe.setSelection(point);
    updateReading();
    announce(`${$('reading-speed').textContent} ${UNITS[state.unit].name}, ${$('reading-from').textContent.toLowerCase()}, at ${$('reading-place').textContent}.`);
  }

  function clearSelection() {
    state.selected = null;
    globe.setSelection(null);
    reading.hidden = true;
  }

  function placeAt([lon, lat]) {
    const country = globe.countries?.find(feature => d3.geoContains(feature, [lon, lat]));
    const name = country && (PLACE_NAMES[country.properties.name] ?? country.properties.name);
    return name ? `${name} · ${coordinates([lon, lat])}` : coordinates([lon, lat]);
  }

  function updateReading() {
    const wind = state.selected && sampleWind(state.grid, ...state.selected);
    if (!wind) {
      reading.hidden = true;
      return;
    }
    const unit = UNITS[state.unit];
    const {speed, from, bearing} = describe(wind, unit);
    $('reading-speed').textContent = speed;
    $('reading-unit').textContent = unit.label;
    $('reading-from').textContent = from;
    $('reading-place').textContent = placeAt(state.selected);
    reading.dataset.bearing = bearing ?? '';
    reading.hidden = false;
    placeReading();
  }

  // The reading sits beside its marker, or above or below it where the sides
  // are too narrow, and follows it as the globe turns.
  function placeReading() {
    if (reading.hidden || !state.selected) return;
    const [lon, lat] = state.selected;
    const {x, y, facing} = globe.project(lon, lat);
    const {width, height} = globe.layout;
    const w = reading.offsetWidth, h = reading.offsetHeight, gap = 16, edge = 8;
    const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
    let side, left, top;
    if (x + gap + w <= width - edge) [side, left, top] = ['right', x + gap, y - 20];
    else if (x - gap - w >= edge) [side, left, top] = ['left', x - gap - w, y - 20];
    else if (y - gap - h >= edge) [side, left, top] = ['above', x - w / 2, y - gap - h];
    else [side, left, top] = ['below', x - w / 2, y + gap];
    reading.dataset.side = side;
    reading.classList.toggle('is-behind', facing < .02);
    reading.style.transform = `translate(${Math.round(clamp(left, edge, width - w - edge))}px, ${Math.round(clamp(top, edge, height - h - edge))}px)`;
    const bearing = reading.dataset.bearing;
    $('reading-arrow').style.visibility = bearing === '' ? 'hidden' : 'visible';
    if (bearing !== '') $('reading-arrow').style.transform = `rotate(${globe.screenAngle(lon, lat, (+bearing + 180) % 360)}deg)`;
  }

  // Named storms are surface features, labeled on the surface field only.
  async function showStorms(grid, request, signal) {
    const storms = state.level === 'surface' ? await loadStorms(grid, {signal}).catch(() => []) : [];
    if (request !== state.request) return;
    state.storms = storms.map(storm => ({...storm, at: vortexCenter(grid, storm.lon, storm.lat)}));
    stormLayer.replaceChildren(...state.storms.map(storm => {
      const label = document.createElement('p');
      label.className = 'storm';
      label.setAttribute('role', 'listitem');
      label.innerHTML = '<span class="storm-kind"></span> <span class="storm-name"></span>';
      label.firstChild.textContent = storm.kind;
      label.lastChild.textContent = storm.name;
      return label;
    }));
    placeStorms();
  }

  function clearStorms() {
    state.storms = [];
    stormLayer.replaceChildren();
  }

  // Each name sits clear of its storm's bright core, about 3° out, on a leader
  // from the eye that grows with zoom.
  function placeStorms() {
    const {width} = globe.layout;
    const leader = Math.round(Math.min(90, Math.max(22, globe.pixelsPerRadian() * 3 * Math.PI / 180)));
    state.storms.forEach((storm, i) => {
      const label = stormLayer.children[i];
      const {x, y, facing} = globe.project(...storm.at);
      label.style.setProperty('--leader', `${leader}px`);
      const w = label.offsetWidth, left = x + 6 + w > width - 8;
      label.classList.toggle('is-left', left);
      label.classList.toggle('is-behind', facing < .05);
      label.style.transform = `translate(${Math.round(left ? x - 6 - w : x + 6)}px, ${Math.round(y - label.offsetHeight / 2)}px)`;
    });
  }

  /** The fastest speed on the key, in m/s, for the current level and unit. */
  function keyTop() {
    const unit = UNITS[state.unit];
    return LEVELS[state.level].key[unit.label][0] / unit.factor;
  }

  function updateLegend() {
    const unit = UNITS[state.unit], [top, step] = LEVELS[state.level].key[unit.label];
    $('units').textContent = unit.label;
    $('units').setAttribute('aria-label', `${unit.label}, ${unit.name}. Change units`);
    $('legend-ticks').replaceChildren(...d3.range(0, top + step / 2, step).map(value => {
      const tick = document.createElement('span');
      tick.textContent = value === top ? `${value}+` : value;
      tick.style.left = `${value / top * 100}%`;
      return tick;
    }));
    globe.setColorScale(keyTop());
    updateReading();
  }

  function updateLabels() {
    const grid = state.grid, level = LEVELS[state.level];
    $('dek').textContent = level.dek;
    if (!grid) return;
    $('time').textContent = `Forecast for ${clock(grid.validTime)}`;
    $('model-run').textContent = clock(grid.runTime);
    $('valid-time').textContent = clock(grid.validTime);
    $('checked').textContent = clock(grid.fetchedAt);
    const notice = grid.snapshot ? 'The latest forecast couldn’t be loaded, so this is a saved copy.'
      : grid.offline ? 'The latest forecast couldn’t be refreshed.'
      : grid.stale ? 'This forecast is more than nine hours old.' : '';
    $('state').hidden = !grid.snapshot;
    $('notice-text').textContent = notice;
    $('notice').hidden = !notice;
  }

  async function changeLayer(level, force = false) {
    if (state.loading && state.level === level && !force) return;
    const request = ++state.request;
    controller?.abort();
    controller = new AbortController();
    // A different layer's trails and reading must never sit under this layer's
    // labels. A refresh of the same layer keeps showing it until the new one lands.
    if (state.grid?.level !== level) {
      state.grid = null;
      globe.clearData();
      clearStorms();
      reading.hidden = true;
      $('notice').hidden = true;
      $('state').hidden = true;
      $('time').textContent = 'Loading the latest forecast…';
    }
    state.loading = true;
    state.level = level;
    $('error').hidden = true;
    $('globe').setAttribute('aria-busy', 'true');
    for (const button of document.querySelectorAll('[data-level]')) button.setAttribute('aria-pressed', String(button.dataset.level === level));
    updateLabels();
    updateLegend();
    announce(`Loading ${LEVELS[level].name} winds.`);
    try {
      const grid = await loadWind({level, force, signal: controller.signal});
      if (request !== state.request) return;
      state.grid = grid;
      globe.setData(grid, {...LEVELS[level], maxSpeed: keyTop()});
      updateLabels();
      showStorms(grid, request, controller.signal);
      announce(`${LEVELS[level].dek}. Forecast for ${clock(grid.validTime)}.${grid.snapshot ? ' This is a saved copy.' : ''}`);
    } catch (error) {
      if (request !== state.request) return;
      state.grid = null;
      globe.clearData();
      clearStorms();
      $('time').textContent = 'Forecast unavailable';
      $('error-text').textContent = error.message;
      $('error').hidden = false;
      announce('The forecast is unavailable. Try again to reconnect.');
    } finally {
      if (request === state.request) {
        state.loading = false;
        $('globe').setAttribute('aria-busy', 'false');
        updateReading();
      }
    }
  }

  function syncPause() {
    globe.setPaused(state.paused);
    $('pause').setAttribute('aria-pressed', String(state.paused));
  }
  const togglePause = () => { state.paused = !state.paused; syncPause(); };

  $('pause').addEventListener('click', togglePause);
  $('units').addEventListener('click', () => {
    state.unit = (state.unit + 1) % UNITS.length;
    storage.set('wind-unit', UNITS[state.unit].label);
    updateLegend();
  });
  $('reset').addEventListener('click', () => globe.resetView());
  for (const button of document.querySelectorAll('[data-level]')) button.addEventListener('click', () => {
    if (button.dataset.level !== state.level || !state.grid) changeLayer(button.dataset.level);
  });
  for (const id of ['retry', 'reload']) $(id).addEventListener('click', () => changeLayer(state.level, true));

  $('about').addEventListener('click', () => {
    dialog.showModal();
    globe.setSuspended(true);
  });
  $('close-about').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => globe.setSuspended(pageCached));
  // Clicks on the dialog's own padding also target it; only the backdrop closes it.
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });

  document.addEventListener('keydown', event => {
    if (dialog.open || event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable) return;
    if (event.key === 'Escape' && state.selected) return clearSelection();
    if (event.target.closest('button, a, input, select, textarea')) return;
    const turns = {ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 8], ArrowDown: [0, -8]};
    if (turns[event.key]) globe.turnBy(...turns[event.key]);
    else if (event.key === ' ') togglePause();
    else if (event.key === '+' || event.key === '=') globe.zoomBy(1.25);
    else if (event.key === '-' || event.key === '_') globe.zoomBy(.8);
    else if (event.key === '0' || event.key === 'Home') globe.resetView();
    else if (event.key === 'Enter' && event.target === $('stage')) select(globe.center());
    else return;
    event.preventDefault();
  });

  motion.addEventListener('change', event => {
    globe.reducedMotion = event.matches;
    if (event.matches) {
      state.paused = true;
      syncPause();
    }
  });

  // Landscape: the globe fills the height, beside the title or shifted right of
  // it. Portrait: the whole disc is centered between the title and the source.
  const masthead = document.querySelector('.masthead'), toolbar = document.querySelector('.toolbar');
  const credit = document.querySelector('.credit');
  function layout() {
    const width = innerWidth, height = innerHeight;
    const title = masthead.getBoundingClientRect();
    const floor = Math.min(...[toolbar, credit].map(element => element.getBoundingClientRect())
      .filter(box => box.height).map(box => box.top)) - 24;
    const margin = Math.min(24, height * .03);
    let radius = Math.min((floor - margin) / 2, width * .58);
    let x = width / 2, y = margin + (floor - margin) / 2;
    const clear = cx => Math.hypot(cx - Math.min(cx, title.right), y - Math.min(y, title.bottom)) > radius + 12;
    if (width < height || !clear(x)) {
      const beside = title.right + 28 + radius;
      if (width >= height && beside + radius * .9 <= width && clear(beside)) x = beside;
      else {
        const top = title.bottom + 16, band = floor - top;
        radius = Math.min(band / 2, width / 2 - 8);
        y = top + band / 2;
      }
    }
    globe.setLayout({x, y, radius});
  }
  const observer = new ResizeObserver(layout);
  for (const element of [masthead, toolbar, credit, document.documentElement]) observer.observe(element);

  function startPolling() {
    clearInterval(poll);
    poll = setInterval(() => { if (!document.hidden && !state.loading) changeLayer(state.level, true); }, REFRESH_INTERVAL);
  }
  addEventListener('pagehide', event => {
    clearInterval(poll);
    pageCached = event.persisted;
    if (pageCached) globe.setSuspended(true);
    else {
      controller?.abort();
      globe.dispose();
    }
  });
  addEventListener('pageshow', event => {
    if (!event.persisted) return;
    pageCached = false;
    globe.setSuspended(dialog.open);
    startPolling();
    changeLayer(state.level, true);
  });

  $('legend-bar').style.background = `linear-gradient(90deg, ${PALETTE.join(', ')})`;
  syncPause();
  updateLegend();
  await Promise.all([globe.ready, changeLayer('surface')]);
  if (!pageCached) startPolling();
}

start().catch(error => {
  $('time').textContent = 'Globe unavailable';
  $('error-text').textContent = 'This globe needs a browser with 3D graphics turned on.';
  $('reload').textContent = 'Reload';
  $('reload').addEventListener('click', () => location.reload());
  $('error').hidden = false;
  console.warn('The globe could not start.', error);
});
