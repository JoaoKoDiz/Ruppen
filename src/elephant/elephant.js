// STUB — substituído pelo modelo vencedor (ver ARCHITECTURE.md para o contrato completo).
import * as THREE from 'three';
import { ELEPHANT, COLORS } from '../config.js';

export function createElephant(route, index, opts = {}) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.elephantSkin, roughness: 0.9 });
  const B = ELEPHANT.BODY;
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  body.scale.set(B.rx, B.ry, B.rz); body.position.y = B.cy; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(ELEPHANT.HEAD.radius, 20, 14), mat);
  head.position.set(ELEPHANT.HEAD.cx, ELEPHANT.HEAD.cy, 0); group.add(head);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const L = ELEPHANT.LEG;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(L.radius, L.radius * 1.05, L.topY - L.bottomY, 16), mat);
    leg.position.set(sx * L.offsetX, (L.topY + L.bottomY) / 2, sz * L.offsetZ); group.add(leg);
  }
  const state = { u: route.u0, position: new THREE.Vector3(), heading: 0 };
  const ent = {
    group, index, name: route.cityName, route,
    position: state.position,
    get heading() { return state.heading; },
    get u() { return state.u; },
    colliders: [{ center: new THREE.Vector3(), radius: Math.max(B.rx, B.ry, B.rz) }],
    cityTop: ELEPHANT.SHOULDER_HEIGHT + 120,
    cityFootprint: { rx: B.rx + 200, rz: B.rz + 200 },
    deliveryMarker: new THREE.Vector3(),
    update(dt, time) {
      state.u = (state.u + (route.speed * dt) / route.length) % 1;
      const pose = route.poseAt(state.u);
      state.position.copy(pose.position);
      state.heading = pose.heading;
      group.position.copy(pose.position);
      group.rotation.y = pose.heading;
      ent.colliders[0].center.set(0, B.cy, 0).applyMatrix4(group.matrixWorld);
      ent.deliveryMarker.set(0, ent.cityTop + 200, 0).applyMatrix4(group.matrixWorld);
    },
    getSurfaceHeight(x, z) {
      // elipsoide do corpo no espaço local
      const lx = x - state.position.x, lz = z - state.position.z;
      const c = Math.cos(-state.heading), s = Math.sin(-state.heading);
      const px = lx * c - lz * s, pz = lx * s + lz * c;
      const q = (px / B.rx) ** 2 + (pz / B.rz) ** 2;
      if (q >= 1) return null;
      return B.cy + B.ry * Math.sqrt(1 - q);
    },
    isOverCity(x, z) { return ent.getSurfaceHeight(x, z) !== null; },
  };
  group.updateMatrixWorld(true);
  ent.update(0, 0);
  return ent;
}
