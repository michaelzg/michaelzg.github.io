import * as THREE from 'three';

const RAD = Math.PI / 180;

// Agrees with SphereGeometry's UVs: longitude -180 is u = 0 and latitude 90 is v = 1.
export function geoToVector(lon, lat, radius = 1, target = new THREE.Vector3()) {
  const ring = Math.cos(lat * RAD) * radius;
  return target.set(ring * Math.cos(lon * RAD), Math.sin(lat * RAD) * radius, -ring * Math.sin(lon * RAD));
}

/** Line segments over the sphere, cut into 2° steps so long edges hug the surface. */
export function sphereLines(lines, radius) {
  const positions = [], a = new THREE.Vector3(), b = new THREE.Vector3(), point = new THREE.Vector3();
  const at = t => point.lerpVectors(a, b, t).normalize().multiplyScalar(radius).toArray();
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      // Edges along ±180° are where the source cut a shape in two, not coast.
      if (Math.abs(line[i - 1][0]) > 179.999 && Math.abs(line[i][0]) > 179.999) continue;
      geoToVector(...line[i - 1], 1, a);
      geoToVector(...line[i], 1, b);
      const steps = Math.ceil(a.angleTo(b) / (2 * RAD)) || 1;
      for (let s = 0; s < steps; s++) positions.push(...at(s / steps), ...at((s + 1) / steps));
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
}
