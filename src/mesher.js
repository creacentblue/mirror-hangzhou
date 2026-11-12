// 贪心网格化：每个 16×16 的分块 → 合并同类型相邻面，只生成露出空气的面
import { CH } from './world.js';
let maskBuf = new Int16Array(4096);
export function meshChunk(w, cx, cz) {
  const sx = w.sx, sz = w.sz, sy = w.sy, D = w.d;
  const x0 = cx * CH, z0 = cz * CH, off = [x0, 0, z0];
  let top = 0;
  for (let x = x0; x < Math.min(sx, x0 + CH); x++) for (let z = z0; z < Math.min(sz, z0 + CH); z++) { const m = w.colMax[x * sz + z]; if (m > top) top = m; }
  top = Math.min(sy, top + 1);
  const dims = [Math.min(CH, sx - x0), top, Math.min(CH, sz - z0)];
  const g = (x, y, z) => { if (x < 0 || z < 0 || x >= sx || z >= sz || y >= sy) return 0; if (y < 0) return 1; return D[(x * sz + z) * sy + y]; };
  const pos = [], typ = [], nrm = [], idx = [];
  const x = [0, 0, 0], q = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3, U = dims[u], V = dims[v];
    if (maskBuf.length < U * V) maskBuf = new Int16Array(U * V);
    const mask = maskBuf; q[0] = q[1] = q[2] = 0; q[d] = 1;
    for (x[d] = -1; x[d] < dims[d]; x[d]++) {
      let n = 0;
      for (x[v] = 0; x[v] < V; x[v]++) for (x[u] = 0; x[u] < U; x[u]++) {
        const a = g(off[0] + x[0], off[1] + x[1], off[2] + x[2]);
        const b = g(off[0] + x[0] + q[0], off[1] + x[1] + q[1], off[2] + x[2] + q[2]);
        const xd = x[d];
        mask[n++] = xd === -1 ? ((b !== 0 && a === 0) ? -b : 0) : xd === dims[d] - 1 ? ((a !== 0 && b === 0) ? a : 0) : ((a !== 0) === (b !== 0) ? 0 : a ? a : -b);
      }
      n = 0;
      for (let j = 0; j < V; j++) for (let i = 0; i < U;) {
        const c = mask[n];
        if (!c) { i++; n++; continue; }
        let wd = 1; while (i + wd < U && mask[n + wd] === c) wd++;
        let h = 1, done = false;
        for (; j + h < V; h++) { for (let k = 0; k < wd; k++) if (mask[n + k + h * U] !== c) { done = true; break; } if (done) break; }
        x[u] = i; x[v] = j; du[0] = du[1] = du[2] = 0; dv[0] = dv[1] = dv[2] = 0; du[u] = wd; dv[v] = h;
        const base = pos.length / 3, t = c > 0 ? c : -c, nid = d * 2 + (c > 0 ? 0 : 1);
        const px = x[0] + off[0] + q[0], py = x[1] + off[1] + q[1], pz = x[2] + off[2] + q[2];
        pos.push(px, py, pz, px + du[0], py + du[1], pz + du[2], px + du[0] + dv[0], py + du[1] + dv[1], pz + du[2] + dv[2], px + dv[0], py + dv[1], pz + dv[2]);
        typ.push(t, t, t, t); nrm.push(nid, nid, nid, nid);
        if (c > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        for (let l = 0; l < h; l++) for (let k = 0; k < wd; k++) mask[n + k + l * U] = 0;
        i += wd; n += wd;
      }
    }
  }
  return { pos: new Float32Array(pos), typ: new Uint8Array(typ), nrm: new Uint8Array(nrm), idx: new Uint32Array(idx) };
}
