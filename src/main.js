import * as THREE from 'three';
import { VS, CH, T, PAL, generate } from './world.js';
import { meshChunk } from './mesher.js';
import { U, ENV, voxelMaterial, makeSky, makePrecip, updateEnv, sunPos } from './sky.js';
import { fetchWeather, CLEAR, PRESETS, windDirName } from './weather.js';
import { Debris, makePlayerModel, Car } from './entities.js';
import { initAudio, sfx, engineSet, heliSet } from './audio.js';
import { createTraffic } from './traffic.js';
import { createHeli } from './heli.js';

THREE.ColorManagement.enabled = false;
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const IS_TOUCH = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer:coarse)').matches;
const qs = new URLSearchParams(location.search);
if (IS_TOUCH || qs.has('touch')) { document.body.classList.add('touch'); }
const TOUCH_UI = IS_TOUCH || qs.has('touch');
if (TOUCH_UI) { const k = document.getElementById('helpKb'), t = document.getElementById('helpTouch'); k.parentNode.insertBefore(t, k); }

// ───────── 渲染器 / 场景 ─────────
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !TOUCH_UI, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
let pixelRatio = Math.min(window.devicePixelRatio || 1, TOUCH_UI ? 1.25 : 1.75); if (qs.has('pr')) pixelRatio = +qs.get('pr');
renderer.setPixelRatio(pixelRatio);
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0xaabbcc, 0.001);
const camera = new THREE.PerspectiveCamera(72, 1, 0.12, 3200); camera.rotation.order = 'YXZ';
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, Math.PI), sunL = new THREE.DirectionalLight(0xffffff, Math.PI);
scene.add(hemi, sunL, sunL.target);
const sky = makeSky(); scene.add(sky.mesh);
const precip = makePrecip(6000); scene.add(precip.lines);
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ───────── 世界 ─────────
const area = JSON.parse($('areadata').textContent);
const W = generate(area);
const NCH = Math.ceil(W.sx / CH);
const vmat = voxelMaterial();
const chunks = new Array(NCH * NCH).fill(null);
const dirty = new Set();
function buildChunk(cx, cz) {
  const r = meshChunk(W, cx, cz), k = cx * NCH + cz, old = chunks[k];
  if (old) { scene.remove(old); old.geometry.dispose(); chunks[k] = null; }
  if (!r.idx.length) return 0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3)); g.setAttribute('aType', new THREE.BufferAttribute(r.typ, 1)); g.setAttribute('aNorm', new THREE.BufferAttribute(r.nrm, 1));
  g.setIndex(new THREE.BufferAttribute(r.idx, 1)); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, vmat); m.scale.setScalar(VS); m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); chunks[k] = m; return r.idx.length / 3;
}
function markDirty(x, z) {
  const cx = Math.floor(x / CH), cz = Math.floor(z / CH), lx = x - cx * CH, lz = z - cz * CH; dirty.add(cx * NCH + cz);
  if (lx === 0 && cx > 0) dirty.add((cx - 1) * NCH + cz); if (lx === CH - 1 && cx < NCH - 1) dirty.add((cx + 1) * NCH + cz);
  if (lz === 0 && cz > 0) dirty.add(cx * NCH + cz - 1); if (lz === CH - 1 && cz < NCH - 1) dirty.add(cx * NCH + cz + 1);
}
// 远处地面（防止看到世界边缘外的虚空）
const farGround = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: 0x59634f, fog: true })); farGround.rotation.x = -Math.PI / 2; farGround.position.set(W.sx * VS / 2, 0.6, W.sz * VS / 2); scene.add(farGround);

const debris = new Debris(scene, W);

// ───────── 状态 ─────────
const WORLD_M = W.sx * VS;
const P = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: -0.05, onGround: false, bodyYaw: 0, walkT: 0, spawn: new THREE.Vector3(), spawnYaw: 0 };
const S = { mode: 'load', fp: true, fly: false, car: null, heli: null, run: false, camYawFree: 0, lastLook: 0, shake: 0, timeMode: 0, wxMode: 0, blastCd: 0, breakCd: 0, hold: false, edgeToast: 0, muted: false, showFps: qs.has('fps') };
const keys = {}; const mv = { x: 0, y: 0 }; // 触屏摇杆
let wx = CLEAR, wxLive = CLEAR, wxTime = null;
const cars = [];
const playerModel = makePlayerModel(); scene.add(playerModel);

function groundTop(x, z, yFrom) {
  const gx = Math.floor(x / VS), gz = Math.floor(z / VS); let y = Math.min(W.sy - 1, Math.floor(yFrom / VS));
  for (; y >= 0; y--) { const t = W.get(gx, y, gz); if (t) return t === T.WATER ? y * VS + 0.8 : (y + 1) * VS; }
  return 0;
}
function solidBox(x0, y0, z0, x1, y1, z1) {
  const e = 1e-4, a = Math.floor(x0 / VS), b = Math.floor((x1 - e) / VS), c = Math.floor(y0 / VS), d = Math.floor((y1 - e) / VS), f = Math.floor(z0 / VS), g = Math.floor((z1 - e) / VS);
  for (let x = a; x <= b; x++) for (let y = c; y <= d; y++) for (let z = f; z <= g; z++) { const t = W.get(x, y, z); if (!t) continue; if (t === T.WATER && y0 >= y * VS + 0.8 - 1e-4) continue; return true; }
  return false;
}
function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
  let x = ox / VS, y = oy / VS, z = oz / VS, ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz), tdx = dx ? Math.abs(1 / dx) : 1e30, tdy = dy ? Math.abs(1 / dy) : 1e30, tdz = dz ? Math.abs(1 / dz) : 1e30;
  let tmx = dx > 0 ? (ix + 1 - x) * tdx : dx < 0 ? (x - ix) * tdx : 1e30, tmy = dy > 0 ? (iy + 1 - y) * tdy : dy < 0 ? (y - iy) * tdy : 1e30, tmz = dz > 0 ? (iz + 1 - z) * tdz : dz < 0 ? (z - iz) * tdz : 1e30;
  let t = 0, nx = 0, ny = 0, nz = 0; const maxT = maxDist / VS;
  for (let n = 0; n < 400; n++) {
    const tt = W.get(ix, iy, iz); if (tt && !(tt === T.WATER && false)) return { x: ix, y: iy, z: iz, nx, ny, nz, t: t * VS, type: tt };
    if (tmx < tmy && tmx < tmz) { ix += sx; t = tmx; tmx += tdx; nx = -sx; ny = nz = 0; } else if (tmy < tmz) { iy += sy; t = tmy; tmy += tdy; ny = -sy; nx = nz = 0; } else { iz += sz; t = tmz; tmz += tdz; nz = -sz; nx = ny = 0; }
    if (t > maxT) return null; if (iy < -1 || iy > W.sy + 2) return null;
  }
  return null;
}
const dirOf = (yaw, pitch) => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

