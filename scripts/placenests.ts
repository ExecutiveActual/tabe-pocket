// Picks Roukha nest sites on the pre-baked island and writes them into data/maps/<name>.meta.json ("nests").
// Deterministic (no RNG): for each target bearing it takes the open tile closest to the wanted distance from the
// landing, away from water. Hand-edit the meta file afterwards if you want them elsewhere, then run map:pack.
//   npx tsx scripts/placenests.ts [name]
import { readFileSync, writeFileSync } from 'fs';
import { MAP_CHARS } from '../src/sim/core';
const name = process.argv[2] || 'tabe_big';
const rows = readFileSync(`data/maps/${name}.txt`, 'utf8').split('\n').filter((r) => r.length);
const metaPath = `data/maps/${name}.meta.json`; const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const n = rows.length; const t = (x: number, y: number): number => MAP_CHARS[rows[y][x]];
const [lx, ly] = meta.landing as number[];
const OPEN = new Set([2, 7, 9]);            // grass, outback, hills: Roukha like open ground
const WATER = new Set([0, 5, 6, 8]);        // sea, pond, stream, mangrove
const WANT = [155, 180];                   // PLACEHOLDER distance band from the landing, in tiles (x2 m)
const BEARINGS = [[1, -0.9], [1, -0.25], [1, 0.35], [0.6, 1]];   // north-east ... south-east of the landing (inland is east)
const nests: number[][] = [];
for (const [bx, by] of BEARINGS) {
  const bl = Math.hypot(bx, by); let best: number[] | null = null, bs = 1e9;
  for (let y = 4; y < n - 4; y++) for (let x = 4; x < n - 4; x++) {
    if (!OPEN.has(t(x, y))) continue;
    const dx = x - lx, dy = y - ly, d = Math.hypot(dx, dy);
    if (d < WANT[0] || d > WANT[1]) continue;
    const cos = (dx * bx + dy * by) / (d * bl); if (cos < 0.9) continue;
    let wet = 0, open = 0; for (let k = -6; k <= 6; k++) for (let j = -6; j <= 6; j++) { const v = t(x + j, y + k); if (WATER.has(v)) wet++; if (OPEN.has(v)) open++; }
    if (wet > 0) continue;
    if (nests.some(([nx, ny]) => Math.hypot(nx - x, ny - y) < 60)) continue;
    const s = (1 - cos) * 400 - open + Math.abs(d - (WANT[0] + WANT[1]) / 2) * 0.5;
    if (s < bs) { bs = s; best = [x, y]; }
  }
  if (best) nests.push(best);
}
meta.nests = nests; writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
console.log('nests', JSON.stringify(nests), nests.map(([x, y]) => Math.round(Math.hypot(x - lx, y - ly) * 2) + ' m'));
