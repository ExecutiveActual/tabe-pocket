// Authoring aid: wrote the first draft of data/pocket_v1.json, the small v1 map (beach landing, grass, jungle,
// a stream, a pond, cliffs closing the east side). The JSON is the source of truth; edit its rows by hand.
// Legend as in data/tabe.json: ~ sea . beach , grass J jungle ^ cliffs p pond s stream h hills
import { writeFileSync } from 'fs';
const N = 160;
function hash(x: number, y: number, s: number): number { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn(x: number, y: number, sc: number, s: number): number { const fx = x / sc, fy = y / sc, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; }
const S = 4;
const g: string[][] = [];
for (let y = 0; y < N; y++) {
  const row: string[] = [];
  for (let x = 0; x < N; x++) {
    const coastW = 10 + vn(0, y, 30, S) * 22 + vn(0, y, 9, S + 9) * 5;                       // west coast
    const coastN = 4 + vn(x, 0, 28, S + 1) * 20 - (x > N * 0.8 ? 6 : 0), coastS = N - 5 - vn(x, 0, 28, S + 2) * 20 + (x > N * 0.8 ? 4 : 0);
    const edge = Math.min(x - coastW, y - coastN, coastS - y);
    let t = ',';
    if (edge < 0) t = '~'; else if (edge < 6 + vn(x, y, 6, S + 3) * 3) t = '.';
    else {
      const jungle = vn(x, y, 26, S + 4) * 0.8 + vn(x, y, 8, S + 8) * 0.2 + (y / N) * 0.45 + (x / N) * 0.15 - 0.05;
      if (jungle > 0.78) t = 'J';
      if (x > N - 22 - vn(0, y, 12, S + 5) * 8) t = 'h';
      if (x > N - 10 - vn(0, y, 10, S + 6) * 6) t = '^';
      if (t === ',' && vn(x, y, 7, S + 7) > 0.93) t = '^';
    }
    row.push(t);
  }
  g.push(row);
}
// stream: from the eastern hills down to the beach, meandering
let sx = N - 14, sy = 52; let mouth: [number, number] = [0, 0];
for (let k = 0; k < 400; k++) {
  if (g[sy][sx] === '~') { mouth = [sx + 1, sy]; break; }
  if (g[sy][sx] !== '^') { g[sy][sx] = 's'; if (g[sy + 1][sx] !== '~') g[sy + 1][sx] = 's'; }
  sx -= 1; sy += Math.round((vn(k, 0, 14, S + 10) - 0.5) * 2.2);
  sy = Math.max(30, Math.min(90, sy));
}
// pond in the jungle
const [px, py, pr] = [96, 112, 5];
for (let y = -pr; y <= pr; y++) for (let x = -pr; x <= pr; x++) if (x * x + y * y <= pr * pr) g[py + y][px + x] = 'p';
// landing: beach tile next to the sea a little south of the stream mouth
let landing: [number, number] = [0, 0];
for (let y = mouth[1] + 8; y < N; y++) { const r = g[y]; const x = r.findIndex((c) => c === '.'); if (x > 0 && r[x - 1] === '~') { landing = [x, y]; break; } }
const out = { name: 'Pocket v1: the landing coast', tileM: 2, legend: { '~': 'sea', '.': 'beach', ',': 'grass', J: 'jungle', o: 'outback', m: 'mangrove', h: 'hills', '^': 'cliffs', p: 'pond', s: 'stream' }, landing, rookeries: [] as number[][], rows: g.map((r) => r.join('')) };
writeFileSync('data/pocket_v1.json', JSON.stringify(out).replace('"rows":[', '"rows":[\n').replace(/","/g, '",\n"'));
const cnt: Record<string, number> = {}; for (const r of g) for (const c of r) cnt[c] = (cnt[c] || 0) + 1;
console.log('landing', landing, 'mouth', mouth, cnt);