// ───────── 破坏 / 坍塌 ─────────
function breakVox(x, y, z, sp = 1, vx = 0, vz = 0) {
  const t = W.get(x, y, z); if (!t || y <= 0) return 0;
  W.set(x, y, z, 0); markDirty(x, z);
  if (sp > 0 && Math.random() < sp) for (let i = 0; i < 2; i++) debris.spawn((x + .5) * VS, (y + .5) * VS, (z + .5) * VS, t, (Math.random() - .5) * 5 + vx, 2 + Math.random() * 5, (Math.random() - .5) * 5 + vz, 0.55);
  return t;
}
const N6 = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
function checkSupport(removed) {
  const done = new Set(), key = (x, y, z) => (x * W.sz + z) * W.sy + y; let collapsed = 0;
  for (const [rx, ry, rz] of removed) for (const [dx, dy, dz] of N6) {
    const sx = rx + dx, sy = ry + dy, sz = rz + dz; if (sy <= 1 || !W.get(sx, sy, sz) || done.has(key(sx, sy, sz))) continue;
    const seen = new Set([key(sx, sy, sz)]), comp = [[sx, sy, sz]], stack = [[sx, sy, sz]]; let grounded = false;
    while (stack.length) {
      const [cx, cy, cz] = stack.pop(); if (cy <= 1) { grounded = true; break; }
      for (const [ax, ay, az] of N6) { const nx = cx + ax, ny = cy + ay, nz = cz + az, k = key(nx, ny, nz); if (seen.has(k) || !W.get(nx, ny, nz)) continue; if (done.has(k)) { grounded = true; break; } seen.add(k); comp.push([nx, ny, nz]); stack.push([nx, ny, nz]); }
      if (grounded || comp.length > 9000) { grounded = true; break; }
    }
    if (grounded) { for (const k of seen) done.add(k); continue; }
    // 悬空 → 塌落
    const step = Math.max(1, Math.floor(comp.length / 260)); collapsed += comp.length;
    comp.forEach(([x, y, z], i) => { const t = W.get(x, y, z); W.set(x, y, z, 0); markDirty(x, z);
      if (i % step === 0) debris.spawn((x + .5) * VS, (y + .5) * VS, (z + .5) * VS, t, (Math.random() - .5) * 4, Math.random() * 2, (Math.random() - .5) * 4, 0.7); });
  }
  if (collapsed > 30) { sfx('collapse'); S.shake = Math.min(1, 0.3 + collapsed / 800); toast('结构失去支撑，坍塌了！'); }
}
function blast(cx, cy, cz, r = 3.2, spawnFrac = 0.4) {
  const removed = [], R = Math.ceil(r);
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
    if (x * x + y * y * 1.1 + z * z > r * r) continue; const X = cx + x, Y = cy + y, Z = cz + z;
    const d = Math.sqrt(x * x + y * y + z * z) + .1;
    if (breakVox(X, Y, Z, spawnFrac, x / d * 4, z / d * 4)) removed.push([X, Y, Z]);
  }
  if (removed.length) { sfx('blast'); checkSupport(removed); }
  return removed.length;
}
function breakAtTarget() { const h = S.target; if (!h) return; if (breakVox(h.x, h.y, h.z, 1)) { sfx('break'); checkSupport([[h.x, h.y, h.z]]); } }

