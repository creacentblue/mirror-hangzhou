// 实体：碎块物理、玩家模型、汽车模型
import * as THREE from 'three';
import { VS, PAL, T } from './world.js';

export class Debris {
  constructor(scene, world, max = 2600) {
    this.w = world; this.max = max; this.n = 0; this.head = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.r = new Float32Array(max * 3); this.av = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.size = new Float32Array(max); this.rest = new Float32Array(max);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0; scene.add(this.mesh);
    this.o = new THREE.Object3D(); this.col = new THREE.Color(); this.dirty = false;
  }
  spawn(x, y, z, type, vx, vy, vz, size = 0.5) {
    const i = this.head; this.head = (this.head + 1) % this.max; this.n = Math.max(this.n, i + 1);
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.av.set([(Math.random() - .5) * 12, (Math.random() - .5) * 12, (Math.random() - .5) * 12], i * 3);
    this.life[i] = 9 + Math.random() * 5; this.size[i] = size * (0.7 + Math.random() * 0.6); this.rest[i] = 0;
    const c = PAL[type] || PAL[4], k = 0.85 + Math.random() * 0.3; this.col.setRGB(c[0] * k, c[1] * k, c[2] * k); this.mesh.setColorAt(i, this.col);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; this.mesh.count = this.n; this.dirty = true;
  }
  update(dt) {
    const w = this.w, o = this.o; let any = false;
    for (let i = 0; i < this.n; i++) {
      let L = this.life[i]; if (L <= 0) continue;
      L -= dt; this.life[i] = L; const s = this.size[i];
      if (L <= 0) { o.position.set(0, -999, 0); o.scale.setScalar(0.0001); o.updateMatrix(); this.mesh.setMatrixAt(i, o.matrix); any = true; continue; }
      if (this.rest[i] > 0.7 && L > 1) continue;     // 已静止
      const k = i * 3; let x = this.p[k], y = this.p[k + 1], z = this.p[k + 2], vx = this.v[k], vy = this.v[k + 1] - 22 * dt, vz = this.v[k + 2];
      x += vx * dt; y += vy * dt; z += vz * dt;
      const gx = Math.floor(x / VS), gz = Math.floor(z / VS), gy = Math.floor((y - s * .5) / VS);
      if (w.get(gx, gy, gz)) { // 落在方块里 → 抬到顶面
        const t = w.get(gx, gy, gz); const top = (gy + 1) * VS - (t === T.WATER ? 0.7 : 0);
        if (y - s * .5 < top && vy < 0) { y = top + s * .5; vy = -vy * 0.28; vx *= 0.72; vz *= 0.72; for (let a = 0; a < 3; a++) this.av[k + a] *= 0.6; if (Math.abs(vy) < 1.2) { vy = 0; this.rest[i] += dt * 3; } }
      }
      if (w.get(Math.floor(x / VS), Math.floor(y / VS), Math.floor(z / VS)) && w.get(gx, gy + 1, gz)) { x -= vx * dt; z -= vz * dt; vx *= -0.3; vz *= -0.3; }
      this.p[k] = x; this.p[k + 1] = y; this.p[k + 2] = z; this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
      if (this.rest[i] <= 0.7) for (let a = 0; a < 3; a++) this.r[k + a] += this.av[k + a] * dt;
      o.position.set(x, y, z); o.rotation.set(this.r[k], this.r[k + 1], this.r[k + 2]); o.scale.setScalar(L < 1 ? s * L : s); o.updateMatrix(); this.mesh.setMatrixAt(i, o.matrix); any = true;
    }
    if (any || this.dirty) this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false;
  }
}

const M = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };

export function makePlayerModel() {
  const g = new THREE.Group(), jacket = M(0x2f6fb0), pants = M(0x2b2f3a), skin = M(0xe8b88f), hair = M(0x1b1b1f);
  const legL = new THREE.Group(), legR = new THREE.Group(), armL = new THREE.Group(), armR = new THREE.Group();
  legL.position.set(-0.17, 0.85, 0); legR.position.set(0.17, 0.85, 0); legL.add(box(0.28, 0.85, 0.3, pants, 0, -0.425, 0)); legR.add(box(0.28, 0.85, 0.3, pants, 0, -0.425, 0));
  armL.position.set(-0.43, 1.5, 0); armR.position.set(0.43, 1.5, 0); armL.add(box(0.22, 0.75, 0.24, jacket, 0, -0.34, 0)); armR.add(box(0.22, 0.75, 0.24, jacket, 0, -0.34, 0));
  armL.add(box(0.2, 0.18, 0.22, skin, 0, -0.78, 0)); armR.add(box(0.2, 0.18, 0.22, skin, 0, -0.78, 0));
  g.add(legL, legR, armL, armR, box(0.6, 0.72, 0.34, jacket, 0, 1.2, 0), box(0.42, 0.42, 0.42, skin, 0, 1.76, 0), box(0.46, 0.18, 0.46, hair, 0, 1.94, -0.0), box(0.46, 0.3, 0.1, hair, 0, 1.8, 0.2));
  g.userData = { legL, legR, armL, armR }; return g;
}

