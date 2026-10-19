import * as THREE from 'three';
import {geoToVector, vectorToGeo, sphereLines, paintEarth} from './globe-geometry.js';
import {WindTrails} from './wind-trails.js';

// Every color here is a display value, as in CSS; nothing is converted.
THREE.ColorManagement.enabled = false;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const FOV = 30;
const HOME = {lon: -32, lat: 22, scale: 1};
const ZOOM = [.7, 3.5];
const MAX_VIEW_LAT = 86;
// Trails per CSS pixel of the globe's radius. Trail length grows with the globe,
// so a count in proportion to its radius keeps the density even at any size.
const TRAILS_PER_PIXEL = 46;
const STROKE = 1.5;           // trail width at its head, in CSS pixels
const COLORS = {background: '#070b10', ocean: '#0d1721', ground: '#252d35', coast: '#7b8893', border: '#3e4952', rim: [.32, .47, .62]};
export const PALETTE = ['#5b8fbe', '#89bedb', '#cbe7ef', '#f6f5ee', '#f8d47f', '#f59c58', '#e85d50'];

const shortest = degrees => ((degrees + 540) % 360) - 180;

export class WindGlobe {
  constructor(canvas, {onPick = () => {}, onFrame = () => {}, reducedMotion = false} = {}) {
    this.canvas = canvas;
    this.onPick = onPick;
    this.onFrame = onFrame;
    this.reducedMotion = reducedMotion;
    this.paused = false;
    this.suspended = false;
    this.disposed = false;
    this.dirty = true;
    this.view = {...HOME};
    this.target = {...HOME};
    this.velocity = {lon: 0, lat: 0};
    this.pointers = new Map();
    this.layout = {width: 1, height: 1, radius: 1};

    const coarse = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(COLORS.background);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, .01, 30);