// ───────── 玩家 ─────────
const HW = 0.3, PH = 1.75;
function hitP(p) { return solidBox(p.x - HW, p.y, p.z - HW, p.x + HW, p.y + PH, p.z + HW); }
const AX = ['x', 'y', 'z'];
function moveAxis(axis, d) {
  if (!d) return; const p = P.pos, k = AX[axis], old = p[k]; p[k] = old + d;
  if (!hitP(p)) { return; }
  let lo = old, hi = old + d; for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; p[k] = m; if (hitP(p)) hi = m; else lo = m; } p[k] = lo;
  if (axis === 1) { if (d < 0) P.onGround = true; P.vel.y = 0; } else P.vel[k] = 0;
}
function respawn() { if (S.heli) { heliCtrl.exit(P, S); S.heli = null; } P.pos.copy(P.spawn); P.vel.set(0, 0, 0); P.yaw = P.spawnYaw; P.pitch = -0.08; S.car = null; S.fly = false; }
function updatePlayer(dt) {
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + (-mv.y), s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mv.x;
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  let ix = fx * f + rx * s, iz = fz * f + rz * s; const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
  const run = keys.ShiftLeft || keys.ShiftRight || S.run || (TOUCH_UI && Math.hypot(mv.x, mv.y) > 0.92);
  let sp = S.fly ? (run ? 48 : 17) : (run ? 9.6 : 5);
  const inWater = W.get(Math.floor(P.pos.x / VS), Math.floor((P.pos.y + .2) / VS), Math.floor(P.pos.z / VS)) === T.WATER; if (inWater && !S.fly) sp *= 0.55;
  const acc = P.onGround || S.fly ? 14 : 4; const k = 1 - Math.exp(-acc * dt);
  P.vel.x += (ix * sp - P.vel.x) * k; P.vel.z += (iz * sp - P.vel.z) * k;
  if (S.fly) { const up = (keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0); P.vel.y += (up * sp * .7 - P.vel.y) * (1 - Math.exp(-8 * dt)); }
  else { P.vel.y -= 22 * dt; if (P.vel.y < -50) P.vel.y = -50; if (keys.Space && P.onGround) { P.vel.y = 9.2; P.onGround = false; sfx('jump'); } }
  P.onGround = false;
  const steps = Math.ceil(Math.max(Math.abs(P.vel.x), Math.abs(P.vel.z), Math.abs(P.vel.y)) * dt / 0.3) || 1, h = dt / steps;
  for (let i = 0; i < steps; i++) { moveAxis(0, P.vel.x * h); moveAxis(2, P.vel.z * h); moveAxis(1, P.vel.y * h); }
  if (S.fly && P.onGround) S.fly = S.fly; // 保持
  // 世界边界
  const lim = 2; let hitEdge = false;
  if (P.pos.x < lim) { P.pos.x = lim; hitEdge = true; } if (P.pos.x > WORLD_M - lim) { P.pos.x = WORLD_M - lim; hitEdge = true; }
  if (P.pos.z < lim) { P.pos.z = lim; hitEdge = true; } if (P.pos.z > WORLD_M - lim) { P.pos.z = WORLD_M - lim; hitEdge = true; }
  if (hitEdge && performance.now() - S.edgeToast > 4000) { S.edgeToast = performance.now(); toast('已到达地图边缘（V0.2 范围约 1.6 km × 1.6 km）'); }
  if (P.pos.y < -20) respawn();
  const spd = Math.hypot(P.vel.x, P.vel.z);
  if (spd > 0.5) { const ty = Math.atan2(-P.vel.x, -P.vel.z); let d = ty - P.bodyYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P.bodyYaw += d * Math.min(1, dt * 12); P.walkT += dt * spd * 1.15; }
  else P.walkT *= 0.9;
  if (S.fp && spd < 0.5) P.bodyYaw = P.yaw;
}
function placePlayerModel() {
  const m = playerModel; m.visible = !S.car && !S.heli && !S.fp; if (!m.visible) return;
  m.position.copy(P.pos); m.rotation.y = P.bodyYaw; const u = m.userData, a = Math.sin(P.walkT) * 0.9 * Math.min(1, Math.hypot(P.vel.x, P.vel.z) / 3);
  u.legL.rotation.x = a; u.legR.rotation.x = -a; u.armL.rotation.x = -a * .8; u.armR.rotation.x = a * .8;
  if (S.fly) { m.rotation.x = 0.35; } else m.rotation.x = 0;
}

