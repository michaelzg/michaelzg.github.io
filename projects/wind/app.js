import {loadWind, loadStorms, sampleWind, REFRESH_INTERVAL} from './wind-data.js';
import {WindGlobe, PALETTE} from './globe-renderer.js';

const $ = id => document.getElementById(id);
const d3 = window.d3;
const RAD = Math.PI / 180;

// Trail motion is sped up for visibility and eases off above `ease` m/s, so storms
// stay legible; the jet stream is sped up less because it is faster. `key` is each
// unit's color scale, its top speed and tick spacing round in that unit; trail
// colors follow the scale shown, so the key always reads exactly.
const LEVELS = {
  surface: {dek: 'Near the surface, 10 meters up', speedScale: .0132, ease: 8, trail: 1.3,
    key: {'km/h': [100, 25], 'm/s': [25, 5], knots: [50, 10]}},
  jet: {dek: 'In the jet stream, about 10 kilometers up', speedScale: .0042, ease: 35, trail: 1.3,
    key: {'km/h': [300, 100], 'm/s': [80, 20], knots: [160, 40]}},
};
const UNITS = [
  {label: 'km/h', name: 'kilometers per hour', factor: 3.6, digits: 0},
  {label: 'm/s', name: 'meters per second', factor: 1, digits: 1},
  {label: 'knots', name: 'knots', factor: 1.943844, digits: 0},
];
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast',
  'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