    const size = coarse ? 2048 : 4096;
    this.surface = Object.assign(document.createElement('canvas'), {width: size, height: size / 2});
    paintEarth(this.surface, null, COLORS);
    this.texture = new THREE.CanvasTexture(this.surface);
    this.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 144, 96), new THREE.ShaderMaterial({
      uniforms: {uMap: {value: this.texture}},
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
    }));
    this.scene.add(this.earth);

    // A thin glow just outside the edge, measured from where each view ray passes the globe.
    this.rim = new THREE.Mesh(new THREE.SphereGeometry(1.12, 96, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {uColor: {value: new THREE.Vector3(...COLORS.rim)}},
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec3 vWorld;
        void main() {
          float miss = length(cross(normalize(vWorld - cameraPosition), cameraPosition));
          gl_FragColor = vec4(uColor * pow(1. - smoothstep(1., 1.12, miss), 4.) * .42, 1.);
        }`,
    }));
    this.rim.renderOrder = 1;
    this.scene.add(this.rim);

    this.trails = new WindTrails({capacity: coarse ? 12000 : 32000, points: coarse ? 18 : 26, palette: PALETTE});
    this.trails.mesh.renderOrder = 3;
    this.scene.add(this.trails.mesh);

    this.marker = new THREE.Group();
    // Sizes are CSS pixels; placeCamera scales the group so they hold at any zoom.
    for (const [inner, outer, color, opacity] of [[0, 2.4, 0xffffff, 1], [5.6, 7, 0xffffff, .95], [7, 8.6, 0x070b10, .5]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40),
        new THREE.MeshBasicMaterial({color, transparent: true, opacity, depthWrite: false}));
      ring.renderOrder = 4;
      this.marker.add(ring);
    }
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.raycaster = new THREE.Raycaster();
    this.globeSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.scratch = new THREE.Vector3();
    this.scratch2 = new THREE.Vector3();
    this.bindPointer();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();

    const url = name => new URL(`data/${name}-110m.json`, import.meta.url);
    this.ready = Promise.all([window.d3.json(url('land')), window.d3.json(url('countries'))]).then(([land, countries]) => {
      if (this.disposed) return;
      const topojson = window.topojson;
      const outline = topojson.feature(land, land.objects.land);
      this.countries = topojson.feature(countries, countries.objects.countries).features;
      paintEarth(this.surface, outline, COLORS);
      this.texture.needsUpdate = true;
      const lines = (geo, radius, color, opacity) => {
        const line = new THREE.LineSegments(sphereLines(geo, radius),
          new THREE.LineBasicMaterial({color, transparent: true, opacity, depthWrite: false}));
        line.renderOrder = 2;
        this.scene.add(line);
      };
      lines(topojson.mesh(countries, countries.objects.countries, (a, b) => a !== b), 1.001, COLORS.border, .7);
      lines(outline, 1.0015, COLORS.coast, .75);
      this.dirty = true;
    }).catch(error => {
      if (!this.disposed) console.warn('The continents could not load.', error);
    });

    this.lastTime = 0;
    this.slowFrames = 0;
    this.frame = time => {
      if (this.disposed) return;
      this.animationFrame = requestAnimationFrame(this.frame);
      const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, .05) : 0;
      this.lastTime = time;
      const moved = this.ease(dt);
      const animating = Boolean(this.trails.grid) && !this.paused && !this.suspended;
      const uniforms = this.trails.material.uniforms;
      const fading = this.trails.grid && uniforms.uOpacity.value < 1;
      if (fading) uniforms.uOpacity.value = Math.min(1, uniforms.uOpacity.value + dt / .6);
      if (animating) {
        this.trails.step(dt);
        this.adapt(dt);
      }
      if (moved) this.placeCamera();
      if (animating || moved || fading || this.dirty) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
        this.onFrame();
      }
    };
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  /** Place the globe's center and radius, in CSS pixels of the canvas. */
  setLayout({x, y, radius}) {
    this.placement = {x, y, radius};
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    const {width, height} = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, width), h = Math.max(1, height);
    const {x = w / 2, y = h / 2, radius = Math.min(h * .45, w * .58)} = this.placement ?? {};
    this.layout = {width: w, height: h, radius};
    // Sharp on retina screens, but bounded near 4K so very large displays stay smooth.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(9e6 / (w * h)));
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, w / 2 - x, h / 2 - y, w, h);
    this.trails.setViewport(w * pixelRatio, h * pixelRatio, STROKE * pixelRatio);
    this.trails.setCount(Math.max(4000, radius * TRAILS_PER_PIXEL));
    this.placeCamera();
  }

  distance(scale = this.view.scale) {
    const radius = this.layout.radius * scale;
    return Math.sqrt(1 + (this.layout.height / (2 * Math.tan(FOV / 2 * RAD) * radius)) ** 2);
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
      target.lat += velocity.lat * dt;
      const decay = Math.exp(-dt * 4.2);
      velocity.lon *= decay;
      velocity.lat *= decay;
      if (Math.hypot(velocity.lon, velocity.lat) < .3) velocity.lon = velocity.lat = 0;
    }
    target.lat = THREE.MathUtils.clamp(target.lat, -MAX_VIEW_LAT, MAX_VIEW_LAT);
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    const dLon = shortest(target.lon - view.lon), dLat = target.lat - view.lat;
    const dScale = Math.log(target.scale / view.scale);
    if (Math.abs(dLon) < 1e-3 && Math.abs(dLat) < 1e-3 && Math.abs(dScale) < 1e-4) {
      if (dLon || dLat || dScale) {
        Object.assign(view, target);
        return true;
      }
      return false;
    }
    view.lon = shortest(view.lon + dLon * k);
    view.lat += dLat * k;
    view.scale *= Math.exp(dScale * k);
    return true;
  }

  /** Thin the trails if frames run long, so the motion stays smooth. */
  adapt(dt) {
    this.slowFrames = dt > 1 / 40 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 45 && this.trails.count > 3000) {
      this.trails.setCount(this.trails.count * .75);
      this.slowFrames = 0;
    }
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

  setPaused(paused) {
    this.paused = Boolean(paused);
  }

  setSuspended(suspended) {
    this.suspended = Boolean(suspended);
  }

  setSelection(point) {
    this.marker.visible = Boolean(point);
    if (point) {
      const normal = geoToVector(point[0], point[1]);
      this.marker.position.copy(normal).multiplyScalar(1.004);
      this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    }
    this.dirty = true;
  }

  resetView() {
    this.velocity.lon = this.velocity.lat = 0;
    Object.assign(this.target, HOME);
  }

  isHome() {
    const {view} = this;
    return Math.abs(shortest(view.lon - HOME.lon)) < .5 && Math.abs(view.lat - HOME.lat) < .5 && Math.abs(view.scale - 1) < .01;
  }

  zoomBy(factor) {
    this.target.scale = THREE.MathUtils.clamp(this.target.scale * factor, ...ZOOM);
  }

  /** Turn the view, in degrees of longitude and latitude. */
  turnBy(lon, lat) {
    this.velocity.lon = this.velocity.lat = 0;
    this.target.lon = shortest(this.target.lon + lon);
    this.target.lat = THREE.MathUtils.clamp(this.target.lat + lat, -MAX_VIEW_LAT, MAX_VIEW_LAT);
  }

  center() {
    return [shortest(this.view.lon), this.view.lat];
  }

  /** Where a location falls on screen, in CSS pixels, and whether it faces the viewer. */
  project(lon, lat) {
    const point = geoToVector(lon, lat, 1.004, this.scratch);
    const facing = point.dot(this.scratch2.copy(this.camera.position).normalize()) - 1 / this.camera.position.length();
    point.project(this.camera);
    return {x: (point.x + 1) / 2 * this.layout.width, y: (1 - point.y) / 2 * this.layout.height, facing};
  }

  /** The on-screen angle, in degrees clockwise from up, of wind blowing toward a heading. */
  screenAngle(lon, lat, heading) {
    const from = this.project(lon, lat);
    const step = .4, rad = heading * RAD;
    const to = this.project(lon + Math.sin(rad) * step / Math.max(Math.cos(lat * RAD), .05), lat + Math.cos(rad) * step);
    return Math.atan2(to.x - from.x, from.y - to.y) * DEG;
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(
      (clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = this.raycaster.ray.intersectSphere(this.globeSphere, this.scratch);
    return hit ? vectorToGeo(hit) : null;
  }

  bindPointer() {
    const canvas = this.canvas;
    let tap = null, lastMove = 0;
    const pair = () => {
      const [a, b] = [...this.pointers.values()];
      return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y)};
    };
    const turn = (dx, dy) => {
      const perPixel = DEG / this.pixelsPerRadian();
      this.view.lon = shortest(this.view.lon - dx * perPixel);
      this.view.lat = THREE.MathUtils.clamp(this.view.lat + dy * perPixel, -MAX_VIEW_LAT, MAX_VIEW_LAT);
      Object.assign(this.target, this.view);
      this.placeCamera();
      return [-dx * perPixel, dy * perPixel];
    };
    this.listeners = {
      pointerdown: event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        canvas.setPointerCapture?.(event.pointerId);
        this.pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
        this.velocity.lon = this.velocity.lat = 0;
        Object.assign(this.target, this.view);
        tap = this.pointers.size === 1 ? {x: event.clientX, y: event.clientY, at: performance.now()} : null;
        canvas.classList.add('is-dragging');
      },
      pointermove: event => {
        const pointer = this.pointers.get(event.pointerId);
        if (!pointer) return;
        const now = performance.now();
        if (this.pointers.size === 1) {
          const [dLon, dLat] = turn(event.clientX - pointer.x, event.clientY - pointer.y);
          const dt = Math.max((now - lastMove) / 1000, 1 / 240);
          const blend = Math.min(1, dt * 18);
          this.velocity.lon += (dLon / dt - this.velocity.lon) * blend;
          this.velocity.lat += (dLat / dt - this.velocity.lat) * blend;
          pointer.x = event.clientX;
          pointer.y = event.clientY;
        } else {
          const before = pair();
          pointer.x = event.clientX;
          pointer.y = event.clientY;
          const after = pair();
          if (before.spread > 0) {
            this.view.scale = THREE.MathUtils.clamp(this.view.scale * after.spread / before.spread, ...ZOOM);
          }
          turn(after.x - before.x, after.y - before.y);
        }
        lastMove = now;
        if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6) tap = null;
      },
      pointerup: event => {
        if (!this.pointers.delete(event.pointerId)) return;
        if (this.pointers.size) {
          tap = null;
          this.velocity.lon = this.velocity.lat = 0;
          return;
        }
        canvas.classList.remove('is-dragging');
        const now = performance.now();
        if (this.reducedMotion || now - lastMove > 70) this.velocity.lon = this.velocity.lat = 0;
        if (tap && now - tap.at < 600) {
          this.velocity.lon = this.velocity.lat = 0;
          this.onPick(this.pick(event.clientX, event.clientY));
        }
        tap = null;
      },
      pointercancel: event => {
        this.pointers.delete(event.pointerId);
        if (!this.pointers.size) canvas.classList.remove('is-dragging');
        tap = null;
        this.velocity.lon = this.velocity.lat = 0;
      },
      wheel: event => {
        event.preventDefault();
        const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.layout.height : 1;
        // Trackpad pinches arrive as wheel events with ctrlKey and small deltas.
        this.zoomBy(Math.exp(-event.deltaY * lines * (event.ctrlKey ? .01 : .0016)));
      },
    };
    for (const [type, listener] of Object.entries(this.listeners)) {
      canvas.addEventListener(type, listener, type === 'wheel' ? {passive: false} : undefined);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    for (const [type, listener] of Object.entries(this.listeners)) this.canvas.removeEventListener(type, listener);
    this.trails.dispose();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    this.texture.dispose();
    this.renderer.dispose();
  }
}
