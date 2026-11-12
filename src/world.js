// 世界数据：OSM 要素 → 体素网格（1.5 m 体素）
export const VS = 1.5;          // 体素边长(米)
export const CH = 16;           // 分块边长(体素)
export const T = { AIR: 0, BASE: 1, GRASS: 2, ASPH: 3, PAVE: 4, WATER: 5, SIDEW: 6, MARK: 7, LEAF: 8, WOOD: 9, GLASS: 10, ROOF: 11, SLAB: 12,
  PARAPET: 13, PITCH: 14, DIRT: 15, WALL0: 16, GLASS2: 27, LEAF2: 28, LEAF3: 29, CAR: 30 };
export const PAL = (() => {
  const p = new Array(32).fill(0).map(() => [1, 0, 1]);
  const s = (i, r, g, b) => (p[i] = [r, g, b]);
  s(1, .30, .24, .20); s(2, .38, .62, .27); s(3, .30, .31, .34); s(4, .64, .62, .58); s(5, .20, .46, .72); s(6, .78, .76, .71); s(7, .96, .92, .78);
  s(8, .22, .50, .22); s(9, .40, .28, .16); s(10, .27, .44, .60); s(11, .48, .48, .50); s(12, .60, .60, .58); s(13, .72, .72, .72);
  s(14, .27, .56, .42); s(15, .55, .45, .30);
  s(16, .91, .88, .78); s(17, .82, .72, .58); s(18, .78, .80, .82); s(19, .78, .60, .55); s(20, .50, .60, .70); s(21, .55, .58, .62);
  s(22, .93, .93, .95); s(23, .65, .38, .30); s(24, .24, .31, .40); s(25, .80, .52, .36); s(26, .62, .66, .50);
  s(27, .16, .27, .33); s(28, .80, .66, .22); s(29, .36, .56, .20); s(30, .8, .1, .1);
  return p;
})();
const WALLSETS = { 1: [16, 17, 18, 19, 22, 25], 2: [23, 19, 25, 17], 3: [20, 21, 24, 18, 22, 21], 4: [22, 18, 22], 5: [25, 23, 17, 16],
  6: [18, 17, 21, 20], 7: [21, 18, 20], 9: [18, 21, 17], 0: [16, 17, 18, 20, 21, 22, 19] };

export class World {
  constructor(n, sy) {
    this.sx = n; this.sz = n; this.sy = sy;
    this.d = new Uint8Array(n * n * sy);
    this.colMax = new Uint8Array(n * n);       // 每列最高体素+1 (上界)
    this.nameId = new Uint16Array(n * n);      // 道路名索引(+1)
    this.names = []; this.pois = []; this.spawns = []; this.stats = {};
  }
  idx(x, y, z) { return (x * this.sz + z) * this.sy + y; }
  get(x, y, z) {
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y >= this.sy) return 0;
    if (y < 0) return 1;
    return this.d[(x * this.sz + z) * this.sy + y];
  }
  set(x, y, z, t) { if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y < 0 || y >= this.sy) return; this.d[(x * this.sz + z) * this.sy + y] = t; if (t && y >= this.colMax[x * this.sz + z]) this.colMax[x * this.sz + z] = y + 1; }
  solid(x, y, z) { return this.get(x, y, z) !== 0; }
  // 地表高度(米)：该列最高实心体素的顶面
  topY(x, z) { if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return 2 * VS; let y = Math.min(this.sy - 1, this.colMax[x * this.sz + z]); const b = (x * this.sz + z) * this.sy; while (y > 0 && !this.d[b + y]) y--; return (y + 1) * VS; }
}

