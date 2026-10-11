// Builds public/data/streams.json: for each major meteor shower, a random sample of
// real meteoroid orbits measured by the Global Meteor Network in 2025 (CC BY 4.0).
// The app spreads particles along these orbits to draw each stream.
// Usage: node scripts/streams.mjs  (needs scripts/.cache/gmn-2025.txt, ~900 MB, from
// https://globalmeteornetwork.org/data/traj_summary_data/traj_summary_yearly_2025.txt)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'scripts/.cache/gmn-2025.txt');
const PER_SHOWER = 500;
const CODES = ['QUA', 'LYR', 'ETA', 'SDA', 'CAP', 'PER', 'DRA', 'STA', 'ORI', 'NTA', 'LEO', 'GEM', 'URS', 'SPE', 'MON', 'HYD'];

// Reservoir sampling, so the sample is uniform over the whole year.
const pools = Object.fromEntries(CODES.map((c) => [c, { seen: 0, rows: [] }]));
let seed = 20251;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const rl = readline.createInterface({ input: fs.createReadStream(src, 'utf8'), crlfDelay: Infinity });
let lines = 0;
for await (const l of rl) {
  if (!l || l[0] === '#') continue;
  lines++;
  const f = l.split(';');
  if (f.length < 86) continue;
  const code = f[4].trim();
  const pool = pools[code];
  if (!pool) continue;
  const e = +f[25], i = +f[27], peri = +f[29], node = +f[31], q = +f[37];
  if (![e, i, peri, node, q].every(Number.isFinite) || e >= 0.995 || q <= 0) continue;
  const row = [+q.toFixed(5), +e.toFixed(5), +i.toFixed(3), +node.toFixed(4), +peri.toFixed(4)];
  pool.seen++;
  if (pool.rows.length < PER_SHOWER) pool.rows.push(row);
  else {
    const k = Math.floor(rand() * pool.seen);
    if (k < PER_SHOWER) pool.rows[k] = row;
  }
}

const out = { source: 'Global Meteor Network, 2025 trajectories (CC BY 4.0)', year: 2025, showers: {} };
for (const c of CODES) {
  out.showers[c] = { count2025: pools[c].seen, orbits: pools[c].rows };
  console.log(c, pools[c].seen, pools[c].rows.length);
}
const dst = path.join(root, 'public/data/streams.json');
fs.writeFileSync(dst, JSON.stringify(out));
console.log(`${lines} meteors read; wrote ${path.relative(root, dst)} (${fs.statSync(dst).size} bytes)`);
