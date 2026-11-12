// 直升机：U 召唤/登机，WASD+鼠标飞行，空格上升、C 下降，E 或 J 离开。简单建筑碰撞。
import * as THREE from 'three';
import { VS, T } from './world.js';
import { makeHelicopter } from './entities.js';
import { initAudio, heliSet, sfx } from './audio.js';

export function createHeli(scene, world, { groundTop, solidBox, toast, clamp, WORLD_M }) {
  const mesh = makeHelicopter();
  mesh.visible = false;
  scene.add(mesh);
  const st = {
    mesh, alive: false, mode: 'idle', // idle | approach | hover | flown
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, roll: 0, rotor: 0, target: null, occupied: false,
  };

  function hide() { mesh.visible = false; st.alive = false; st.occupied = false; st.mode = 'idle'; heliSet(false); }
  function place() {
    mesh.visible = true;
    mesh.position.copy(st.pos);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(st.pitch, st.yaw, st.roll);
    const ud = mesh.userData, spin = st.rotor;
    if (ud.mainR) ud.mainR.rotation.y = spin;
    if (ud.tailR) ud.tailR.rotation.x = spin * 4.2;
  }
  function blocked(x, y, z) {
    // 只用机身做碰撞，忽略树叶，避免低空被树冠卡住
    return solidBox(x - 1.0, y + 0.2, z - 1.8, x + 1.0, y + 1.7, z + 1.8);
  }
  function findPad(px, py, pz) {
    // 优先玩家脚边的开阔地（非建筑、非水面）
    const tries = [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [10, 6], [-10, 6], [6, -10], [-12, 0], [0, 12]];
    for (const [dx, dz] of tries) {
      const x = clamp(px + dx, 8, WORLD_M - 8), z = clamp(pz + dz, 8, WORLD_M - 8);
      const gy = Math.floor(4.5 / VS);
      let clear = true;
      for (let i = -2; i <= 2 && clear; i++) for (let j = -2; j <= 2 && clear; j++) {
        const t = world.get(Math.floor(x / VS) + i, gy, Math.floor(z / VS) + j);
        if (t && t !== T.WATER && t !== T.ASPH && t !== T.SIDEW && t !== T.MARK && t !== T.PAVE && t !== T.GRASS && t !== T.PITCH && t !== T.DIRT && t !== T.BASE) clear = false;
      }
      const y = groundTop(x, z, py + 8);
      if (clear && y > 1 && y < py + 12) return new THREE.Vector3(x, y + 0.15, z);
    }
    return new THREE.Vector3(px, groundTop(px, pz, py + 8) + 0.15, pz);
  }

  function spawnToward(pad, fromYaw) {
    const back = 90, alt = 48;
    const x = clamp(pad.x + Math.sin(fromYaw) * back, 20, WORLD_M - 20);
    const z = clamp(pad.z + Math.cos(fromYaw) * back, 20, WORLD_M - 20);
    st.pos.set(x, pad.y + alt, z);
    st.vel.set(0, 0, 0);
    st.yaw = Math.atan2(-(pad.x - x), -(pad.z - z));
    st.pitch = 0; st.roll = 0; st.alive = true; st.mode = 'approach'; st.target = pad.clone(); st.occupied = false;
    place();
  }

  function enter(P, S) {
    if (S.car) return false;
    st.occupied = true; st.mode = 'flown'; S.heli = st; S.fly = false; S.fp = false;
    P.pos.copy(st.pos); P.vel.set(0, 0, 0); P.yaw = st.yaw;
    initAudio(); heliSet(true, 0.6); sfx('heli');
    return true;
  }
  function exit(P, S) {
    if (!st.occupied) return;
    const cs = Math.cos(st.yaw), sn = Math.sin(st.yaw);
    const tries = [[2.6, 0], [-2.6, 0], [0, 3.2], [0, -3.2], [3.5, 2]];
    let ok = false;
    for (const [lx, lf] of tries) {
      const x = st.pos.x + cs * lx - sn * lf, z = st.pos.z - sn * lx - cs * lf, y = groundTop(x, z, st.pos.y + 6) + 0.02;
      P.pos.set(x, y, z);
      if (!solidBox(x - 0.3, y, z - 0.3, x + 0.3, y + 1.75, z + 0.3) && Math.abs(y - st.pos.y) < 4) { ok = true; break; }
    }
    if (!ok) { // 还在空中：从悬停点落到下方地面（若太高则拒绝）
      if (st.pos.y - groundTop(st.pos.x, st.pos.z, st.pos.y) > 5) { toast('请先把直升机降到接近地面再离开'); return false; }
      P.pos.set(st.pos.x + 2.5, groundTop(st.pos.x + 2.5, st.pos.z, st.pos.y + 4) + 0.02, st.pos.z);
    }
    st.occupied = false; S.heli = null; P.vel.set(0, 0, 0); P.yaw = st.yaw; heliSet(true, 0.25);
    st.mode = 'hover'; toast('已离开直升机');
    return true;
  }

  function callOrEnter(P, S) {
    if (st.occupied) return;
    if (S.car) { toast('请先下车，再召唤直升机'); return; }
    const near = st.alive && Math.hypot(st.pos.x - P.pos.x, st.pos.z - P.pos.z) < 10 && Math.abs(st.pos.y - (P.pos.y + 1.5)) < 5;
    if (near) { if (enter(P, S)) toast('已登机：W A S D 飞 · 空格上升 · C 下降 · Shift 加速 · 鼠标转向 · E 或 J 离开'); return; }
    const pad = findPad(P.pos.x, P.pos.y, P.pos.z);
    if (!st.alive) spawnToward(pad, P.yaw);
    else { st.target = pad; st.mode = 'approach'; }
    initAudio(); heliSet(true, 0.5); toast('直升机正在赶来… 降落后再按 U 登机');
  }

  function autoPilot(dt) {
    if (!st.target) { st.mode = 'hover'; return; }
    const t = st.target, dx = t.x - st.pos.x, dz = t.z - st.pos.z, dist = Math.hypot(dx, dz);
    const tyaw = Math.atan2(-dx, -dz);
    let dy = tyaw - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    st.yaw += dy * Math.min(1, dt * 1.6);
    const cruise = dist > 40 ? 48 : dist > 12 ? 22 : 8;
    const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
    if (dist > 8) {
      st.vel.x += (fx * cruise - st.vel.x) * Math.min(1, dt * 1.4);
      st.vel.z += (fz * cruise - st.vel.z) * Math.min(1, dt * 1.4);
      const wantY = t.y + (dist > 20 ? 22 : 8);
      st.vel.y += ((wantY - st.pos.y) * 1.1 - st.vel.y) * Math.min(1, dt * 1.8);
      st.pitch += (0.18 - st.pitch) * Math.min(1, dt * 3);
    } else {
      st.vel.x += (0 - st.vel.x) * Math.min(1, dt * 2);
      st.vel.z += (0 - st.vel.z) * Math.min(1, dt * 2);
      const wantY = t.y + 0.2;
      st.vel.y += ((wantY - st.pos.y) * 1.2 - st.vel.y) * Math.min(1, dt * 1.6);
      st.pitch += (0 - st.pitch) * Math.min(1, dt * 3);
      if (dist < 3 && Math.abs(st.pos.y - wantY) < 1.2 && Math.hypot(st.vel.x, st.vel.z, st.vel.y) < 2) {
        st.mode = 'hover'; st.vel.set(0, 0, 0); st.pos.y = wantY; toast('直升机已降落，按 U 登机');
      }
    }
  }

  function fly(dt, keys, mv, P) {
    const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + (-(mv && mv.y || 0));
    const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (mv && mv.x || 0);
    const up = (keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0);
    const run = keys.ShiftLeft || keys.ShiftRight;
    const sp = run ? 42 : 22;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    let ix = fx * f + rx * s, iz = fz * f + rz * s; const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
    st.vel.x += (ix * sp - st.vel.x) * Math.min(1, dt * 1.6);
    st.vel.z += (iz * sp - st.vel.z) * Math.min(1, dt * 1.6);
    st.vel.y += (up * (run ? 16 : 9) - st.vel.y * 0.45) * Math.min(1, dt * 2.2);
    // 无输入时轻微下沉（不像飞行模式那样停在空中一动不动）
    if (!up) st.vel.y -= 1.6 * dt;
    st.yaw = P.yaw;
    const wantP = clamp(-f * 0.22, -0.3, 0.3), wantR = clamp(s * 0.22, -0.3, 0.3);
    st.pitch += (wantP - st.pitch) * Math.min(1, dt * 4);
    st.roll += (wantR - st.roll) * Math.min(1, dt * 4);
  }

  function integrate(dt) {
    const nx = clamp(st.pos.x + st.vel.x * dt, 6, WORLD_M - 6);
    const ny = Math.max(groundTop(st.pos.x, st.pos.z, st.pos.y + 4) + 0.12, Math.min(140, st.pos.y + st.vel.y * dt));
    const nz = clamp(st.pos.z + st.vel.z * dt, 6, WORLD_M - 6);
    if (blocked(nx, ny, nz)) {
      // 轴向分离
      if (!blocked(nx, st.pos.y, st.pos.z)) st.pos.x = nx; else st.vel.x *= -0.25;
      if (!blocked(st.pos.x, ny, st.pos.z)) st.pos.y = ny; else { st.vel.y = Math.abs(st.vel.y) > 6 ? st.vel.y * -0.2 : 0; if (st.vel.y === 0) st.pos.y = Math.max(st.pos.y, groundTop(st.pos.x, st.pos.z, st.pos.y + 4) + 0.12); }
      if (!blocked(st.pos.x, st.pos.y, nz)) st.pos.z = nz; else st.vel.z *= -0.25;
      if (Math.hypot(st.vel.x, st.vel.y, st.vel.z) > 8) sfx('bump');
    } else { st.pos.set(nx, ny, nz); }
    // 落地
    const g = groundTop(st.pos.x, st.pos.z, st.pos.y + 4);
    if (st.pos.y < g + 0.12) { st.pos.y = g + 0.12; if (st.vel.y < 0) st.vel.y = 0; }
    st.rotor += dt * (14 + Math.hypot(st.vel.x, st.vel.z, st.vel.y) * 0.15);
    place();
  }

  function update(dt, { keys, mv, P, S }) {
    if (!st.alive) { heliSet(false); return; }
    if (st.occupied) fly(dt, keys, mv, P);
    else if (st.mode === 'approach') autoPilot(dt);
    else {
      // 悬停：慢慢把水平速度刹住，保持离地
      st.vel.x *= Math.max(0, 1 - 2 * dt); st.vel.z *= Math.max(0, 1 - 2 * dt);
      const g = groundTop(st.pos.x, st.pos.z, st.pos.y + 4) + 0.12;
      st.vel.y += ((g - st.pos.y) * 1.5 - st.vel.y) * Math.min(1, dt * 1.5);
      st.pitch += (0 - st.pitch) * Math.min(1, dt * 3);
      st.roll += (0 - st.roll) * Math.min(1, dt * 3);
    }
    integrate(dt);
    if (st.occupied) { P.pos.copy(st.pos); P.vel.copy(st.vel); heliSet(true, 0.4 + Math.hypot(st.vel.x, st.vel.z, st.vel.y) / 50); }
    else heliSet(true, st.mode === 'approach' ? 0.55 : 0.25);
  }

  return { st, callOrEnter, enter, exit, update, hide, findPad };
}
