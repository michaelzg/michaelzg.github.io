import * as THREE from 'three';
import {geoToVector, sphereLines} from './globe-geometry.js';
import {WindTrails} from './wind-trails.js';

// Every color here is a display value, as in CSS; nothing is converted.
THREE.ColorManagement.enabled = false;

const RAD = Math.PI / 180;
const FOV = 30;
const HOME = {lon: -32, lat: 22, scale: 1.2};
const ZOOM = [.7, 3.5];
const MAX_VIEW_LAT = 86;
// Trail length grows with the globe, so a count in proportion to its radius
// (trails per CSS pixel) keeps the density even at any size.
const TRAILS_PER_PIXEL = 64;
const STROKE = 1.5; // trail width at its head, in CSS pixels
const COLORS = {background: '#070b10', ocean: '#0d1721', ground: '#252d35', coast: '#7b8893', border: '#3e4952'};
// Lightness rises steadily with speed (CIE L* 53 to 95), so the fastest winds are
// the brightest marks, and the calmest still read over ocean and land.
export const PALETTE = ['#5582b2', '#8086c2', '#b483bb', '#e48a80', '#f5a561', '#facb6c', '#fdf2b5'];

const clamp = THREE.MathUtils.clamp;
const shortest = degrees => ((degrees + 540) % 360) - 180;

export class WindGlobe {
  constructor(canvas, {onPick, onFrame, reducedMotion}) {
    Object.assign(this, {canvas, onPick, onFrame, reducedMotion, paused: false, dirty: true,
      home: {...HOME}, view: {...HOME}, target: {...HOME}, velocity: {lon: 0, lat: 0}, pointers: new Map(),
      layout: {width: 1, height: 1, radius: 0}});
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(COLORS.background);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, .01, 30);
    this.raycaster = new THREE.Raycaster();