const CLOCK = new Intl.DateTimeFormat('en-US',
  {month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longGeneric'});

const when = date => {
  const part = Object.fromEntries(CLOCK.formatToParts(new Date(date)).map(({type, value}) => [type, value]));
  return `${part.month} ${part.day}, ${part.hour}:${part.minute} ${part.timeZoneName}`;
};
const coordinates = ([lon, lat]) => [[lat, 'north', 'south'], [lon, 'east', 'west']]
  .map(([value, positive, negative]) => `${Math.abs(value).toFixed(1)}° ${value >= 0 ? positive : negative}`).join(', ');
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const span = (className, textContent) => Object.assign(document.createElement('span'), {className, textContent});

/** Where the model draws a storm: the strongest cyclonic spin within 3° of its reported position. */
function vortexCenter(grid, lon, lat) {
  const spin = Math.sign(lat) || 1;
  let center = [lon, lat], strongest = 4; // m/s per degree; weaker spin keeps the reported position
  for (let dy = -3; dy <= 3; dy += .25) {
    for (let dx = -3; dx <= 3; dx += .25) {
      const y = lat + dy, stretch = Math.cos(y * RAD), x = lon + dx / stretch;
      const [east, west, north, south] = [[x + .5 / stretch, y], [x - .5 / stretch, y], [x, y + .5], [x, y - .5]]
        .map(point => sampleWind(grid, ...point));
      const vorticity = dx * dx + dy * dy <= 9 && east && west && north && south && spin * (east.v - west.v - north.u + south.u);
      if (vorticity > strongest) [strongest, center] = [vorticity, [x, y]];
    }
  }
  return center;
}

const state = {level: 'surface', unit: 0, grid: null, selected: null, storms: [], request: 0,
  paused: matchMedia('(prefers-reduced-motion: reduce)').matches};
const unit = () => UNITS[state.unit];
const keyTop = () => LEVELS[state.level].key[unit().label][0] / unit().factor;
const reading = $('reading'), stormLayer = $('storms'), dialog = $('about-dialog');
const masthead = document.querySelector('.masthead'), toolbar = document.querySelector('.toolbar'), credit = document.querySelector('.credit');
const announce = text => { $('status').textContent = text; };
let globe, controller;

function select(point) {
  state.selected = point && state.grid ? point : null;
  globe.setSelection(state.selected);
  updateReading();
  if (state.selected) announce(`${$('reading-speed').textContent} ${unit().name}, ${$('reading-from').textContent.toLowerCase()}, at ${$('reading-place').textContent}.`);
}

function updateReading() {
  const wind = state.selected && state.grid && sampleWind(state.grid, ...state.selected);
  reading.hidden = !wind;
  if (!wind) return;
  const {label, factor, digits} = unit(), calm = wind.speed < .3;
  // Meteorological direction: where the wind comes from, clockwise from north.
  const bearing = (Math.atan2(-wind.u, -wind.v) / RAD + 360) % 360;
  $('reading-speed').textContent = (wind.speed * factor).toFixed(digits);
  $('reading-unit').textContent = label;
  $('reading-from').textContent = calm ? 'Calm' : `From the ${COMPASS[Math.round(bearing / 22.5) % 16]}`;
  $('reading-place').textContent = coordinates(state.selected);
  reading.dataset.bearing = calm ? '' : bearing;
  placeReading();
}

// The reading sits beside its marker, or above or below it where the sides are
// too narrow, and follows it as the globe turns.
function placeReading() {
  if (reading.hidden) return;
  const [lon, lat] = state.selected, {x, y, facing} = globe.project(lon, lat), {width, height} = globe.layout;
  const w = reading.offsetWidth, h = reading.offsetHeight;
  const side = x + 16 + w <= width - 8 ? 'right' : x - 16 - w >= 8 ? 'left' : y - 16 - h >= 8 ? 'above' : 'below';
  const left = {right: x + 16, left: x - 16 - w}[side] ?? x - w / 2;
  const top = {above: y - 16 - h, below: y + 16}[side] ?? y - 20;
  reading.dataset.side = side;
  reading.classList.toggle('is-behind', facing < .02);
  reading.style.transform = `translate(${Math.round(clamp(left, 8, width - w - 8))}px, ${Math.round(clamp(top, 8, height - h - 8))}px)`;
  const bearing = reading.dataset.bearing, arrow = $('reading-arrow');
  arrow.style.visibility = bearing ? 'visible' : 'hidden';
  if (bearing) arrow.style.transform = `rotate(${globe.screenAngle(lon, lat, (+bearing + 180) % 360)}deg)`;
}

// Each storm is named with the advisory's peak sustained wind: the 1° field
// smooths a storm's core, so a reading at the eye shows less.
function showStorms(storms) {
  state.storms = storms;
  const {label, factor, digits} = unit();
  stormLayer.replaceChildren(...storms.map(storm => {
    const item = Object.assign(document.createElement('p'), {className: 'storm'});
    item.setAttribute('role', 'listitem');
    item.append(span('storm-kind', storm.kind), ' ', span('storm-name', storm.name), ' ',
      span('storm-wind', `· ${(storm.maxWind * factor).toFixed(digits)} ${label}`));
    return item;
  }));
  placeStorms();
}

// A name sits clear of its storm's bright core, about 3° out, on a leader from the eye.
function placeStorms() {
  const leader = Math.round(clamp(globe.pixelsPerRadian() * 3 * RAD, 30, 90));
  state.storms.forEach((storm, i) => {
    const item = stormLayer.children[i], {x, y, facing} = globe.project(...storm.at);
    item.style.setProperty('--leader', `${leader}px`);
    const left = x + 6 + item.offsetWidth > globe.layout.width - 8;
    item.classList.toggle('is-left', left);
    item.classList.toggle('is-behind', facing < .05);
    item.style.transform = `translate(${Math.round(left ? x - 6 - item.offsetWidth : x + 6)}px, ${Math.round(y - item.offsetHeight / 2)}px)`;
  });
}

function updateKey() {
  const {label, name} = unit(), [top, step] = LEVELS[state.level].key[label];
  $('units').textContent = label;
  $('units').setAttribute('aria-label', `${label}, ${name}. Change units`);
  $('legend-ticks').replaceChildren(...d3.range(0, top + step / 2, step)
    .map(value => Object.assign(span('', value === top ? `${value}+` : value), {style: `left: ${value / top * 100}%`})));
  globe.setColorScale(keyTop());
  showStorms(state.storms);
  updateReading();
}

function updateLabels(grid) {
  $('time').textContent = `Forecast for ${when(grid.validTime)}`;
  $('valid-time').textContent = when(grid.validTime);
  $('model-run').textContent = when(grid.runTime);
  $('checked').textContent = when(grid.fetchedAt);
  const notice = grid.snapshot ? 'The latest forecast couldn’t be loaded, so this is a saved copy.'
    : grid.offline ? 'The latest forecast couldn’t be refreshed.'
    : grid.stale ? 'This forecast is more than nine hours old.' : '';
  $('state').hidden = !grid.snapshot;
  $('notice-text').textContent = notice;
  $('notice').hidden = !notice;
}

async function changeLayer(level, force = false) {
  const request = ++state.request;
  controller?.abort();
  controller = new AbortController();
  // Another layer's trails, reading and storms never sit under this layer's labels;
  // a refresh of the same layer keeps showing it until the new one lands.
  if (state.grid?.level !== level) {
    state.grid = null;
    globe.clearData();
    showStorms([]);
    reading.hidden = $('notice').hidden = $('state').hidden = true;
    $('time').textContent = 'Loading the latest forecast…';
  }
  state.level = level;
  $('error').hidden = true;
  $('dek').textContent = LEVELS[level].dek;
  for (const button of document.querySelectorAll('[data-level]')) button.setAttribute('aria-pressed', button.dataset.level === level);
  updateKey();
  try {
    const grid = await loadWind(level, controller.signal, force);
    if (request !== state.request) return;
    state.grid = grid;
    globe.setData(grid, {...LEVELS[level], maxSpeed: keyTop()});
    updateLabels(grid);
    updateReading();
    announce(`${LEVELS[level].dek}. Forecast for ${when(grid.validTime)}.`);
    // Named storms are surface features.
    const storms = level === 'surface' ? await loadStorms(grid, controller.signal) : [];
    if (request === state.request) showStorms(storms.map(storm => ({...storm, at: vortexCenter(grid, storm.lon, storm.lat)})));
  } catch (error) {
    if (request !== state.request) return;
    state.grid = null;
    globe.clearData();
    showStorms([]);
    reading.hidden = true;
    $('time').textContent = 'Forecast unavailable';
    $('error-text').textContent = error.message;
    $('error').hidden = false;
  }
}

// Landscape: the globe fills the height, stepping right of the title if they would
// meet, and opens a little closer in. Portrait: it sits between the title and the
// source and opens filling that height, as a full-bleed disc.
function layout() {
  const width = innerWidth, height = innerHeight, title = masthead.getBoundingClientRect();
  const floor = Math.min(...[toolbar, credit].map(element => element.getBoundingClientRect())
    .filter(box => box.height).map(box => box.top)) - 24;
  const margin = Math.min(24, height * .03);
  let radius = Math.min(floor - margin, width * 1.16) / 2;
  const y = (margin + floor) / 2;
  // The nearest center that keeps the globe, at its opening zoom, 12 pixels clear of the title.
  const x = Math.max(width / 2, title.right + Math.sqrt(Math.max(0, (radius * 1.2 + 12) ** 2 - Math.max(0, y - title.bottom) ** 2)));
  if (width >= height && x + radius * .9 <= width) return globe.setLayout({x, y, radius, homeScale: 1.2});
  const top = title.bottom + 16, band = floor - top;
  radius = Math.min(band / 2, width / 2 - 8);
  globe.setLayout({x: width / 2, y: top + band / 2, radius, homeScale: width < height ? clamp(band / 2 / radius, 1, 1.6) : 1.2});
}

function togglePause() {
  state.paused = globe.paused = !state.paused;
  $('pause').setAttribute('aria-pressed', state.paused);
}

try {
  globe = new WindGlobe($('globe'), {
    reducedMotion: state.paused,
    onPick: select,
    onFrame: () => { placeReading(); placeStorms(); },
  });
} catch {
  $('time').textContent = 'Globe unavailable';
  $('error-text').textContent = 'This globe needs a browser with 3D graphics turned on.';
  $('error').hidden = false;
  $('reload').hidden = true;
}

if (globe) {
  globe.paused = state.paused;
  $('pause').setAttribute('aria-pressed', state.paused);
  $('legend-bar').style.background = `linear-gradient(90deg, ${PALETTE.join(', ')})`;
  $('pause').addEventListener('click', togglePause);
  $('units').addEventListener('click', () => {
    state.unit = (state.unit + 1) % UNITS.length;
    updateKey();
  });
  $('reset').addEventListener('click', () => globe.resetView());
  for (const button of document.querySelectorAll('[data-level]')) {
    button.addEventListener('click', () => button.dataset.level === state.level && state.grid || changeLayer(button.dataset.level));
  }
  for (const id of ['retry', 'reload']) $(id).addEventListener('click', () => changeLayer(state.level, true));
  $('about').addEventListener('click', () => dialog.showModal());
  $('close-about').addEventListener('click', () => dialog.close());
  // Clicks on the dialog's own padding also target it; only the backdrop closes it.
  dialog.addEventListener('click', ({clientX: x, clientY: y}) => {
    const box = dialog.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) dialog.close();
  });
  document.addEventListener('keydown', event => {
    if (dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') return select(null);
    if (event.target.closest('button, a')) return;
    const turn = {ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 8], ArrowDown: [0, -8]}[event.key];
    if (turn) globe.turnBy(...turn);
    else if (event.key === ' ') togglePause();
    else if (event.key === '+' || event.key === '=') globe.zoomBy(1.25);
    else if (event.key === '-' || event.key === '_') globe.zoomBy(.8);
    else if (event.key === '0' || event.key === 'Home') globe.resetView();
    else if (event.key === 'Enter' && event.target === $('stage')) select(globe.center());
    else return;
    event.preventDefault();
  });
  const observer = new ResizeObserver(layout);
  for (const element of [masthead, toolbar, credit, document.documentElement]) observer.observe(element);
  setInterval(() => document.hidden || changeLayer(state.level, true), REFRESH_INTERVAL);
  changeLayer('surface');
}
