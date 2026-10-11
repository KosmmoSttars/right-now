// Finds the asteroid under the cursor: propagates every loaded record to the current
// time (the same maths as the shader), projects it, and returns the nearest one
// within a few pixels, preferring larger bodies when several are close.
/// <reference lib="webworker" />

export type PickRequest =
  | { type: 'chunk'; data: Uint16Array; aRange: [number, number] }
  | {
      type: 'pick';
      id: number;
      dtDays: number;
      origin: [number, number, number];
      /** Column-major view-projection matrix for three coordinates. */
      viewProj: Float32Array;
      /** Cursor in pixels and viewport size. */
      x: number;
      y: number;
      width: number;
      height: number;
      radiusPx: number;
      mask: boolean[];
      hMax: number;
    };

export interface PickResponse {
  id: number;
  index: number | null;
}

const K = 0.01720209895;
const chunks: Uint16Array[] = [];
let lnMin = 0;
let lnSpan = 1;

function pick(req: Extract<PickRequest, { type: 'pick' }>): number | null {
  const m = req.viewProj;
  const r2max = req.radiusPx * req.radiusPx;
  let best: number | null = null;
  let bestScore = Infinity;
  let base = 0;
  for (const data of chunks) {
    const n = data.length / 8;
    for (let k = 0; k < n; k++) {
      const o = k * 8;
      const hc = data[o + 6];
      const cls = hc >> 8;
      const H = (hc & 255) / 7 - 2;
      if (!req.mask[cls] || H > req.hMax) continue;
      const a = Math.exp(lnMin + (data[o] / 65535) * lnSpan);
      const e = data[o + 1] / 65535;
      const inc = (data[o + 2] / 65535) * Math.PI;
      const node = (data[o + 3] / 65535) * 2 * Math.PI;
      const peri = (data[o + 4] / 65535) * 2 * Math.PI;
      let M = ((data[o + 5] + data[o + 7] / 65536) / 65536) * 2 * Math.PI + (K / (a * Math.sqrt(a))) * req.dtDays;
      M = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      let E = M + 0.85 * e * Math.sign(M || 1);
      for (let it = 0; it < 6; it++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const x = a * (Math.cos(E) - e);
      const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
      const cw = Math.cos(peri), sw = Math.sin(peri), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(inc), si = Math.sin(inc);
      const ex = x * (cw * cn - sw * sn * ci) + y * (-sw * cn - cw * sn * ci) - req.origin[0];
      const ey = x * (cw * sn + sw * cn * ci) + y * (-sw * sn + cw * cn * ci) - req.origin[1];
      const ez = x * (sw * si) + y * (cw * si) - req.origin[2];
      // three coords (x, z, −y), then clip space.
      const tx = ex, ty = ez, tz = -ey;
      const cw4 = m[3] * tx + m[7] * ty + m[11] * tz + m[15];
      if (cw4 <= 0) continue;
      const sx = ((m[0] * tx + m[4] * ty + m[8] * tz + m[12]) / cw4 * 0.5 + 0.5) * req.width;
      const sy = (0.5 - (m[1] * tx + m[5] * ty + m[9] * tz + m[13]) / cw4 * 0.5) * req.height;
      const d2 = (sx - req.x) ** 2 + (sy - req.y) ** 2;
      if (d2 > r2max) continue;
      // Distance in pixels, with a bonus for bright (large) bodies and rare classes.
      const score = Math.sqrt(d2) + H * 0.25 - (cls === 0 ? 0 : 1.5);
      if (score < bestScore) {
        bestScore = score;
        best = base + k;
      }
    }
    base += n;
  }
  return best;
}

self.onmessage = (ev: MessageEvent<PickRequest>) => {
  const msg = ev.data;
  if (msg.type === 'chunk') {
    chunks.push(msg.data);
    lnMin = Math.log(msg.aRange[0]);
    lnSpan = Math.log(msg.aRange[1]) - lnMin;
    return;
  }
  const res: PickResponse = { id: msg.id, index: pick(msg) };
  (self as unknown as Worker).postMessage(res);
};