// ───────── 汽车 ─────────
const CAR_COLS = [0xd64545, 0xe9eef3, 0x3566c9, 0xe8b830, 0x2a2d33, 0xaeb6bf, 0x2e9e6a];
function spawnCars() {
  const sp = W.spawns.slice().sort((a, b) => Math.hypot(a.x - WORLD_M / 2, a.z - WORLD_M / 2) - Math.hypot(b.x - WORLD_M / 2, b.z - WORLD_M / 2));
  const pick = []; for (const s of sp) { if (pick.length >= 8) break; if (s.cls > 3) continue; if (pick.every(p => Math.hypot(p.x - s.x, p.z - s.z) > 90)) pick.push(s); }
  if (!pick.length) pick.push(sp[0]);
  pick.forEach((s, i) => { const off = 2.0, yaw = s.yaw, x = s.x + Math.cos(yaw) * off, z = s.z - Math.sin(yaw) * off; const c = new Car(scene, CAR_COLS[i % CAR_COLS.length], x, z, yaw, groundTop(x, z, 12)); cars.push(c); });
  const c0 = cars[0]; // 出生点：第一辆车旁边
  P.spawn.set(c0.pos.x + Math.cos(c0.yaw) * 3.6, 0, c0.pos.z - Math.sin(c0.yaw) * 3.6); P.spawn.y = groundTop(P.spawn.x, P.spawn.z, 14) + 0.02; P.spawnYaw = c0.yaw;
}
const PROBES = [[-0.95, 2.1], [0.95, 2.1], [-0.95, -2.1], [0.95, -2.1], [0, 2.15], [0, -2.15], [-0.95, 0], [0.95, 0]];
function carBlocked(c, x, z) {
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const yLo = c.pos.y + 1.55, yHi = c.pos.y + 2.25;
  for (const [lx, lf] of PROBES) { const wx_ = x + cs * lx - sn * lf, wz_ = z - sn * lx - cs * lf; if (solidBox(wx_ - .15, yLo, wz_ - .15, wx_ + .15, yHi, wz_ + .15)) return [wx_, wz_]; }
  return null;
}
function groundDrive(x, z, yFrom) {
  const t = groundTop(x, z, yFrom);
  let hi = t, nHi = 0;
  for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6], [1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]]) {
    const t2 = groundTop(x + dx, z + dz, yFrom);
    if (t2 > t + 0.4 && t2 - t <= 1.8) { nHi++; if (t2 > hi) hi = t2; }
  }
  return nHi >= 2 ? hi : t;
}
function updateCar(c, dt, drive) {
  const thr = drive ? clamp((keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - mv.y, -1, 1) : 0;
  const str = drive ? clamp((keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mv.x, -1, 1) : 0;
  const boost = drive && (keys.ShiftLeft || keys.ShiftRight || S.run), hand = drive && keys.Space;
  const maxF = boost ? 38 : 28, maxR = 9;
  if (thr > 0) c.speed += (c.speed < -0.5 ? 26 : 13 * (1 - Math.max(0, c.speed) / (maxF + 4)) * (boost ? 1.5 : 1)) * thr * dt;
  else if (thr < 0) c.speed += (c.speed > 0.5 ? -24 : -8 * (1 - Math.max(0, -c.speed) / (maxR + 2))) * -thr * dt;
  else { const fr = 2.2 * dt; c.speed = Math.abs(c.speed) < fr ? 0 : c.speed - Math.sign(c.speed) * fr; }
  if (hand) { const fr = 30 * dt; c.speed = Math.abs(c.speed) < fr ? 0 : c.speed - Math.sign(c.speed) * fr; }
  c.speed -= c.speed * 0.045 * dt * (1 + Math.abs(c.speed) * 0.04); c.speed = clamp(c.speed, -maxR, maxF);
  c.steer += (str - c.steer) * (1 - Math.exp(-7 * dt));
  const delta = c.steer * 0.62 / (1 + Math.abs(c.speed) * 0.07); c.yaw -= (c.speed / 2.7) * Math.tan(delta) * dt;
  const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw); let nx = c.pos.x + fx * c.speed * dt, nz = c.pos.z + fz * c.speed * dt;
  nx = clamp(nx, 3, WORLD_M - 3); nz = clamp(nz, 3, WORLD_M - 3);
  let b = carBlocked(c, nx, nz);
  if (b) {
    const bx = carBlocked(c, nx, c.pos.z), bz = carBlocked(c, c.pos.x, nz);
    if (Math.abs(c.speed) > 11 && drive) { // 撞穿
      const gx = Math.floor(b[0] / VS), gz = Math.floor(b[1] / VS), gy = Math.floor((c.pos.y + .9) / VS), rem = [];
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { if (y + gy < 2 && !(y + gy >= 2)) continue; const t = breakVox(gx + x, gy + y, gz + z, .5, fx * c.speed * .5, fz * c.speed * .5); if (t) rem.push([gx + x, gy + y, gz + z]); }
      if (rem.length) { checkSupport(rem); sfx('crash'); S.shake = 0.6; c.speed *= 0.62; }
      else c.speed *= -0.2;
    } else { if (Math.abs(c.speed) > 4 && drive) sfx('bump'); c.speed *= -0.25; }
    if (!bx) c.pos.x = nx; if (!bz) c.pos.z = nz;
  } else { c.pos.x = nx; c.pos.z = nz; }
  for (const o of cars) { if (o === c) continue; const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z, d = Math.hypot(dx, dz); if (d < 3.4 && d > 0.01) { const push = (3.4 - d); o.pos.x += dx / d * push * .8; o.pos.z += dz / d * push * .8; if (drive) c.speed *= 0.9; } }
  if (drive && traffic) { const h = traffic.ram(c); if (h === 2) { sfx('crash'); S.shake = Math.max(S.shake, .45); } else if (h === 1) sfx('bump'); }
  // 贴地
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), wt = [];
  for (const [lx, lf] of [[-0.9, 1.35], [0.9, 1.35], [-0.9, -1.35], [0.9, -1.35]]) wt.push(groundDrive(c.pos.x + cs * lx - sn * lf, c.pos.z - sn * lx - cs * lf, c.pos.y + 1.0));
  const avg = (wt[0] + wt[1] + wt[2] + wt[3]) / 4, front = (wt[0] + wt[1]) / 2, rear = (wt[2] + wt[3]) / 2, right = (wt[1] + wt[3]) / 2, left = (wt[0] + wt[2]) / 2;
  c.vy -= 22 * dt; c.pos.y += c.vy * dt; if (c.pos.y <= avg) { c.pos.y = avg; c.vy = 0; }
  const tp = Math.atan2(front - rear, 2.7), tr = Math.atan2(right - left, 1.8); c.pitch += (clamp(tp, -.4, .4) - c.pitch) * Math.min(1, dt * 10); c.roll += (clamp(tr, -.4, .4) - c.roll) * Math.min(1, dt * 10);
  c.sync();
}
function nearestCar(r = 6) { let b = null, bd = r; for (const c of cars) { const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z); if (d < bd) { bd = d; b = c; } } return b; }
function toggleCar() {
  if (S.heli) { heliCtrl.exit(P, S); return; }
  if (S.car) { // 下车
    const c = S.car, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const tries = [[-2.2, 0], [2.2, 0], [0, 3.5], [0, -3.5], [-3.5, 2], [3.5, 2]];
    for (const [lx, lf] of tries) { const x = c.pos.x + cs * lx - sn * lf, z = c.pos.z - sn * lx - cs * lf, y = groundTop(x, z, c.pos.y + 3) + 0.02; P.pos.set(x, y, z); if (!hitP(P.pos)) { S.car = null; break; } }
    if (S.car) { P.pos.set(c.pos.x, c.pos.y + 3.2, c.pos.z); S.car = null; }
    P.vel.set(0, 0, 0); P.yaw = c.yaw; engineSet(0, false); toast('已下车'); 
  } else { const c = nearestCar(6.5); if (!c) { toast('附近没有汽车（走近到 6 米内再按 J）'); return; } S.car = c; S.fly = false; S.fp = false; c.speed = 0; initAudio(); engineSet(0, true); toast('已上车：W 油门 · S 刹车/倒车 · A D 转向 · 空格 手刹 · Shift 加速'); }
}