    // Ocean and land on an equirectangular texture; the land is painted once it loads.
    const surface = Object.assign(document.createElement('canvas'), {width: coarse ? 2048 : 4096, height: coarse ? 1024 : 2048});
    const paint = surface.getContext('2d');
    paint.fillStyle = COLORS.ocean;
    paint.fillRect(0, 0, surface.width, surface.height);
    const texture = new THREE.CanvasTexture(surface);
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 144, 96), new THREE.ShaderMaterial({
      uniforms: {uMap: {value: texture}},
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vFacing;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.);
          vFacing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying float vFacing;
        void main() {
          // A gentle darkening toward the edge is all the shading the sphere needs.
          gl_FragColor = vec4(texture2D(uMap, vUv).rgb * mix(.58, 1., smoothstep(0., .7, vFacing)), 1.);
        }`,
    })));

    // A thin glow just outside the edge, measured from where each view ray passes the globe.
    const rim = new THREE.Mesh(new THREE.SphereGeometry(1.12, 96, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          float miss = length(cross(normalize(vWorld - cameraPosition), cameraPosition));
          gl_FragColor = vec4(vec3(.32, .47, .62) * pow(1. - smoothstep(1., 1.12, miss), 4.) * .42, 1.);
        }`,
    }));
    rim.renderOrder = 1;
    this.scene.add(rim);

    this.trails = new WindTrails({capacity: coarse ? 12000 : 32000, points: coarse ? 18 : 26, palette: PALETTE});
    this.trails.mesh.renderOrder = 3;
    this.scene.add(this.trails.mesh);

    // The chosen point: a dot in a ring, sized in CSS pixels (placeCamera keeps them so).
    this.marker = new THREE.Group();
    for (const [inner, outer, color, opacity] of [[0, 2.4, 0xffffff, 1], [5.6, 7, 0xffffff, .95], [7, 8.6, 0x070b10, .5]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40),
        new THREE.MeshBasicMaterial({color, transparent: true, opacity, depthWrite: false}));
      ring.renderOrder = 4;
      this.marker.add(ring);
    }
    this.marker.visible = false;
    this.scene.add(this.marker);

    const {d3, topojson} = window;
    Promise.all(['land', 'countries'].map(name => d3.json(new URL(`data/${name}-110m.json`, import.meta.url))))
      .then(([land, countries]) => {
        paint.fillStyle = COLORS.ground;
        paint.beginPath();
        d3.geoPath(d3.geoEquirectangular().translate([surface.width / 2, surface.height / 2]).scale(surface.width / (2 * Math.PI)), paint)(
          topojson.feature(land, land.objects.land));
        paint.fill();
        texture.needsUpdate = true;
        for (const [mesh, radius, color, opacity] of [
          [topojson.mesh(countries, countries.objects.countries, (a, b) => a !== b), 1.001, COLORS.border, .7],
          [topojson.mesh(land, land.objects.land), 1.0015, COLORS.coast, .75],
        ]) {
          const lines = new THREE.LineSegments(sphereLines(mesh.coordinates, radius),
            new THREE.LineBasicMaterial({color, transparent: true, opacity, depthWrite: false}));
          lines.renderOrder = 2;
          this.scene.add(lines);
        }
        this.dirty = true;
      });

    this.bindPointer();
    let last = 0, slowFrames = 0;
    const frame = time => {
      requestAnimationFrame(frame);
      const dt = last ? Math.min((time - last) / 1000, .05) : 0;
      last = time;
      const moved = this.ease(dt);
      const opacity = this.trails.material.uniforms.uOpacity;
      const fading = Boolean(this.trails.grid) && opacity.value < 1;
      if (fading) opacity.value = Math.min(1, opacity.value + dt / .6);
      const animating = Boolean(this.trails.grid) && !this.paused;
      if (animating) {
        this.trails.step(dt);
        // Thin the trails if frames run long, so the motion stays smooth.
        slowFrames = dt > 1 / 40 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
        if (slowFrames > 45 && this.trails.count > 3000) {
          this.trails.setCount(this.trails.count * .75);
          slowFrames = 0;
        }
      }
      if (moved) this.placeCamera();
      if (animating || moved || fading || this.dirty) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
        this.onFrame();
      }
    };
    requestAnimationFrame(frame);
  }

  /**
   * Size the canvas and place the globe's center and radius, in CSS pixels, with
   * the zoom it opens and resets to. A view still at home follows a new home.
   */
  setLayout({x, y, radius, homeScale}) {
    if (!this.layout.radius || this.isHome()) this.view.scale = this.target.scale = homeScale;
    this.home.scale = homeScale;
    const {width, height} = this.canvas.parentElement.getBoundingClientRect();
    this.layout = {width, height, radius};
    // Sharp on retina screens, but bounded near 4K so very large displays stay smooth.
    const pixelRatio = Math.min(devicePixelRatio, 2, Math.sqrt(9e6 / (width * height)));
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.setViewOffset(width, height, width / 2 - x, height / 2 - y, width, height);
    this.trails.setViewport(width * pixelRatio, height * pixelRatio, STROKE * pixelRatio);
    this.trails.setCount(Math.max(4000, radius * TRAILS_PER_PIXEL));
    this.placeCamera();
  }

  distance(scale = this.view.scale) {
    return Math.sqrt(1 + (this.layout.height / (2 * Math.tan(FOV / 2 * RAD) * this.layout.radius * scale)) ** 2);
  }

  /** CSS pixels the surface moves at the center of the view per radian of turn. */
  pixelsPerRadian() {
    return this.layout.height / (2 * Math.tan(FOV / 2 * RAD)) / (this.distance() - 1);
  }

  placeCamera() {
    geoToVector(this.view.lon, this.view.lat, this.distance(), this.camera.position);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.marker.scale.setScalar(1 / this.pixelsPerRadian());
    this.dirty = true;
  }

  /** Glide the view toward its target, and coast after a flick. Returns whether it moved. */
  ease(dt) {
    const {view, target, velocity} = this;
    if (this.pointers.size) return false;
    if (velocity.lon || velocity.lat) {
      target.lon += velocity.lon * dt;
      target.lat = clamp(target.lat + velocity.lat * dt, -MAX_VIEW_LAT, MAX_VIEW_LAT);
      const decay = Math.exp(-dt * 4.2);
      velocity.lon *= decay;
      velocity.lat *= decay;
      if (Math.hypot(velocity.lon, velocity.lat) < .3) velocity.lon = velocity.lat = 0;
    }
    const dLon = shortest(target.lon - view.lon), dLat = target.lat - view.lat, dScale = Math.log(target.scale / view.scale);
    if (Math.abs(dLon) < 1e-3 && Math.abs(dLat) < 1e-3 && Math.abs(dScale) < 1e-4) {
      const moved = Boolean(dLon || dLat || dScale);
      Object.assign(view, target);
      return moved;
    }
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    view.lon = shortest(view.lon + dLon * k);
    view.lat += dLat * k;
    view.scale *= Math.exp(dScale * k);
    return true;
  }

  setData(grid, options) {
    // A refreshed field for the same level carries the trails on; a new level fades in.
    const continuing = this.trails.grid?.level === grid.level;
    this.trails.setField(grid, options, continuing);
    if (!continuing) this.trails.material.uniforms.uOpacity.value = this.reducedMotion ? 1 : 0;
    this.dirty = true;
  }

  /** The speed, in m/s, at the top of the color scale. */
  setColorScale(maxSpeed) {
    this.trails.material.uniforms.uMaxSpeed.value = maxSpeed;
    this.dirty = true;
  }

  clearData() {
    this.trails.clear();
    this.dirty = true;
  }

  setSelection(point) {
    this.marker.visible = Boolean(point);
    if (point) {
      const normal = geoToVector(...point);
      this.marker.position.copy(normal).multiplyScalar(1.004);
      this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    }
    this.dirty = true;
  }

  isHome() {
    const {view, home} = this;
    return Math.abs(shortest(view.lon - home.lon)) < .5 && Math.abs(view.lat - home.lat) < .5 && Math.abs(view.scale - home.scale) < .01;
  }

  resetView() {
    this.velocity = {lon: 0, lat: 0};
    Object.assign(this.target, this.home);
  }

  zoomBy(factor) {
    this.target.scale = clamp(this.target.scale * factor, ...ZOOM);
  }

  /** Turn the view, in degrees of longitude and latitude. */
  turnBy(lon, lat) {
    this.velocity = {lon: 0, lat: 0};
    this.target.lon = shortest(this.target.lon + lon);
    this.target.lat = clamp(this.target.lat + lat, -MAX_VIEW_LAT, MAX_VIEW_LAT);
  }

  center() {
    return [shortest(this.view.lon), this.view.lat];
  }

  /** Where a location falls on screen, in CSS pixels, and how far it is past the visible edge. */
  project(lon, lat) {
    const point = geoToVector(lon, lat, 1.004);
    const facing = point.dot(this.camera.position.clone().normalize()) - 1 / this.camera.position.length();
    point.project(this.camera);
    return {x: (point.x + 1) / 2 * this.layout.width, y: (1 - point.y) / 2 * this.layout.height, facing};
  }

  /** The on-screen angle, in degrees clockwise from up, of wind blowing toward a heading. */
  screenAngle(lon, lat, heading) {
    const from = this.project(lon, lat);
    const to = this.project(lon + Math.sin(heading * RAD) * .4 / Math.max(Math.cos(lat * RAD), .05), lat + Math.cos(heading * RAD) * .4);
    return Math.atan2(to.x - from.x, from.y - to.y) / RAD;
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(
      (clientX - rect.left) / rect.width * 2 - 1, (rect.top - clientY) / rect.height * 2 + 1), this.camera);
    const hit = this.raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
    return hit && [Math.atan2(-hit.z, hit.x) / RAD, Math.asin(clamp(hit.y, -1, 1)) / RAD];
  }

  /** Drag turns the globe under the pointer, a flick coasts, two fingers pinch, a tap picks. */
  bindPointer() {
    const {canvas, pointers, view} = this;
    let tap = null, lastMove = 0;
    const turn = (dx, dy) => {
      const perPixel = 1 / RAD / this.pixelsPerRadian();
      view.lon = shortest(view.lon - dx * perPixel);
      view.lat = clamp(view.lat + dy * perPixel, -MAX_VIEW_LAT, MAX_VIEW_LAT);
      Object.assign(this.target, view);
      this.placeCamera();
      return [-dx * perPixel, dy * perPixel];
    };
    const pair = () => {
      const [a, b] = pointers.values();
      return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y)};
    };
    canvas.addEventListener('pointerdown', event => {
      if (event.button) return;
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
      this.velocity = {lon: 0, lat: 0};
      Object.assign(this.target, view);
      tap = pointers.size === 1 ? {x: event.clientX, y: event.clientY, at: performance.now()} : null;
    });
    canvas.addEventListener('pointermove', event => {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return;
      const now = performance.now();
      if (pointers.size === 1) {
        const [dLon, dLat] = turn(event.clientX - pointer.x, event.clientY - pointer.y);
        const dt = Math.max((now - lastMove) / 1000, 1 / 240), blend = Math.min(1, dt * 18);
        this.velocity.lon += (dLon / dt - this.velocity.lon) * blend;
        this.velocity.lat += (dLat / dt - this.velocity.lat) * blend;
        Object.assign(pointer, {x: event.clientX, y: event.clientY});
      } else {
        const before = pair();
        Object.assign(pointer, {x: event.clientX, y: event.clientY});
        const after = pair();
        if (before.spread) view.scale = clamp(view.scale * after.spread / before.spread, ...ZOOM);
        turn(after.x - before.x, after.y - before.y);
      }
      lastMove = now;
      if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6) tap = null;
    });
    const release = event => {
      if (!pointers.delete(event.pointerId)) return;
      const now = performance.now();
      if (pointers.size || this.reducedMotion || now - lastMove > 70 || tap || event.type === 'pointercancel') this.velocity = {lon: 0, lat: 0};
      if (!pointers.size && tap && event.type === 'pointerup' && now - tap.at < 600) this.onPick(this.pick(event.clientX, event.clientY));
      tap = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.layout.height : 1;
      // Trackpad pinches arrive as wheel events with ctrlKey and small deltas.
      this.zoomBy(Math.exp(-event.deltaY * lines * (event.ctrlKey ? .01 : .0016)));
    }, {passive: false});
  }
}
