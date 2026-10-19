import * as THREE from 'three';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MAX_ARC = 2 * RAD;

// Agrees with SphereGeometry's default UVs: longitude -180 is u = 0,
// longitude 0 is u = .5, and latitude 90 is v = 1.
export function geoToVector(lon, lat, radius = 1, target = new THREE.Vector3()) {
  const ring = Math.cos(lat * RAD) * radius;
  return target.set(ring * Math.cos(lon * RAD), Math.sin(lat * RAD) * radius, -ring * Math.sin(lon * RAD));
}

export function vectorToGeo(vector) {
  const n = vector.clone().normalize();
  return [Math.atan2(-n.z, n.x) * DEG, Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) * DEG];
}

function eachRing(geo, visit) {
  switch (geo?.type) {
    case 'FeatureCollection': geo.features.forEach(feature => eachRing(feature, visit)); break;
    case 'Feature': eachRing(geo.geometry, visit); break;
    case 'GeometryCollection': geo.geometries.forEach(geometry => eachRing(geometry, visit)); break;
    case 'Polygon': case 'MultiLineString': geo.coordinates.forEach(visit); break;
    case 'MultiPolygon': geo.coordinates.forEach(polygon => polygon.forEach(visit)); break;
    case 'LineString': visit(geo.coordinates); break;
  }
}

/** Line segments that follow great circles over the sphere, so long edges hug the surface. */
export function sphereLines(geo, radius) {
  const positions = [];
  const start = new THREE.Vector3(), end = new THREE.Vector3();
  const previous = new THREE.Vector3(), next = new THREE.Vector3();
  eachRing(geo, coordinates => {
    for (let i = 1; i < coordinates.length; i++) {
      const [a, b] = [coordinates[i - 1], coordinates[i]];
      // Edges along ±180° are where the source cut a shape in two, not coast.
      if (Math.abs(a[0]) > 179.999 && Math.abs(b[0]) > 179.999) continue;
      geoToVector(a[0], a[1], 1, start);
      geoToVector(b[0], b[1], 1, end);
      const angle = start.angleTo(end);
      const divisions = Math.max(1, Math.ceil(angle / MAX_ARC));
      previous.copy(start).multiplyScalar(radius);
      for (let step = 1; step <= divisions; step++) {
        next.lerpVectors(start, end, step / divisions).normalize().multiplyScalar(radius);
        positions.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
        previous.copy(next);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Ocean and land as an equirectangular image for the sphere. */
export function paintEarth(canvas, land, {ocean, ground}) {
  const context = canvas.getContext('2d');
  const {width, height} = canvas;
  context.fillStyle = ocean;
  context.fillRect(0, 0, width, height);
  if (!land) return;
  const projection = window.d3.geoEquirectangular().translate([width / 2, height / 2]).scale(width / (2 * Math.PI));
  context.fillStyle = ground;
  context.beginPath();
  window.d3.geoPath(projection, context)(land);
  context.fill();
}