// ───────── 相机 ─────────
let camDist = 4.6;
const hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, depthTest: true })); hl.scale.setScalar(VS * 1.01); hl.visible = false; scene.add(hl);
function updateCamera(dt) {
  const c = S.car; let pivot, dist;
  if (S.heli) {
    const h = S.heli;
    pivot = new THREE.Vector3(h.pos.x, h.pos.y + 1.6, h.pos.z); dist = 12;
    if (S.fp) { camera.position.set(h.pos.x, h.pos.y + 1.35, h.pos.z).addScaledVector(dirOf(h.yaw, 0), 0.4); camera.rotation.set(P.pitch, P.yaw, 0); return finishCam(dt); }
  } else if (c) {
    if (performance.now() - S.lastLook > 1400 && Math.abs(c.speed) > 2) { let d = c.yaw - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); if (c.speed < -1) d = Math.atan2(Math.sin(d + Math.PI), Math.cos(d + Math.PI)); P.yaw += d * Math.min(1, dt * 2.2); if (P.pitch > -0.06) P.pitch += (-0.16 - P.pitch) * Math.min(1, dt * 1.5); }
    pivot = new THREE.Vector3(c.pos.x, c.pos.y + 1.7, c.pos.z); dist = 8.2;
    if (S.fp) { const f = dirOf(c.yaw, 0); camera.position.set(c.pos.x - f.x * 0.05, c.pos.y + 1.28, c.pos.z - f.z * 0.05).addScaledVector(f, 0.15); camera.rotation.set(P.pitch, P.yaw, 0); return finishCam(dt); }
  } else { pivot = new THREE.Vector3(P.pos.x, P.pos.y + (S.fp ? 1.62 : 1.55), P.pos.z); dist = 4.4; }
  if (S.fp && !c && !S.heli) { camera.position.copy(pivot); }
  else { const d = dirOf(P.yaw, P.pitch), want = pivot.clone().addScaledVector(d, -dist); const hit = raycast(pivot.x, pivot.y, pivot.z, -d.x, -d.y, -d.z, dist + .4); const dd = hit ? Math.max(.5, hit.t - 0.4) : dist; camDist += (dd - camDist) * Math.min(1, dt * (dd < camDist ? 30 : 4)); camera.position.copy(pivot).addScaledVector(d, -camDist); }
  camera.rotation.set(P.pitch, P.yaw, 0); finishCam(dt);
}
function finishCam(dt) {
  if (S.shake > 0) { camera.position.x += (Math.random() - .5) * S.shake * .5; camera.position.y += (Math.random() - .5) * S.shake * .5; S.shake = Math.max(0, S.shake - dt * 1.6); }
  if (camera.position.y < 0.3) camera.position.y = 0.3;
  // 目标方块
  const d = dirOf(P.yaw, P.pitch), reach = S.fp || S.car ? 16 : 22;
  const h = raycast(camera.position.x, camera.position.y, camera.position.z, d.x, d.y, d.z, reach);
  S.target = null; hl.visible = false;
  if (h && h.y > 0) { const cx = (h.x + .5) * VS, cy = (h.y + .5) * VS, cz = (h.z + .5) * VS, dp = Math.hypot(cx - P.pos.x, cy - P.pos.y - 1, cz - P.pos.z);
    if (dp <= 18 || S.car) { S.target = h; hl.position.set(cx, cy, cz); hl.visible = true; } }
}

// ───────── 天气 / 时间 / 环境 ─────────
const TIME_MODES = [['实时', null], ['清晨', 7.0], ['正午', 12.2], ['黄昏', 16.75], ['深夜', 22.6]];
function hzNow() { const d = new Date(Date.now() + 8 * 3600e3); return { h: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600, doy: Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5), d }; }
const pad = n => String(n).padStart(2, '0');
function curTime() { const n = hzNow(), o = TIME_MODES[S.timeMode][1]; return { h: o == null ? n.h : o, doy: n.doy, d: n.d, fixed: o != null }; }
let envT = 0;
function refreshEnv() { const t = curTime(); updateEnv(t.h, t.doy, wx, sky, precip, scene, area.c[0], area.c[1]); lightsSync(); }
function lightsSync() { const c = ENV.ambSky, g = ENV.ambGnd; hemi.color.setRGB(c[0], c[1], c[2]); hemi.groundColor.setRGB(g[0], g[1], g[2]); sunL.color.setRGB(...ENV.lightCol); sunL.position.copy(ENV.lightDir).multiplyScalar(100).add(P.pos); sunL.target.position.copy(P.pos); }
function applyWxMode() { const p = PRESETS[S.wxMode]; wx = p.real ? wxLive : p.v; refreshEnv(); }
async function loadWeather() {
  try { wxLive = await fetchWeather(area.c[0], area.c[1]); wxTime = new Date(); if (S.wxMode === 0) { wx = wxLive; refreshEnv(); } window.__wxOK = true; }
  catch (e) { console.warn('[weather] fallback to clear:', e && e.message); wxLive = { ...CLEAR }; window.__wxOK = false; if (S.wxMode === 0) { wx = wxLive; refreshEnv(); } toast('天气接口不可用，已按晴天处理'); }
}

