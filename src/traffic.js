// 行人 + 车道 NPC：沿 OSM 路网的简单路径跟随，实例化网格，可被玩家车辆撞开。
import * as THREE from 'three';
import { VS, T } from './world.js';

const PED_N = 80, CAR_N = 22;
const CAR_COLS = [0xc4473a, 0xf0f2f5, 0x2d5fb8, 0xe6b02e, 0x2b2e34, 0x8f98a3, 0x2a8f62, 0x6b3fa0, 0xd9782a];
const PED_TOP = [0x2f6fb0, 0xc4473a, 0x2a8f62, 0xd9782a, 0x6b3fa0, 0xe8e4dc, 0x1f1f22, 0x4a7fa5, 0xb85c38];
const PED_PANT = [0x2b2f3a, 0x3a3a3a, 0x1d2a44, 0x4a4036, 0x222];

function toMeters(flat, half) {
  const o = new Float32Array(flat.length);
  for (let i = 0; i < flat.length; i++) o[i] = flat[i] / 10 + half;
  return o;
}
function resample(p, step) {
  const out = [];
  if (p.length < 4) return out;
  out.push(p[0], p[1]);
  let acc = 0;
  for (let i = 2; i < p.length; i += 2) {
    let x0 = out[out.length - 2], z0 = out[out.length - 1], x1 = p[i], z1 = p[i + 1];
    let dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 1e-3) continue;
    acc += L;
    while (acc >= step) {
      const t = 1 - (acc - step) / L;
      out.push(x0 + dx * t, z0 + dz * t);
      acc -= step;
      x0 = out[out.length - 2]; z0 = out[out.length - 1];
      dx = x1 - x0; dz = z1 - z0; L = Math.hypot(dx, dz);
      if (L < 1e-3) break;
    }
  }
  const lx = p[p.length - 2], lz = p[p.length - 1];
  if (Math.hypot(out[out.length - 2] - lx, out[out.length - 1] - lz) > 2) out.push(lx, lz);
  return out;
}
function offsetPoly(p, off) {
  const n = p.length / 2, o = new Float32Array(p.length);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = p[i1 * 2] - p[i0 * 2], dz = p[i1 * 2 + 1] - p[i0 * 2 + 1], L = Math.hypot(dx, dz) || 1;
    o[i * 2] = p[i * 2] + (-dz / L) * off; o[i * 2 + 1] = p[i * 2 + 1] + (dx / L) * off;
  }
  return o;
}

// 路网点：量化后合并交叉口
function buildNet(paths, q, minPts = 3) {
  const key = (x, z) => (Math.round(x / q) * 100000 + Math.round(z / q));
  const nodes = [], index = new Map();
  const add = (x, z) => {
    const k = key(x, z); if (index.has(k)) return index.get(k);
    const id = nodes.length; nodes.push({ x, z, next: [] }); index.set(k, id); return id;
  };
  for (const p of paths) {
    if (p.length < minPts * 2) continue;
    let prev = -1;
    for (let i = 0; i < p.length; i += 2) {
      const id = add(p[i], p[i + 1]);
      if (prev >= 0 && prev !== id) {
        if (!nodes[prev].next.includes(id)) nodes[prev].next.push(id);
        if (!p.oneway && !nodes[id].next.includes(prev)) nodes[id].next.push(prev);
      }
      prev = id;
    }
  }
  // 丢掉度数为 0 的
  return nodes;
}

function pickStart(nodes, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const a = (Math.random() * nodes.length) | 0;
    if (nodes[a].next.length) return a;
  }
  return (Math.random() * nodes.length) | 0;
}

function groundY(W, x, z, yFrom) {
  const gx = Math.floor(x / VS), gz = Math.floor(z / VS);
  let y = Math.min(W.sy - 1, Math.floor((yFrom || 12) / VS));
  for (; y >= 0; y--) { const t = W.get(gx, y, gz); if (t) return t === T.WATER ? y * VS + 0.8 : (y + 1) * VS; }
  return 3;
}
function blockedAt(W, x, z, y = 4.2) {
  const gx = Math.floor(x / VS), gz = Math.floor(z / VS), gy = Math.floor(y / VS);
  const t = W.get(gx, gy, gz); return t && t !== T.WATER && t !== T.LEAF && t !== T.LEAF2 && t !== T.LEAF3 && t !== T.WOOD;
}

