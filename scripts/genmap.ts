// Authoring aid: generated the FIRST DRAFT of the fixed Tabe map (data/tabe.json). The JSON is the source of truth
// from here on: designers edit its rows by hand. Re-running this overwrites hand edits, so don't (unless starting over).
// Legend: ~ sea, . beach, , grass, J jungle, o outback (dry interior), m mangrove, h hills, ^ cliffs/rock, p pond, s stream
import { writeFileSync } from 'fs';
const N = 600, SEED = 1947;
function hash(x: number, y: number, s: number): number { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn(x: number, y: number, sc: number, s: number): number {
  const fx = x / sc, fy = y / sc, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x: number, y: number, s: number): number => vn(x, y, 120, s) * 0.5 + vn(x, y, 50, s + 1) * 0.3 + vn(x, y, 18, s + 2) * 0.2;
const g: string[][] = []; const elev: number[] = new Array(N * N);
for (let y = 0; y < N; y++) {
  const row: string[] = [];
  for (let x = 0; x < N; x++) {
    // a long island lying SW-NE
    const u = ((x - N / 2) * 0.8 + (y - N / 2) * 0.6) / (N * 0.6), v = ((x - N / 2) * -0.6 + (y - N / 2) * 0.8) / (N * 0.44);
    const d = Math.sqrt(u * u + v * v);
    const e = fbm(x, y, SEED) * 0.75 + (1 - d) * 0.85 - 0.62; elev[y * N + x] = e;
    const wet = vn(x, y, 90, SEED + 7) * 0.5 + (x / N) * 0.6 + (y / N) * 0.15;  // the east and south are wet
    let t = '~';
    if (e > 0) t = '.';
    if (e > 0.035) t = wet > 0.62 ? 'J' : ',';
    if (e > 0.12 && wet < 0.55) t = 'o';
    if (e > 0.12 && wet >= 0.55 && wet < 0.62) t = ',';
    if (e > 0.3) t = 'h';
    if (e > 0.36 && vn(x, y, 14, SEED + 9) > 0.62) t = '^';
    if (e > 0 && e < 0.06 && wet > 0.78 && y > N * 0.45) t = 'm';
    if (t === ',' && vn(x, y, 25, SEED + 11) > 0.72) t = 'J';
    row.push(t);
  }
  g.push(row);
}
// streams: from hill sources run downhill to the sea
const at = (x: number, y: number): string => (x >= 0 && y >= 0 && x < N && y < N ? g[y][x] : '~');
let streams = 0;
for (let k = 0; k < 4000 && streams < 16; k++) {
  let x = Math.floor(hash(k, 1, SEED) * N), y = Math.floor(hash(k, 2, SEED) * N);
  if (at(x, y) !== 'h') continue;
  const path: [number, number][] = [];
  for (let step = 0; step < 900; step++) {
    path.push([x, y]); if (at(x, y) === '~') break;
    let bx = x, by = y, be = 1e9;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const ee = elev[yy * N + xx] + hash(xx, yy, SEED + step) * 0.02; if (ee < be) { be = ee; bx = xx; by = yy; } }
    if (bx === x && by === y) break; x = bx; y = by;
  }
  if (path.length < 40 || at(x, y) !== '~') continue;
  for (const [px, py] of path) if (g[py][px] !== '~') { g[py][px] = 's'; if (px + 1 < N && g[py][px + 1] !== '~' && g[py][px + 1] !== '^') g[py][px + 1] = 's'; }
  streams++;
}
// ponds in low dry or grassy ground
const ponds: [number, number][] = [];
for (let k = 0; k < 6000 && ponds.length < 7; k++) {
  const x = Math.floor(hash(k, 5, SEED) * N), y = Math.floor(hash(k, 6, SEED) * N);
  if ([',', 'o', 'J'].indexOf(at(x, y)) < 0 || ponds.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) < 120)) continue;
  const r = 4 + Math.floor(hash(k, 7, SEED) * 4);
  for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r && at(x + xx, y + yy) !== '~') g[y + yy][x + xx] = 'p';
  ponds.push([x, y]);
}
// landing: a west/south-west beach close to a stream mouth
let landing: [number, number] = [0, 0], bs = -1e9;
for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) {
  if (g[y][x] !== '.' || ![at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].includes('~')) continue;
  let sd = 1e9; for (let yy = -40; yy <= 40; yy += 2) for (let xx = -40; xx <= 40; xx += 2) if (at(x + xx, y + yy) === 's') sd = Math.min(sd, Math.abs(xx) + Math.abs(yy));
  const sc = -x * 0.5 - Math.abs(y - N * 0.62) * 0.4 - sd * 2;
  if (sc > bs) { bs = sc; landing = [x, y]; }
}
// rookeries: in the outback, the hills and the jungle edge, far from the landing
const rook: [number, number][] = [];
for (const want of ['o', 'h', 'J', 'o']) for (let k = 0; k < 20000; k++) {
  const x = Math.floor(hash(k, 11 + rook.length, SEED) * N), y = Math.floor(hash(k, 12 + rook.length, SEED) * N);
  if (at(x, y) !== want) continue;
  if (Math.hypot(x - landing[0], y - landing[1]) < 160 || rook.some(([a, b]) => Math.hypot(a - x, b - y) < 140)) continue;
  rook.push([x, y]); break;
}
const out = { name: 'Tabe', tileM: 2, legend: { '~': 'sea', '.': 'beach', ',': 'grass', J: 'jungle', o: 'outback', m: 'mangrove', h: 'hills', '^': 'cliffs', p: 'pond', s: 'stream' }, landing, rookeries: rook, rows: g.map((r) => r.join('')) };
writeFileSync('data/tabe.json', JSON.stringify(out, null, 0).replace('"rows":[', '"rows":[\n').replace(/","/g, '",\n"'));
const cnt: Record<string, number> = {}; for (const r of g) for (const c of r) cnt[c] = (cnt[c] || 0) + 1;
console.log('landing', landing, 'rookeries', rook, 'streams', streams, 'ponds', ponds.length, cnt);
