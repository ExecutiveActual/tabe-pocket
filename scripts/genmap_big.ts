// Authoring aid: generates the FIRST DRAFT of the big fixed island (v1.1). Run once, offline:
//   npx tsx scripts/genmap_big.ts          -> data/maps/tabe_big.txt (one row of legend chars per line) + .meta.json
//   npx tsx scripts/packmap.ts             -> data/tabe_big.packed.json (compact, shipped in the build)
// After the first run the .txt is the source of truth: designers edit it by hand and re-pack. Re-running this
// script overwrites hand edits, so don't (unless starting over).
// Legend: ~ sea . beach , grass J jungle o outback m mangrove h hills ^ cliffs/rock p pond s stream
import { writeFileSync, mkdirSync } from 'fs';
const N = 768, SEED = 2611;   // 768 x 768 tiles at 2 m = 1.5 km a side (the v1 map was 160 x 160)
function hash(x: number, y: number, s: number): number { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn(x: number, y: number, sc: number, s: number): number {
  const fx = x / sc, fy = y / sc, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x: number, y: number, s: number): number => vn(x, y, 150, s) * 0.5 + vn(x, y, 60, s + 1) * 0.3 + vn(x, y, 20, s + 2) * 0.2;
const g: string[][] = []; const elev = new Float64Array(N * N);
// the landing coast sits on the west side, a little south of the middle (like the v1 map)
const LY = Math.round(N * 0.56);
for (let y = 0; y < N; y++) {
  const row: string[] = [];
  for (let x = 0; x < N; x++) {
    const u = (x - N * 0.52) / (N * 0.47), v = (y - N * 0.5) / (N * 0.47);
    const d = Math.sqrt(u * u + v * v);
    // a long north-south ridge east of centre carries the hills and cliffs
    const rx = N * (0.62 + 0.06 * (y / N)) + (vn(0, y, 80, SEED + 3) - 0.5) * 60;
    const ridge = Math.max(0, 1 - Math.abs(x - rx) / (N * 0.13));
    let e = fbm(x, y, SEED) * 0.6 + Math.min(1 - d, 0.35) * 0.9 - 0.42 + ridge * ridge * 0.3;
    // keep the west coast near the landing gentle and low
    const nearL = Math.max(0, 1 - Math.sqrt((x - 40) * (x - 40) + (y - LY) * (y - LY)) / 160);
    e -= nearL * Math.max(0, e - 0.2) * 0.8;
    elev[y * N + x] = e;
    const wet = vn(x, y, 110, SEED + 7) * 0.45 + (x / N) * 0.35 + (y / N) * 0.35;   // the south-east is wet
    let t = '~';
    if (e > 0) t = '.';
    if (e > 0.03) t = wet > 0.58 ? 'J' : ',';
    if (e > 0.1 && wet < 0.56) t = 'o';                    // dry outback in the interior
    if (e > 0.27) t = 'h';
    if (e > 0.33 && vn(x, y, 14, SEED + 9) > 0.55) t = '^';
    if (e > 0 && e < 0.07 && wet > 0.7) t = 'm';           // mangroves on the wet south-east shore
    if (t === ',' && vn(x, y, 22, SEED + 11) > 0.7) t = 'J';
    if (t === 'J' && vn(x, y, 34, SEED + 14) > 0.7) t = ',';   // grassy clearings in the big jungle
    if ((t === ',' || t === 'o') && vn(x, y, 7, SEED + 12) > 0.94) t = '^';   // scattered rock outcrops
    row.push(t);
  }
  g.push(row);
}
const at = (x: number, y: number): string => (x >= 0 && y >= 0 && x < N && y < N ? g[y][x] : '~');
// landing: the west-coast beach tile next to the sea closest to row LY
let landing: [number, number] = [0, 0];
for (let dy = 0; dy < 80 && !landing[0]; dy++) for (const yy of [LY + dy, LY - dy]) { for (let x = 1; x < N / 3; x++) { if (at(x, yy) === '.' && at(x - 1, yy) === '~' && at(x, yy - 1) !== '~' && at(x, yy + 1) !== '~' && at(x - 1, yy - 1) === '~' && at(x - 1, yy + 1) === '~') { landing = [x, yy]; break; } if (at(x, yy) !== '~' && at(x, yy) !== '.') break; } if (landing[0]) break; }
const [lx, ly] = landing;
// the landing coast, authored like the v1 map: open grass north of the landing, jungle to the south and east,
// no cliffs within reach of camp, a stream reaching the sea a little north of the landing, a jungle pond
for (let y = ly - 110; y <= ly + 110; y++) for (let x = lx; x <= lx + 150; x++) {
  const t = at(x, y); if (t === '~' || t === '.' || y < 0 || y >= N || x >= N) continue;
  const r = Math.sqrt((x - lx) * (x - lx) + (y - ly) * (y - ly)); if (r > 80 + vn(x, y, 14, SEED + 13) * 50) continue;   // ragged edge
  const jungle = vn(x, y, 26, SEED + 4) * 0.8 + vn(x, y, 8, SEED + 8) * 0.2 + ((y - ly + 56) / 160) * 0.45 + ((x - lx) / 160) * 0.15 - 0.05;
  let nt = jungle > 0.76 ? 'J' : ',';
  if (nt === ',' && vn(x, y, 7, SEED + 7) > 0.95 && r > 25) nt = '^';
  g[y][x] = nt;
}
// streams: the landing stream first, then sources in the hills running downhill to the sea
function carve(path: [number, number][]): void { for (const [px, py] of path) if (g[py][px] !== '~') { g[py][px] = 's'; if (py + 1 < N && g[py + 1][px] !== '~' && g[py + 1][px] !== '^') g[py + 1][px] = 's'; } }
{
  // meander from inland (east) to the coast, reaching the sea ~8 tiles north of the landing
  let x = lx + 135, y = ly - 8 + Math.round((vn(0, 0, 9, SEED) - 0.5) * 30); const path: [number, number][] = [];
  for (let k = 0; k < 600; k++) {
    path.push([x, y]); if (at(x, y) === '~') break;
    x -= 1; const target = ly - 8 + (x - lx) * 0.25; y += Math.round((vn(k, 0, 14, SEED + 10) - 0.5) * 2.2 + (target - y) * 0.06);
  }
  carve(path);
}
let streams = 1;
for (let k = 0; k < 6000 && streams < 14; k++) {
  let x = Math.floor(hash(k, 1, SEED) * N), y = Math.floor(hash(k, 2, SEED) * N);
  if (at(x, y) !== 'h' || Math.hypot(x - lx, y - ly) < 180) continue;
  const path: [number, number][] = [];
  for (let st = 0; st < 1200; st++) {
    path.push([x, y]); if (at(x, y) === '~') break;
    let bx = x, by = y, be = 1e9;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const ee = elev[yy * N + xx] + hash(xx, yy, SEED + st) * 0.01; if (ee < be) { be = ee; bx = xx; by = yy; } }
    if (bx === x && by === y) break; x = bx; y = by;
  }
  if (path.length < 50 || at(x, y) !== '~') continue;
  carve(path); streams++;
}
// ponds: the landing pond (like v1's, in the jungle south-east of the landing), then a scatter inland
function pond(x: number, y: number, r: number): void { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r && at(x + xx, y + yy) !== '~') g[y + yy][x + xx] = 'p'; }
const ponds: [number, number][] = [[lx + 68, ly + 56]]; pond(lx + 68, ly + 56, 5);
for (let k = 0; k < 20000 && ponds.length < 14; k++) {
  const x = Math.floor(hash(k, 5, SEED) * N), y = Math.floor(hash(k, 6, SEED) * N);
  if ([',', 'o', 'J'].indexOf(at(x, y)) < 0 || ponds.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) < 110)) continue;
  pond(x, y, 4 + Math.floor(hash(k, 7, SEED) * 4)); ponds.push([x, y]);
}
// rookeries: outback, hills, jungle edge and mangrove, all well away from the landing
const rook: [number, number][] = [];
for (const want of ['o', 'h', 'J', 'o', 'h', 'm']) for (let k = 0; k < 40000; k++) {
  const x = Math.floor(hash(k, 11 + rook.length, SEED) * N), y = Math.floor(hash(k, 12 + rook.length, SEED) * N);
  if (at(x, y) !== want) continue;
  let ok = true; for (let yy = -6; yy <= 6; yy++) for (let xx = -6; xx <= 6; xx++) if (at(x + xx, y + yy) === '~' || at(x + xx, y + yy) === '^') ok = false;
  if (!ok || Math.hypot(x - lx, y - ly) < 230 || rook.some(([a, b]) => Math.hypot(a - x, b - y) < 160)) continue;
  rook.push([x, y]); break;
}
mkdirSync('data/maps', { recursive: true });
writeFileSync('data/maps/tabe_big.txt', g.map((r) => r.join('')).join('\n') + '\n');
const meta = { name: 'Tabe (v1.1 big island)', tileM: 2, legend: { '~': 'sea', '.': 'beach', ',': 'grass', J: 'jungle', o: 'outback', m: 'mangrove', h: 'hills', '^': 'cliffs', p: 'pond', s: 'stream' }, landing, rookeries: rook };
writeFileSync('data/maps/tabe_big.meta.json', JSON.stringify(meta, null, 1) + '\n');
const cnt: Record<string, number> = {}; for (const r of g) for (const c of r) cnt[c] = (cnt[c] || 0) + 1;
console.log('landing', landing, 'rookeries', rook, 'streams', streams, 'ponds', ponds.length, cnt);