function makePedMesh(n) {
  const g = new THREE.Group();
  const torso = new THREE.BoxGeometry(0.42, 0.62, 0.28);
  const head = new THREE.BoxGeometry(0.28, 0.28, 0.28);
  const leg = new THREE.BoxGeometry(0.18, 0.7, 0.22);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const inst = {
    torso: new THREE.InstancedMesh(torso, mat.clone(), n),
    head: new THREE.InstancedMesh(head, new THREE.MeshLambertMaterial({ color: 0xe8b88f }), n),
    legL: new THREE.InstancedMesh(leg, mat.clone(), n),
    legR: new THREE.InstancedMesh(leg, mat.clone(), n),
  };
  for (const m of Object.values(inst)) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = n; g.add(m); }
  return { group: g, inst };
}
function makeCarMesh(n) {
  const g = new THREE.Group();
  const body = new THREE.BoxGeometry(1.85, 0.58, 4.2);
  const cabin = new THREE.BoxGeometry(1.6, 0.52, 2.1);
  const matB = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const matC = new THREE.MeshLambertMaterial({ color: 0x2a3f55 });
  const bodyI = new THREE.InstancedMesh(body, matB, n);
  const cabinI = new THREE.InstancedMesh(cabin, matC, n);
  for (const m of [bodyI, cabinI]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = n; g.add(m); }
  return { group: g, body: bodyI, cabin: cabinI };
}

