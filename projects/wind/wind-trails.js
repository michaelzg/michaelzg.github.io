import * as THREE from 'three';

const DEG = 180 / Math.PI;
const MAX_LAT = 84 / DEG; // the grid's columns converge at the poles; trails restart before them
const SIN_MAX_LAT = Math.sin(MAX_LAT);
const LIFE = [2.6, 6]; // seconds a trail lives before it starts again elsewhere
const FADE_OUT = .9;
const RADIUS = 1.0035;

const vertexShader = points => /* glsl */ `
  uniform sampler2D uWind;     // RG: eastward, northward m/s
  uniform sampler2D uPalette;
  uniform vec4 uGrid;          // first longitude, first latitude, spacing, in degrees
  uniform vec2 uGridSize;
  uniform float uMaxSpeed, uSpeedScale, uTrail, uWidth, uOpacity;
  uniform vec2 uViewport;      // drawing buffer, in pixels
  attribute vec2 aPoint;       // index along the trail from its head, side of the ribbon
  attribute vec4 aHead;        // longitude, latitude (radians), age, lifetime (seconds)
  varying vec3 vColor;
  varying float vAlpha, vEdge, vHalfWidth;

  const int POINTS = ${points};
  const float DEG = ${DEG};

  vec2 windAt(vec2 p) {
    return texture2D(uWind, ((p * DEG - uGrid.xy) / uGrid.zw + .5) / uGridSize).rg;
  }

  vec3 onSphere(vec2 p) {
    float ring = cos(p.y);
    return vec3(ring * cos(p.x), sin(p.y), -ring * sin(p.x));
  }

  void main() {
    vec3 eye = normalize(cameraPosition);
    float horizon = 1. / length(cameraPosition);
    // The globe hides the far hemisphere; skip its trails before tracing them.
    if (dot(onSphere(aHead.xy), eye) < horizon - .4) {
      gl_Position = vec4(2., 2., 2., 1.);
      return;
    }

    // Step back along the steady field from the head. Every vertex of a trail
    // takes the same steps, so consecutive points join exactly.
    float along = aPoint.x / float(POINTS - 1);
    float stepSize = uSpeedScale * min(aHead.z, uTrail) / float(POINTS - 1);
    vec2 p = aHead.xy;
    vec2 wind = windAt(p);
    for (int i = 0; i < POINTS; i++) {
      if (float(i) >= aPoint.x) break;
      p -= vec2(wind.x / max(cos(p.y), .05), wind.y) * stepSize;
      wind = windAt(p);
    }

    vec3 surface = onSphere(p);
    vec3 east = vec3(-sin(p.x), 0., -cos(p.x));
    vec3 north = vec3(-sin(p.y) * cos(p.x), cos(p.y), sin(p.y) * sin(p.x));
    vec3 heading = east * wind.x + north * wind.y;
    heading = length(heading) > 1e-5 ? normalize(heading) : east;

    vec4 clip = projectionMatrix * modelViewMatrix * vec4(surface * ${RADIUS}, 1.);
    vec4 ahead = projectionMatrix * modelViewMatrix * vec4(surface * ${RADIUS} + heading * .01, 1.);
    vec2 direction = (ahead.xy / ahead.w - clip.xy / clip.w) * uViewport;
    direction = length(direction) > 1e-6 ? normalize(direction) : vec2(1., 0.);

    // Faster winds draw heavier strokes; each tapers from head to tail.
    // Strokes thinner than a pixel fade instead.
    float speed = clamp(length(wind) / uMaxSpeed, 0., 1.);
    float width = uWidth * mix(.7, 1.35, speed) * mix(1., .38, along);
    float coverage = min(width, 1.);
    vHalfWidth = max(width, 1.) * .5;
    vEdge = aPoint.y * (vHalfWidth + 1.);
    clip.xy += vec2(-direction.y, direction.x) * vEdge * 2. / uViewport * clip.w;
    gl_Position = clip;

    vColor = texture2D(uPalette, vec2(speed, .5)).rgb;
    float age = aHead.z, life = aHead.w;
    float lifetime = smoothstep(0., .3, age) * (1. - smoothstep(life - ${FADE_OUT}, life, age));
    float facing = smoothstep(horizon, horizon + .2, dot(surface, eye));
    // Calm air keeps only a faint mark, so slow eddies don't read as noise.
    vAlpha = uOpacity * pow(1. - along, .9) * lifetime * facing * coverage * mix(.28, 1., smoothstep(0., .3, speed));
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha, vEdge, vHalfWidth;
  void main() {
    float alpha = vAlpha * clamp(vHalfWidth + .5 - abs(vEdge), 0., 1.);
    if (alpha < .003) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

function paletteTexture(colors) {
  const interpolate = window.d3.piecewise(window.d3.interpolateRgb, colors);
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const {r, g, b} = window.d3.rgb(interpolate(i / 255));
    data.set([r, g, b, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, 256, 1);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function windTexture(grid) {
  const data = new Uint16Array(grid.u.length * 2);
  for (let i = 0; i < grid.u.length; i++) {
    data[i * 2] = THREE.DataUtils.toHalfFloat(grid.u[i]);
    data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(grid.v[i]);
  }
  const texture = new THREE.DataTexture(data, grid.width, grid.height, THREE.RGFormat, THREE.HalfFloatType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Wind as tapered ribbons on the sphere. Each frame the CPU moves one head per
 * trail through the exact grid; the vertex shader then traces its tail back
 * along the same steady field. Trails keep no history, so they are smooth at
 * any frame rate and complete from the first frame, even when paused.
 */
export class WindTrails {
  constructor({capacity, points, palette}) {
    this.capacity = capacity;
    this.count = 0;
    this.grid = null;
    this.heads = new Float32Array(capacity * 4);
    const corners = new Float32Array(points * 4);
    const index = [];
    for (let k = 0; k < points; k++) {
      corners.set([k, -1, k, 1], k * 4);
      if (k < points - 1) index.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 2, 2 * k + 1, 2 * k + 3);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('aPoint', new THREE.BufferAttribute(corners, 2));
    this.headAttribute = new THREE.InstancedBufferAttribute(this.heads, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aHead', this.headAttribute);
    geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertexShader(points), fragmentShader,
      transparent: true, depthWrite: false,
      uniforms: {
        uWind: {value: null}, uPalette: {value: paletteTexture(palette)},
        uGrid: {value: new THREE.Vector4()}, uGridSize: {value: new THREE.Vector2()},
        uMaxSpeed: {value: 1}, uSpeedScale: {value: 0}, uTrail: {value: 1},
        uWidth: {value: 1}, uOpacity: {value: 1}, uViewport: {value: new THREE.Vector2(1, 1)},
      },
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'wind';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setField(grid, {maxSpeed, speedScale, trail}, keepTrails = false) {
    const uniforms = this.material.uniforms;
    uniforms.uWind.value?.dispose();
    uniforms.uWind.value = windTexture(grid);
    uniforms.uGrid.value.set(grid.lon0, grid.lat0, grid.dx, grid.dy);
    uniforms.uGridSize.value.set(grid.width, grid.height);
    uniforms.uMaxSpeed.value = maxSpeed;
    uniforms.uSpeedScale.value = speedScale;
    uniforms.uTrail.value = trail;
    this.grid = grid;
    this.speedScale = speedScale;
    this.mesh.visible = true;
    if (keepTrails) return;
    // Start every trail full length, partway through its life.
    for (let o = 0; o < this.capacity * 4; o += 4) {
      this.spawn(o);
      this.heads[o + 2] = trail + Math.random() * Math.max(0, this.heads[o + 3] - trail - FADE_OUT);
    }
    this.headAttribute.needsUpdate = true;
  }

  clear() {
    this.grid = null;
    this.mesh.visible = false;
  }

  /** The number of trails drawn, up to the capacity. */
  setCount(count) {
    this.count = Math.max(0, Math.min(this.capacity, Math.round(count)));
    this.mesh.geometry.instanceCount = this.count;
  }

  setViewport(width, height, strokeWidth) {
    this.material.uniforms.uViewport.value.set(width, height);
    this.material.uniforms.uWidth.value = strokeWidth;
  }

  spawn(o) {
    this.heads[o] = (Math.random() * 2 - 1) * Math.PI;
    this.heads[o + 1] = Math.asin((Math.random() * 2 - 1) * SIN_MAX_LAT);
    this.heads[o + 2] = 0;
    this.heads[o + 3] = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]);
  }

  /** Advance every head by dt seconds through the grid, by bilinear interpolation. */
  step(dt) {
    const grid = this.grid;
    if (!grid || !this.count) return;
    const {u, v, width, height, lon0, lat0, dx, dy} = grid;
    const heads = this.heads, scale = this.speedScale * dt;
    for (let o = 0, end = this.count * 4; o < end; o += 4) {
      const age = heads[o + 2] + dt;
      if (age >= heads[o + 3]) {
        this.spawn(o);
        continue;
      }
      const lon = heads[o], lat = heads[o + 1];
      let gx = (lon * DEG - lon0) / dx;
      gx -= Math.floor(gx / width) * width;
      const gy = (lat * DEG - lat0) / dy;
      const x0 = gx | 0, y0 = gy | 0;
      const x1 = x0 + 1 === width ? 0 : x0 + 1, y1 = Math.min(y0 + 1, height - 1);
      const tx = gx - x0, ty = gy - y0;
      const a = y0 * width + x0, b = y0 * width + x1, c = y1 * width + x0, d = y1 * width + x1;
      const east = (u[a] + (u[b] - u[a]) * tx) * (1 - ty) + (u[c] + (u[d] - u[c]) * tx) * ty;
      const north = (v[a] + (v[b] - v[a]) * tx) * (1 - ty) + (v[c] + (v[d] - v[c]) * tx) * ty;
      const nextLat = lat + north * scale;
      if (nextLat > MAX_LAT || nextLat < -MAX_LAT) {
        this.spawn(o);
        continue;
      }
      let nextLon = lon + east * scale / Math.cos(lat);
      if (nextLon > Math.PI) nextLon -= 2 * Math.PI;
      else if (nextLon < -Math.PI) nextLon += 2 * Math.PI;
      heads[o] = nextLon;
      heads[o + 1] = nextLat;
      heads[o + 2] = age;
    }
    this.headAttribute.clearUpdateRanges();
    this.headAttribute.addUpdateRange(0, this.count * 4);
    this.headAttribute.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.uniforms.uWind.value?.dispose();
    this.material.uniforms.uPalette.value.dispose();
    this.material.dispose();
  }
}