// ───────── HUD / UI ─────────
let toastT = 0;
function toast(s) { const e = $('toast'); e.textContent = s; e.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => e.style.opacity = 0, 2600); }
function hint(s) { const e = $('hint'); if (s) { e.textContent = s; e.classList.remove('hide'); } else e.classList.add('hide'); }
const mini = $('mini'), mctx = mini.getContext('2d'); const miniCv = document.createElement('canvas'); miniCv.width = W.sx; miniCv.height = W.sz; miniCv.getContext('2d').putImageData(W.minimap, 0, 0);
function drawMini() {
  const S_ = 136, scale = 0.55, px = (S.car ? S.car.pos.x : P.pos.x) / VS, pz = (S.car ? S.car.pos.z : P.pos.z) / VS;
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.fillStyle = '#2a3340'; mctx.fillRect(0, 0, S_, S_);
  mctx.translate(S_ / 2, S_ / 2); mctx.rotate(P.yaw); mctx.scale(scale, scale); mctx.imageSmoothingEnabled = true; mctx.drawImage(miniCv, -px, -pz);
  if (traffic) for (const c of traffic.npcCars) { mctx.fillStyle = '#dde'; mctx.fillRect(c.x / VS - px - 1.5, c.z / VS - pz - 1.5, 3, 3); }
  for (const c of cars) { mctx.fillStyle = c === S.car ? '#fff' : '#' + c.color.toString(16).padStart(6, '0'); mctx.fillRect(c.pos.x / VS - px - 2, c.pos.z / VS - pz - 2, 5, 5); }
  if (heliCtrl && heliCtrl.st.alive) { mctx.fillStyle = '#9cf'; mctx.beginPath(); mctx.arc(heliCtrl.st.pos.x / VS - px, heliCtrl.st.pos.z / VS - pz, 3.2, 0, 6.3); mctx.fill(); }
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.translate(S_ / 2, S_ / 2); mctx.fillStyle = '#ff3b3b'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(5, 6); mctx.lineTo(0, 3); mctx.lineTo(-5, 6); mctx.closePath(); mctx.fill(); mctx.stroke();
}
const WK = '日一二三四五六';
function updateHud() {
  const t = curTime(), hh = Math.floor(t.h), mm = Math.floor((t.h - hh) * 60), d = t.d;
  $('hudTime').textContent = `杭州 ${pad(hh)}:${pad(mm)}${t.fixed ? ' ·' + TIME_MODES[S.timeMode][0] : ''}`;
  $('hudDate').textContent = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 周${WK[d.getUTCDay()]}`;
  const w = wx, ico = w.snow ? '❄' : w.fog ? '🌫' : w.rain > 0.05 ? '🌧' : w.cloud > 70 ? '☁' : w.cloud > 30 ? '⛅' : '☀';
  const wmode = '';
  $('hudWx').textContent = `${ico} ${w.text}${w.temp != null ? '  ' + w.temp.toFixed(1) + '°C' : ''}${wmode}`;
  $('hudWx2').textContent = w.source === 'fallback' ? '实时天气不可用 · 按晴天显示' : `云量 ${Math.round(w.cloud)}% · 降水 ${w.rain.toFixed(1)} mm · ${windDirName(w.windDir)} ${w.wind.toFixed(1)} m/s${w.hum != null ? ' · 湿度 ' + Math.round(w.hum) + '%' : ''}`;
  const x = S.car ? S.car.pos.x : P.pos.x, z = S.car ? S.car.pos.z : P.pos.z, gx = Math.floor(x / VS), gz = Math.floor(z / VS);
  let place = ''; const nid = (gx >= 0 && gz >= 0 && gx < W.sx && gz < W.sz) ? W.nameId[gx * W.sz + gz] : 0;
  if (nid) place = W.names[nid - 1] + '（路）'; else { let bd = 200, bn = ''; for (const p of W.pois) { const dd = Math.hypot(p.x - x, p.z - z); const lim = p.landmark ? 200 : 140; if (dd < lim && dd < bd) { bd = dd; bn = p.name; } } place = bn ? '附近：' + bn : '滨江区'; }
  $('hudPlace').textContent = '📍 ' + place;
  const half = area.half, lat = area.c[0] + (half - z) / 110574, lon = area.c[1] + (x - half) / (111320 * Math.cos(area.c[0] * Math.PI / 180));
  const hdg = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360, dir = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(hdg / 45) % 8];
  $('hudCoord').textContent = `${lat.toFixed(5)}°N ${lon.toFixed(5)}°E · 朝${dir}` + (S.car ? ` · ${Math.abs(S.car.speed * 3.6).toFixed(0)} km/h` : '');
  $('hudMode').textContent = S.heli ? '直升机' : S.car ? '驾驶' : S.fly ? '飞行' : '步行'; 
  const nc = nearestCar(6.5);
  if (S.mode === 'play') {
    if (S.heli) hint(TOUCH_UI ? '点「离开」下机' : 'E 或 J 离开直升机');
    else if (S.car) hint(TOUCH_UI ? '' : 'J 下车');
    else if (nc) hint(TOUCH_UI ? '点「上/下车」上车' : '按 J 上车');
    else hint('');
  }
}

// ───────── 输入 ─────────
function startPlay() { S.fp = true; initAudio(); $('start').classList.add('hide'); $('pause').classList.add('hide'); $('help').classList.add('hide'); S.mode = 'play'; setHud(true); if (!TOUCH_UI) canvas.requestPointerLock && canvas.requestPointerLock(); }
function setHud(on) { for (const id of ['hud', 'miniWrap', 'cross', 'attr']) $(id).classList.toggle('hide', !on); $('touch').classList.toggle('hide', !(on && TOUCH_UI)); $('fps').classList.toggle('hide', !(on && S.showFps)); }
function pauseGame() { if (S.mode !== 'play') return; S.mode = 'pause'; if (!TOUCH_UI) $('pause').classList.remove('hide'); }
function showHelp(v) { $('help').classList.toggle('hide', !v); S.helpOpen = v; if (v && document.pointerLockElement) document.exitPointerLock(); }
$('btnStart').onclick = startPlay; $('btnResume').onclick = startPlay; $('btnHelp').onclick = () => showHelp(true); $('btnHelp2').onclick = () => showHelp(true);
$('btnHelpClose').onclick = () => { showHelp(false); };
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && S.mode === 'play' && !TOUCH_UI) pauseGame(); });
canvas.addEventListener('click', () => { if (S.mode === 'play' && !TOUCH_UI && !document.pointerLockElement) canvas.requestPointerLock(); });
document.addEventListener('mousemove', e => { if (S.mode !== 'play' || !document.pointerLockElement) return; P.yaw -= e.movementX * 0.0022; P.pitch = clamp(P.pitch - e.movementY * 0.0022, -1.5, 1.5); S.lastLook = performance.now(); });
document.addEventListener('mousedown', e => { if (S.mode !== 'play' || !document.pointerLockElement) return; if (e.button === 0) { S.hold = true; } else if (e.button === 2) doBlast(); });
document.addEventListener('mouseup', e => { if (e.button === 0) S.hold = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
function doBlast() { if (S.blastCd > 0 || !S.target) return; S.blastCd = 0.7; const h = S.target; blast(h.x + h.nx * 0 , h.y, h.z, 3.4, 0.35); S.shake = Math.max(S.shake, .35); }
addEventListener('keydown', e => {
  if (e.code === 'KeyH' && !e.repeat) { showHelp(!S.helpOpen); return; }
  if (e.code === 'Escape' && S.helpOpen) { showHelp(false); return; }
  if (S.mode !== 'play') { if ((e.code === 'Enter' || e.code === 'Space') && S.mode === 'menu' && !S.helpOpen) { e.preventDefault(); startPlay(); } return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (e.code === 'KeyB') S.hold = true;
  else if (e.code === 'KeyQ') doBlast();
  else if (e.code === 'KeyJ' || e.code === 'KeyE') { if (S.heli) heliCtrl.exit(P, S); else if (e.code === 'KeyJ') toggleCar(); }
  else if (e.code === 'KeyU') heliCtrl.callOrEnter(P, S);
  else if (e.code === 'KeyV') { S.fp = !S.fp; toast(S.fp ? '第一人称' : '第三人称'); }
  else if (e.code === 'KeyF') { if (!S.car && !S.heli) { S.fly = !S.fly; toast(S.fly ? '飞行模式：空格上升 · C 下降 · Shift 加速' : '已关闭飞行'); } }
  else if (e.code === 'KeyT') cycleTime();
  else if (e.code === 'KeyY') cycleWx();
  else if (e.code === 'KeyR') { respawn(); toast('已回到出生点'); }
  else if (e.code === 'KeyM') { S.muted = !S.muted; sfx('mute', S.muted); toast(S.muted ? '声音已关闭' : '声音已开启'); }
  else if (e.code === 'F3') { S.showFps = !S.showFps; $('fps').classList.toggle('hide', !S.showFps); e.preventDefault(); }
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyB') S.hold = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; S.hold = false; });
function cycleTime() { S.timeMode = (S.timeMode + 1) % TIME_MODES.length; refreshEnv(); toast('时间：' + TIME_MODES[S.timeMode][0]); }
function cycleWx() { S.wxMode = (S.wxMode + 1) % PRESETS.length; applyWxMode(); toast('天气：' + PRESETS[S.wxMode].name); }

// 触屏
(function touchInit() {
  if (!TOUCH_UI) return;
  const joy = $('joy'), knob = $('knob'); let jid = null, jc = null, lid = null, lx = 0, ly = 0;
  const jr = 56;
  const jmove = t => { const dx = t.clientX - jc.x, dy = t.clientY - jc.y, l = Math.hypot(dx, dy), k = l > jr ? jr / l : 1; knob.style.transform = `translate(${dx * k}px,${dy * k}px)`; mv.x = dx * k / jr; mv.y = dy * k / jr; };
  joy.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; jid = t.identifier; const r = joy.getBoundingClientRect(); jc = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; jmove(t); }, { passive: false });
  addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (t.identifier === jid) jmove(t); else if (t.identifier === lid && S.mode === 'play') { P.yaw -= (t.clientX - lx) * 0.0055; P.pitch = clamp(P.pitch - (t.clientY - ly) * 0.0055, -1.5, 1.5); lx = t.clientX; ly = t.clientY; S.lastLook = performance.now(); } } if (S.mode === 'play') e.preventDefault(); }, { passive: false });
  const tend = e => { for (const t of e.changedTouches) { if (t.identifier === jid) { jid = null; mv.x = mv.y = 0; knob.style.transform = ''; } if (t.identifier === lid) lid = null; } };
  addEventListener('touchend', tend); addEventListener('touchcancel', tend);
  canvas.addEventListener('touchstart', e => { if (S.mode !== 'play') return; for (const t of e.changedTouches) if (lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: true });
  const bind = (id, down, up) => { const b = $(id); b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); down && down(); }, { passive: false }); const u = e => { e.preventDefault(); b.classList.remove('on'); up && up(); }; b.addEventListener('touchend', u); b.addEventListener('touchcancel', u); };
  bind('tbJump', () => { keys.Space = true; }, () => { keys.Space = false; });
  bind('tbBreak', () => { S.hold = true; }, () => { S.hold = false; });
  bind('tbBlast', doBlast); bind('tbCar', toggleCar);
  if ($('tbHeli')) bind('tbHeli', () => { if (S.heli) heliCtrl.exit(P, S); else heliCtrl.callOrEnter(P, S); });
  bind('tbRun', () => { S.run = !S.run; $('tbRun').style.outline = S.run ? '3px solid #6cf' : ''; toast(S.run ? '奔跑：开' : '奔跑：关'); });
  bind('tbView', () => { S.fp = !S.fp; toast(S.fp ? '第一人称' : '第三人称'); }); bind('tbFly', () => { if (!S.car && !S.heli) { S.fly = !S.fly; toast(S.fly ? '飞行：按「跳」上升' : '已关闭飞行'); } });
  bind('tbTime', cycleTime); bind('tbWx', cycleWx); bind('tbMenu', () => { showHelp(true); });
})();

// ───────── 主循环 ─────────
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsShow = 0, lowT = 0, hudT = 0, miniT = 0;
const stat = { fps: 0, tris: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now; if (dt <= 0) dt = 0.001;
  fpsAcc += dt; fpsN++; if (fpsAcc >= 0.5) { stat.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (S.showFps) $('fps').textContent = `FPS ${stat.fps.toFixed(0)} · 三角面 ${(renderer.info.render.triangles / 1000).toFixed(0)}k · 碎块 ${debris.n} · PR ${pixelRatio.toFixed(2)}`;
    if (S.mode === 'play' && !qs.has('pr')) { if (stat.fps < 24) lowT += 0.5; else lowT = Math.max(0, lowT - 0.5); if (lowT >= 2 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio * 0.8); renderer.setPixelRatio(pixelRatio); resize(); lowT = 0; } } }
  if (S.mode === 'play') {
    S.blastCd -= dt; S.breakCd -= dt;
    if (S.heli) { heliCtrl.update(dt, { keys, mv, P, S }); engineSet(0, false); }
    else if (S.car) { updateCar(S.car, dt, true); P.pos.set(S.car.pos.x, S.car.pos.y, S.car.pos.z); engineSet(Math.abs(S.car.speed) / 30, true); heliSet(false); }
    else { updatePlayer(dt); engineSet(0, false); }
    if (traffic) traffic.update(dt, W, P.pos, S.car);
    if (!S.heli) heliCtrl.update(dt, { keys, mv, P, S });
    for (const c of cars) if (c !== S.car && (Math.abs(c.speed) > 0.05 || c.vy !== 0 || c.pos.y > groundTop(c.pos.x, c.pos.z, c.pos.y + 1) + 0.05)) { c.speed *= (1 - 3 * dt); updateCar(c, dt, false); }
    if (S.hold && S.breakCd <= 0 && S.target) { breakAtTarget(); S.breakCd = 0.11; }
  }
  if (S.mode === 'menu' || S.mode === 'load') { P.yaw += dt * 0.06; S.fp = false; P.pitch = -0.1; }
  updateCamera(dt);
  placePlayerModel();
  debris.update(dt);
  // 脏块重建（预算 6ms）
  if (dirty.size) { const t0 = performance.now(); for (const k of dirty) { buildChunk(Math.floor(k / NCH), k % NCH); dirty.delete(k); if (performance.now() - t0 > 6) break; } }
  // 环境
  const T_ = performance.now() / 1000; sky.uni.uTime.value = T_; precip.uni.uTime.value = T_; precip.uni.uCam.value.copy(camera.position);
  sky.mesh.position.copy(camera.position); farGround.position.x = camera.position.x; farGround.position.z = camera.position.z;
  envT += dt; if (envT > 1.0) { envT = 0; refreshEnv(); }
  sunL.position.copy(ENV.lightDir).multiplyScalar(100).add(P.pos); sunL.target.position.copy(P.pos);
  farGround.material.color.setRGB(ENV.fogCol[0] * .75, ENV.fogCol[1] * .8, ENV.fogCol[2] * .65);
  // 灯：夜晚手电 / 车灯
  const lampOn = ENV.night > 0.35 || ENV.over > 0.7 && ENV.sunElev < 0.15;
  if (S.heli) { const h = S.heli, f = dirOf(h.yaw, -0.4); U.uLampPos.value.set(h.pos.x, h.pos.y - 0.4, h.pos.z); U.uLampDir.value.copy(f); U.uLampI.value = ENV.night > 0.2 ? 1.4 : 0.15; U.uLampCos.value = 0.82; }
  else if (S.car) { const c = S.car, f = dirOf(c.yaw, -0.03); U.uLampPos.value.set(c.pos.x + f.x * 2, c.pos.y + 0.9, c.pos.z + f.z * 2); U.uLampDir.value.copy(f); U.uLampI.value = ENV.night > 0.2 ? 1.2 : 0; U.uLampCos.value = 0.86; }
  else { const d = dirOf(P.yaw, P.pitch); U.uLampPos.value.copy(camera.position); U.uLampDir.value.copy(d); U.uLampI.value = ENV.night > 0.4 ? 0.9 : 0; U.uLampCos.value = 0.93; }
  renderer.render(scene, camera);
  hudT += dt; if (hudT > 0.25 && S.mode !== 'load') { hudT = 0; updateHud(); } miniT += dt; if (miniT > 0.05 && S.mode !== 'load' && S.mode !== 'menu') { miniT = 0; drawMini(); }
}

// ───────── 启动：分块网格化（带进度）─────────
let traffic = null, heliCtrl = null;
async function boot() {
  spawnCars();
  const lm = W.pois.find(p => p.name === '星澜里') || W.pois.find(p => p.landmark);
  if (lm) {
    let bx = lm.x, bz = lm.z, bd = 1e18, yaw = 0;
    if (W.spawns.length) {
      for (const s of W.spawns) { const d = Math.hypot(s.x - lm.x, s.z - lm.z); if (d < bd) { bd = d; bx = s.x; bz = s.z; yaw = s.yaw; } }
    }
    if (bd > 40) {
      const i0 = Math.floor(lm.x / VS), j0 = Math.floor(lm.z / VS);
      for (let i = i0 - 45; i <= i0 + 45; i++) for (let j = j0 - 45; j <= j0 + 45; j++) {
        const t = W.get(i, 1, j);
        if (t === T.ASPH || t === T.MARK || t === T.SIDEW) {
          const d = (i * VS - lm.x) ** 2 + (j * VS - lm.z) ** 2;
          if (d < bd * bd) { bd = Math.sqrt(d); bx = i * VS + VS / 2; bz = j * VS + VS / 2; }
        }
      }
    }
    P.spawn.set(bx, groundTop(bx, bz, 14) + 0.02, bz); P.spawnYaw = yaw;
  }
  traffic = createTraffic(scene, W, area);
  heliCtrl = createHeli(scene, W, { groundTop, solidBox, toast, clamp, WORLD_M });
  respawn(); refreshEnv();
  const cx0 = Math.floor(P.pos.x / VS / CH), cz0 = Math.floor(P.pos.z / VS / CH), order = [];
  for (let x = 0; x < NCH; x++) for (let z = 0; z < NCH; z++) order.push([x, z, (x - cx0) ** 2 + (z - cz0) ** 2]);
  order.sort((a, b) => a[2] - b[2]);
  let i = 0, tris = 0; const bar = $('bar').firstElementChild, txt = $('loadtxt');
  await new Promise(res => { (function step() { const t0 = performance.now(); while (i < order.length && performance.now() - t0 < 40) { tris += buildChunk(order[i][0], order[i][1]); i++; } bar.style.width = (i / order.length * 100).toFixed(0) + '%'; txt.textContent = `正在把滨江体素化… ${(i / order.length * 100).toFixed(0)}%`; if (i < order.length) setTimeout(step, 0); else res(); })(); });
  stat.tris = tris; $('loading').classList.add('hide'); $('start').classList.remove('hide'); S.mode = 'menu';
  $('startStat').textContent = `${W.stats.buildings} 栋建筑 · ${W.stats.trees} 棵树 · ${traffic.counts.peds} 行人 · ${traffic.counts.cars} 辆路过的车 · ${(W.stats.voxels / 1e6).toFixed(1)}M 体素 · ${(tris / 1000).toFixed(0)}k 三角面`;
  loadWeather(); setInterval(loadWeather, 10 * 60e3);
  requestAnimationFrame(t => { last = t; frame(t); });
}
// 调试 / 测试钩子
window.__game = { S, P, W, cars, scene, camera, renderer, debris, stat, area, ENV, start: startPlay, setTimeMode: m => { S.timeMode = m; refreshEnv(); }, setWx: m => { S.wxMode = m; applyWxMode(); }, blast, raycast, breakVox, checkSupport, groundTop, toggleCar, keys, doBlast, get wx() { return wx; }, get traffic() { return traffic; }, get heli() { return heliCtrl && heliCtrl.st; }, callHeli: () => heliCtrl.callOrEnter(P, S), exitHeli: () => heliCtrl.exit(P, S) };
boot();