export function createTraffic(scene, world, area) {
  const half = area.half, margin = 18;
  const carPaths = [], pedPaths = [];
  for (const r of area.r) {
    const cls = r[0], w = r[1] / 10, oneway = !!r[5], p = toMeters(r[4], half);
    if (p.length < 4) continue;
    if (cls <= 5) {
      const lane = Math.min(2.0, Math.max(1.1, w * 0.28));
      const a = resample(offsetPoly(p, lane), 8);
      a.oneway = oneway; carPaths.push(a);
      if (!oneway) {
        const q = offsetPoly(p, -lane), rev = new Float32Array(q.length);
        for (let i = 0; i < q.length; i += 2) { rev[i] = q[q.length - 2 - i]; rev[i + 1] = q[q.length - 1 - i]; }
        const b = resample(rev, 8); b.oneway = true; carPaths.push(b);
      }
      const sw = w / 2 + 1.4;
      const s1 = resample(offsetPoly(p, sw), 6), s2 = resample(offsetPoly(p, -sw), 6);
      pedPaths.push(s1, s2);
    }
    if (cls >= 6) pedPaths.push(resample(p, 6));
  }
  const carNet = buildNet(carPaths, 7);
  const pedNet = buildNet(pedPaths, 5);
  const inb = (x, z) => x > margin && z > margin && x < world.sx * VS - margin && z < world.sz * VS - margin;

  const peds = [];
  const pedM = makePedMesh(PED_N);
  scene.add(pedM.group);
  const tmp = new THREE.Object3D(), col = new THREE.Color();
  for (let i = 0; i < PED_N; i++) {
    let a = pickStart(pedNet), guard = 0;
    while (guard++ < 30 && pedNet.length && !inb(pedNet[a].x, pedNet[a].z)) a = pickStart(pedNet);
    const nxts = pedNet[a] ? pedNet[a].next : [];
    const b = nxts.length ? nxts[(Math.random() * nxts.length) | 0] : a;
    peds.push({ a, b, t: Math.random(), speed: 1.15 + Math.random() * 0.55, yaw: 0, walk: Math.random() * 10, color: PED_TOP[i % PED_TOP.length], pants: PED_PANT[i % PED_PANT.length], sidestep: 0, wait: 0 });
    col.set(peds[i].color); pedM.inst.torso.setColorAt(i, col);
    col.set(peds[i].pants); pedM.inst.legL.setColorAt(i, col); pedM.inst.legR.setColorAt(i, col);
  }
  if (pedM.inst.torso.instanceColor) pedM.inst.torso.instanceColor.needsUpdate = true;
  if (pedM.inst.legL.instanceColor) { pedM.inst.legL.instanceColor.needsUpdate = true; pedM.inst.legR.instanceColor.needsUpdate = true; }

  const npcCars = [];
  const carM = makeCarMesh(CAR_N);
  scene.add(carM.group);
  for (let i = 0; i < CAR_N; i++) {
    let a = pickStart(carNet), guard = 0;
    while (guard++ < 40 && carNet.length && !inb(carNet[a].x, carNet[a].z)) a = pickStart(carNet);
    const nxts = carNet[a] ? carNet[a].next : [];
    const b = nxts.length ? nxts[(Math.random() * nxts.length) | 0] : a;
    const cruise = 7 + Math.random() * 6;
    npcCars.push({ a, b, t: Math.random(), speed: 0, cruise, yaw: 0, x: carNet[a] ? carNet[a].x : 0, z: carNet[a] ? carNet[a].z : 0, y: 3, stun: 0, vx: 0, vz: 0, color: CAR_COLS[i % CAR_COLS.length] });
    col.set(npcCars[i].color); carM.body.setColorAt(i, col);
  }
  if (carM.body.instanceColor) carM.body.instanceColor.needsUpdate = true;

  const self = { peds, npcCars, pedNet, carNet, pedM, carM, counts: { peds: PED_N, cars: CAR_N, carNodes: carNet.length, pedNodes: pedNet.length } };

  function stepAgent(ag, net, dt, isCar, W, others, player) {
    if (ag.stun > 0) {
      ag.stun -= dt; ag.x += ag.vx * dt; ag.z += ag.vz * dt; ag.vx *= Math.max(0, 1 - 2.2 * dt); ag.vz *= Math.max(0, 1 - 2.2 * dt);
      if (blockedAt(W, ag.x, ag.z, ag.y + 0.8)) { ag.x -= ag.vx * dt; ag.z -= ag.vz * dt; ag.vx *= -0.3; ag.vz *= -0.3; }
      ag.y = groundY(W, ag.x, ag.z, ag.y + 3);
      return;
    }
    if (ag.wait > 0) { ag.wait -= dt; return; }
    const A = net[ag.a], B = net[ag.b];
    if (!A || !B) { ag.a = pickStart(net); ag.b = net[ag.a].next[0] || ag.a; ag.t = 0; return; }
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 0.001;
    const want = isCar ? ag.cruise : ag.speed;
    // 前方减速（NPC 车）
    let cap = want;
    if (isCar) {
      const lookX = ag.x + Math.cos(ag.yaw) * 0 + (-Math.sin(ag.yaw)) * 8, lookZ = ag.z + (-Math.cos(ag.yaw)) * 8;
      for (const o of others) {
        if (o === ag) continue;
        const odx = o.x - ag.x, odz = o.z - ag.z, od = Math.hypot(odx, odz);
        if (od < 9 && od > 0.1) {
          const ahead = (-Math.sin(ag.yaw) * odx + -Math.cos(ag.yaw) * odz) / od;
          if (ahead > 0.55 && od < 8) cap = Math.min(cap, Math.max(0, (od - 3.6) * 2));
        }
      }
      if (player) {
        const odx = player.x - ag.x, odz = player.z - ag.z, od = Math.hypot(odx, odz);
        if (od < 8 && od > 0.1) {
          const ahead = (-Math.sin(ag.yaw) * odx + -Math.cos(ag.yaw) * odz) / od;
          if (ahead > 0.4) cap = Math.min(cap, Math.max(0, (od - 3.8) * 2.4));
        }
      }
    }
    ag.speed = ag.speed == null ? cap : ag.speed + (cap - ag.speed) * Math.min(1, dt * 2.4);
    ag.t += (ag.speed * dt) / L;
    if (ag.t >= 1) {
      const leftover = (ag.t - 1) * L;
      ag.a = ag.b;
      const opts = net[ag.a].next.filter(id => id !== ag.a);
      // 尽量不立刻回头
      const fwd = opts.filter(id => {
        const n = net[id]; const vx = n.x - net[ag.a].x, vz = n.z - net[ag.a].z;
        return -Math.sin(ag.yaw) * vx + -Math.cos(ag.yaw) * vz >= -0.1 || opts.length === 1;
      });
      const pool = fwd.length ? fwd : opts;
      ag.b = pool.length ? pool[(Math.random() * pool.length) | 0] : ag.a;
      const L2 = Math.hypot(net[ag.b].x - net[ag.a].x, net[ag.b].z - net[ag.a].z) || 1;
      ag.t = Math.min(0.95, leftover / L2);
    }
    const A2 = net[ag.a], B2 = net[ag.b];
    ag.x = A2.x + (B2.x - A2.x) * ag.t; ag.z = A2.z + (B2.z - A2.z) * ag.t;
    const ty = Math.atan2(-(B2.x - A2.x), -(B2.z - A2.z));
    let dy = ty - ag.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    ag.yaw += dy * Math.min(1, dt * (isCar ? 4 : 8));
    if (blockedAt(W, ag.x, ag.z, (isCar ? ag.y + 0.9 : 4.0))) {
      // 被建筑挡住：换下一条边或略微侧移
      const side = (Math.random() < 0.5 ? 1 : -1);
      ag.x += Math.cos(ag.yaw) * side * 1.2; ag.z -= Math.sin(ag.yaw) * side * 1.2;
      if (blockedAt(W, ag.x, ag.z, isCar ? ag.y + 0.9 : 4)) { ag.t = 1; ag.speed *= 0.3; }
    }
    if (!inb(ag.x, ag.z)) { ag.a = pickStart(net); ag.b = net[ag.a].next[0] || ag.a; ag.t = 0; }
    ag.y = groundY(W, ag.x, ag.z, (ag.y || 3) + 4);
    if (isCar === false) ag.walk = (ag.walk || 0) + dt * ag.speed * 6;
  }

  function syncPeds() {
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i], wlk = Math.sin(p.walk) * 0.45;
      tmp.position.set(p.x, p.y + 1.12, p.z); tmp.rotation.set(0, p.yaw, 0); tmp.scale.set(1, 1, 1); tmp.updateMatrix();
      pedM.inst.torso.setMatrixAt(i, tmp.matrix);
      tmp.position.set(p.x, p.y + 1.58, p.z); tmp.updateMatrix(); pedM.inst.head.setMatrixAt(i, tmp.matrix);
      tmp.position.set(p.x - Math.cos(p.yaw) * 0.12, p.y + 0.38, p.z + Math.sin(p.yaw) * 0.12); tmp.rotation.set(wlk, p.yaw, 0); tmp.updateMatrix(); pedM.inst.legL.setMatrixAt(i, tmp.matrix);
      tmp.position.set(p.x + Math.cos(p.yaw) * 0.12, p.y + 0.38, p.z - Math.sin(p.yaw) * 0.12); tmp.rotation.set(-wlk, p.yaw, 0); tmp.updateMatrix(); pedM.inst.legR.setMatrixAt(i, tmp.matrix);
    }
    for (const m of Object.values(pedM.inst)) m.instanceMatrix.needsUpdate = true;
  }
  function syncCars() {
    for (let i = 0; i < npcCars.length; i++) {
      const c = npcCars[i];
      tmp.position.set(c.x, c.y + 0.62, c.z); tmp.rotation.set(0, c.yaw, 0); tmp.scale.set(1, 1, 1); tmp.updateMatrix();
      carM.body.setMatrixAt(i, tmp.matrix);
      tmp.position.set(c.x - Math.sin(c.yaw) * -0.1, c.y + 1.16, c.z - Math.cos(c.yaw) * -0.1); tmp.updateMatrix();
      carM.cabin.setMatrixAt(i, tmp.matrix);
    }
    carM.body.instanceMatrix.needsUpdate = true; carM.cabin.instanceMatrix.needsUpdate = true;
  }

  self.update = (dt, W, playerPos, playerCar) => {
    const pc = playerCar ? { x: playerCar.pos.x, z: playerCar.pos.z, speed: playerCar.speed, yaw: playerCar.yaw, car: playerCar } : (playerPos ? { x: playerPos.x, z: playerPos.z, speed: 0, yaw: 0 } : null);
    for (const p of peds) {
      stepAgent(p, pedNet, dt, false, W, null, pc);
      // 被车撞：侧跳
      if (pc && pc.car) {
        const d = Math.hypot(p.x - pc.x, p.z - pc.z);
        if (d < 2.6) { const nx = (p.x - pc.x) / (d || 1), nz = (p.z - pc.z) / (d || 1); p.x += nx * 1.4; p.z += nz * 1.4; p.wait = 0.8; }
      }
      for (const c of npcCars) {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < 2.4) { const nx = (p.x - c.x) / (d || 1), nz = (p.z - c.z) / (d || 1); p.x += nx * 1.2; p.z += nz * 1.2; p.wait = 0.5; }
      }
    }
    for (const c of npcCars) stepAgent(c, carNet, dt, true, W, npcCars, pc && pc.car ? pc : null);
    syncPeds(); syncCars();
  };

  // 玩家车撞击 NPC 车。返回是否发生了较重的碰撞。
  self.ram = (playerCar) => {
    if (!playerCar) return 0;
    let hit = 0;
    for (const c of npcCars) {
      const dx = c.x - playerCar.pos.x, dz = c.z - playerCar.pos.z, d = Math.hypot(dx, dz);
      if (d < 3.6 && d > 0.05) {
        const nx = dx / d, nz = dz / d, rel = Math.abs(playerCar.speed);
        const push = (3.6 - d);
        c.x += nx * push * 0.9; c.z += nz * push * 0.9;
        c.vx = nx * (4 + rel * 0.55); c.vz = nz * (4 + rel * 0.55);
        c.stun = Math.min(2.2, 0.4 + rel * 0.08);
        c.speed = 0;
        playerCar.pos.x -= nx * push * 0.35; playerCar.pos.z -= nz * push * 0.35;
        playerCar.speed *= (rel > 10 ? 0.55 : 0.8);
        if (rel > 5) hit = Math.max(hit, rel > 12 ? 2 : 1);
      }
    }
    return hit;
  };

  // 初次姿态
  self.update(0.016, world, null, null);
  return self;
}
