// STUB — substituído pelo agente de voo. Contrato em ARCHITECTURE.md.
import * as THREE from 'three';
export function createPackageSystem({ scene, dove, flight, elephants, islandHeightAt }) {
  const landed = [], lost = [];
  return {
    attached: true,
    canDrop() { return this.attached; },
    drop() { if (!this.attached) return false; this.attached = false; setTimeout(() => { this.attached = true; }, 1500); return true; },
    onLanded(cb) { landed.push(cb); }, onLost(cb) { lost.push(cb); },
    attachNew() { this.attached = true; },
    update(dt) {},
  };
}