export class Car {
  constructor(scene, color, x, z, yaw, y) {
    this.group = new THREE.Group(); this.color = color;
    const body = M(color), dark = M(0x1a1d22), glass = M(0x2a3f55), lamp = new THREE.MeshBasicMaterial({ color: 0xfff1c0 }), tail = new THREE.MeshBasicMaterial({ color: 0xc02020 });
    this.group.add(box(1.9, 0.62, 4.3, body, 0, 0.62, 0), box(1.7, 0.6, 2.3, glass, 0, 1.2, 0.15), box(1.74, 0.06, 2.2, body, 0, 1.52, 0.15),
      box(0.4, 0.2, 0.06, lamp, -0.65, 0.72, -2.16), box(0.4, 0.2, 0.06, lamp, 0.65, 0.72, -2.16), box(0.4, 0.16, 0.06, tail, -0.65, 0.78, 2.16), box(0.4, 0.16, 0.06, tail, 0.65, 0.78, 2.16));
    this.wheels = [];
    for (const [wx, wz] of [[-0.98, -1.35], [0.98, -1.35], [-0.98, 1.35], [0.98, 1.35]]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12), dark); m.rotation.z = Math.PI / 2; m.position.set(wx, 0.36, wz); this.group.add(m); this.wheels.push(m); }
    this.pos = new THREE.Vector3(x, y, z); this.yaw = yaw; this.speed = 0; this.vy = 0; this.pitch = 0; this.roll = 0; this.steer = 0; this.wheelRot = 0;
    scene.add(this.group); this.sync();
  }
  sync() { const g = this.group; g.position.copy(this.pos); g.rotation.order = 'YXZ'; g.rotation.set(this.pitch, this.yaw, this.roll); for (const w of this.wheels) w.rotation.x = 0; }
  dispose(scene) { scene.remove(this.group); }
}

export function makeHelicopter() {
  const g = new THREE.Group();
  const body = M(0xc9ced4), dark = M(0x1c1f24), glass = M(0x2a4a66), accent = M(0xb43b32), skid = M(0x2a2d33);
  g.add(box(1.6, 1.1, 3.4, body, 0, 0.9, 0.15));
  g.add(box(1.4, 0.7, 1.5, glass, 0, 1.15, -1.15));
  g.add(box(0.28, 0.28, 3.4, body, 0, 1.05, 3.2));
  g.add(box(0.12, 0.7, 0.7, accent, 0, 1.45, 4.7));
  g.add(box(0.18, 0.18, 1.8, skid, -0.7, 0.12, 0.1));
  g.add(box(0.18, 0.18, 1.8, skid, 0.7, 0.12, 0.1));
  g.add(box(0.08, 0.35, 0.08, skid, -0.7, 0.32, -0.55));
  g.add(box(0.08, 0.35, 0.08, skid, -0.7, 0.32, 0.7));
  g.add(box(0.08, 0.35, 0.08, skid, 0.7, 0.32, -0.55));
  g.add(box(0.08, 0.35, 0.08, skid, 0.7, 0.32, 0.7));
  const mainR = new THREE.Group(); mainR.position.set(0, 1.62, 0.1);
  mainR.add(box(0.18, 0.14, 0.18, dark, 0, 0, 0));
  mainR.add(box(10.4, 0.05, 0.28, dark, 0, 0.08, 0));
  mainR.add(box(0.28, 0.05, 10.4, dark, 0, 0.08, 0));
  const tailR = new THREE.Group(); tailR.position.set(0.18, 1.45, 4.75);
  tailR.add(box(0.08, 1.5, 0.22, dark));
  g.add(mainR, tailR);
  g.userData = { mainR, tailR };
  return g;
}