function hash2(i, j, s = 0) { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

export function generate(area) {
  const HALF = area.half, N = Math.round(HALF * 2 / VS);
  let maxH = 6; for (const b of area.b) maxH = Math.max(maxH, Math.round(b[0] / 10 / VS));
  const SY = Math.min(100, 2 + maxH + 4);
  const W = new World(N, SY);
  const G = f => { const o = new Float32Array(f.length); for (let i = 0; i < f.length; i++) o[i] = (f[i] / 10 + HALF) / VS; return o; };
  const gt = new Uint8Array(N * N).fill(T.PAVE);     // 地表类型
  const water = new Uint8Array(N * N);
  const td = new Uint8Array(N * N);                  // 植树密度类别 1林 2公园 3小区 4行道树
  const bh = new Uint8Array(N * N), bidm = new Int16Array(N * N).fill(-1);

  function fillPoly(rings, cb) {
    let mn = 1e9, mx = -1e9;
    for (const r of rings) for (let i = 1; i < r.length; i += 2) { if (r[i] < mn) mn = r[i]; if (r[i] > mx) mx = r[i]; }
    const j0 = Math.max(0, Math.floor(mn)), j1 = Math.min(N - 1, Math.ceil(mx)), xs = [];
    for (let j = j0; j <= j1; j++) {
      const zc = j + 0.5; xs.length = 0;
      for (const r of rings) { const n = r.length / 2; for (let a = 0; a < n; a++) { const b = (a + 1) % n, z1 = r[2 * a + 1], z2 = r[2 * b + 1];
        if ((z1 <= zc && z2 > zc) || (z2 <= zc && z1 > zc)) xs.push(r[2 * a] + (zc - z1) / (z2 - z1) * (r[2 * b] - r[2 * a])); } }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(N - 1, Math.floor(xs[k + 1] - 0.5)); for (let i = i0; i <= i1; i++) cb(i * N + j, i, j); }
    }
  }
  function stamp(p, r, cb) {
    let cum = 0;
    for (let s = 0; s + 3 < p.length; s += 2) {
      const ax = p[s], az = p[s + 1], bx = p[s + 2], bz = p[s + 3], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
      if (L2 > 0) {
        const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), i1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + r));
        const j0 = Math.max(0, Math.floor(Math.min(az, bz) - r)), j1 = Math.min(N - 1, Math.ceil(Math.max(az, bz) + r));
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const px = i + .5, pz = j + .5; let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + t * dx - px, qz = az + t * dz - pz, d = Math.sqrt(qx * qx + qz * qz);
          if (d <= r) cb(i * N + j, d, cum + t * L);
        }
      }
      cum += L;
    }
  }
  // 1. 土地利用（先大块，再小块）
  const GK = { 1: [T.GRASS, 2], 2: [T.GRASS, 1], 3: [T.PITCH, 0], 4: [T.DIRT, 0], 5: [T.ASPH, 0], 6: [T.GRASS, 3], 7: [T.PAVE, 0] };
  const order = [6, 7, 5, 4, 1, 2, 3];
  for (const k of order) for (const g of area.g) if (g[0] === k) fillPoly([G(g[1])], ci => { gt[ci] = GK[k][0]; td[ci] = GK[k][1]; water[ci] = 0; });
  // 2. 水
  for (const wp of area.w) fillPoly(wp.map(G), ci => { water[ci] = 1; td[ci] = 0; });
  for (const wl of area.wl) stamp(G(wl[1]), Math.max(0.7, wl[0] / 10 / 2 / VS), ci => { water[ci] = 1; td[ci] = 0; });
  // 3. 道路
  const roads = area.r.map((r, i) => ({ cls: r[0], w: r[1] / 10, bridge: r[2], name: r[3], p: G(r[4]), i })).sort((a, b) => b.cls - a.cls);
  const nameIdx = new Map();
  const nid = n => { if (!n) return 0; if (!nameIdx.has(n)) { W.names.push(n); nameIdx.set(n, W.names.length); } return nameIdx.get(n); };
  for (const r of roads) if (r.cls >= 1 && r.cls <= 4) { const rr = r.w / 2 / VS, sw = rr + 1.1;
    stamp(r.p, sw, (ci, d) => { if (!water[ci] || r.bridge) { gt[ci] = T.SIDEW; td[ci] = d > rr + 0.4 ? 4 : td[ci]; } }); }
  for (const r of roads) if (r.cls >= 6) stamp(r.p, Math.max(0.6, r.w / 2 / VS), (ci) => { if (!water[ci]) { gt[ci] = T.SIDEW; td[ci] = 0; } });
  const marks = [];
  for (const r of roads) if (r.cls <= 5) { const rr = Math.max(0.8, r.w / 2 / VS), nm = nid(r.name);
    stamp(r.p, rr, (ci) => { gt[ci] = T.ASPH; water[ci] = 0; td[ci] = 0; if (nm) W.nameId[ci] = nm; }); if (r.cls <= 3) marks.push(r); }
  for (const r of marks) stamp(r.p, 0.62, (ci, d, along) => { if (r.w >= 9 && ((along * VS) % 10) < 6) gt[ci] = T.MARK; });
  // 4. 建筑
  const bl = area.b.map((b, i) => ({ h: Math.max(2, Math.round(b[0] / 10 / VS)), code: b[1], est: b[2], name: b[3], rings: b[4].map(G), i })).sort((a, b) => a.h - b.h);
  bl.forEach((b, k) => { b.h = Math.min(b.h, SY - 5); fillPoly(b.rings, (ci) => { if (b.h >= bh[ci]) { bh[ci] = b.h; bidm[ci] = k; td[ci] = 0; } });
    if (b.name) { let sx = 0, sz = 0, n = b.rings[0].length / 2; for (let i = 0; i < n; i++) { sx += b.rings[0][2 * i]; sz += b.rings[0][2 * i + 1]; } W.pois.push({ name: b.name, x: sx / n * VS, z: sz / n * VS, h: b.h * VS }); } });
  if (area.lm) for (const L of area.lm) W.pois.push({ name: L[0], x: L[1] / 10 + HALF, z: L[2] / 10 + HALF, h: 30, landmark: true });
  // 5. 体素化
  const n = N, sy = SY, D = W.d;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const ci = i * n + j, base = ci * sy;
    if (water[ci] && !bh[ci]) { D[base] = T.WATER; W.colMax[ci] = 1; } else { D[base] = T.BASE; D[base + 1] = gt[ci]; W.colMax[ci] = 2; }
  }
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const ci = i * n + j, H = bh[ci]; if (!H) continue;
    const b = bl[bidm[ci]];
    let edge = false;
    for (const [dx, dz] of nb) { const a = i + dx, c = j + dz; if (a < 0 || c < 0 || a >= n || c >= n || bh[a * n + c] < H) { edge = true; break; } }
    const hh = hash2(b.i, 7, 1), set = WALLSETS[b.code] || WALLSETS[0];
    const wall = T.WALL0 + (set[Math.floor(hash2(b.i, 3, 5) * set.length)] - 16);
    const glass = hash2(b.i, 9, 2) < 0.45 ? T.GLASS2 : T.GLASS;
    const base = ci * sy;
    for (let y = 2; y < 2 + H; y++) {
      const rr = (y - 2) % 3, fl = ((y - 2) / 3) | 0; let t = 0;
      if (y === 1 + H) t = T.ROOF;
      else if (edge) t = rr === 2 ? wall : (fl === 0 && rr === 0 && H >= 6) ? wall : (H < 4 ? wall : glass);
      else t = rr === 2 ? T.SLAB : 0;
      if (t) D[base + y] = t;
    }
    if (edge && H >= 4) D[base + 2 + H] = T.PARAPET;
    W.colMax[ci] = 2 + H + (edge && H >= 4 ? 1 : 0);
    D[base + 1] = T.PAVE; if (!D[base]) D[base] = T.BASE;
  }
  // 6. 树
  const trees = [];
  const plant = (i, j) => {
    const ci = i * n + j; if (bh[ci]) return;
    const r = hash2(i, j, 11), th = 2 + (r > .5 ? 1 : 0), lt = hash2(i, j, 12), leaf = lt < .22 ? T.LEAF2 : lt < .5 ? T.LEAF3 : T.LEAF, rad = 1.9 + r * 0.9;
    const base = ci * sy; for (let y = 2; y < 2 + th; y++) if (!D[base + y]) D[base + y] = T.WOOD;
    const cy = 2 + th + 0.5;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -2; dy <= 3; dy++) {
      if (dx * dx + dz * dz + dy * dy * 1.5 > rad * rad + 0.3) continue;
      const a = i + dx, c = j + dz, y = Math.round(cy + dy); if (a < 0 || c < 0 || a >= n || c >= n || y < 2 || y >= sy) continue;
      const k = (a * n + c) * sy + y; if (!D[k]) { D[k] = leaf; if (y >= W.colMax[a * n + c]) W.colMax[a * n + c] = y + 1; }
    }
    trees.push([i, j]);
  };
  for (let k = 0; k < area.t.length; k += 2) { const i = Math.floor((area.t[k] / 10 + HALF) / VS), j = Math.floor((area.t[k + 1] / 10 + HALF) / VS); if (i >= 0 && j >= 0 && i < n && j < n) plant(i, j); }
  const P = { 1: 1 / 26, 2: 1 / 55, 3: 1 / 95, 4: 1 / 20 };
  for (let i = 2; i < n - 2; i++) for (let j = 2; j < n - 2; j++) { const ci = i * n + j, c = td[ci]; if (c && !water[ci] && !bh[ci] && hash2(i, j, 21) < P[c]) { if (c === 4 && hash2(i, j, 22) < 0.3) continue; plant(i, j); } }
  // 7. 出生点 / 车辆
  const sp = [];
  for (const r of marks.length ? marks : roads) { const p = r.p; for (let s = 0; s + 3 < p.length; s += 2) { const mx = (p[s] + p[s + 2]) / 2, mz = (p[s + 1] + p[s + 3]) / 2, L = Math.hypot(p[s + 2] - p[s], p[s + 3] - p[s + 1]);
    if (L > 12 && mx > 20 && mz > 20 && mx < n - 20 && mz < n - 20) sp.push({ x: mx * VS, z: mz * VS, yaw: Math.atan2(-(p[s + 2] - p[s]), -(p[s + 3] - p[s + 1])), cls: r.cls }); } }
  W.spawns = sp;
  // 小地图
  const mm = new Uint8ClampedArray(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const ci = i * n + j, o = (j * n + i) * 4; let t = 0, y = W.colMax[ci] - 1; while (y > 0 && !(t = D[ci * sy + y])) y--;
    let c = PAL[t] || PAL[4]; let k = 1; if (t >= 16 || t === T.ROOF || t === T.PARAPET || t === T.GLASS || t === T.GLASS2 || t === T.SLAB) { c = [.86, .62, .5]; k = 0.75 + Math.min(.3, y / 60); } if (t === T.LEAF || t === T.LEAF2 || t === T.LEAF3) { c = PAL[T.GRASS]; k = .8; }
    mm[o] = c[0] * 255 * k; mm[o + 1] = c[1] * 255 * k; mm[o + 2] = c[2] * 255 * k; mm[o + 3] = 255; }
  W.minimap = new ImageData(mm, n, n);
  W.stats = { buildings: bl.length, trees: trees.length, estimated: bl.filter(b => b.est).length, N, SY, voxels: n * n * sy };
  return W;
}
