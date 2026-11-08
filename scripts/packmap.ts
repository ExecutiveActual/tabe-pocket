// Packs a hand-editable map (data/maps/<name>.txt + .meta.json) into the compact form shipped in the build:
//   npx tsx scripts/packmap.ts [name]       (default tabe_big) -> data/<name>.packed.json
// Format: terrain ids run-length encoded, one run = byte (id << 4 | min(len, 15)); if len >= 15 the extra
// length (len - 15) follows as an unsigned LEB128 varint. The byte stream is base64. Decoder: src/sim/mapdata.ts.
import { readFileSync, writeFileSync } from 'fs';
import { MAP_CHARS } from '../src/sim/core';
import { packTiles, unpackTiles } from '../src/sim/mapdata';
const name = process.argv[2] || 'tabe_big';
const rows = readFileSync(`data/maps/${name}.txt`, 'utf8').split('\n').filter((r) => r.length);
const meta = JSON.parse(readFileSync(`data/maps/${name}.meta.json`, 'utf8'));
const n = rows.length; if (rows.some((r) => r.length !== n)) throw new Error('map must be square: every row ' + n + ' chars');
const ids = new Uint8Array(n * n);
rows.forEach((r, y) => { for (let x = 0; x < n; x++) { const v = MAP_CHARS[r[x]]; if (v === undefined) throw new Error(`unknown map char '${r[x]}' at ${x},${y}`); ids[y * n + x] = v; } });
const b64 = packTiles(ids);
const back = unpackTiles(b64, n * n); for (let i = 0; i < n * n; i++) if (back[i] !== ids[i]) throw new Error('round trip failed at ' + i);
writeFileSync(`data/${name}.packed.json`, JSON.stringify({ name: meta.name, n, tileM: meta.tileM, landing: meta.landing, rookeries: meta.rookeries, nests: meta.nests || [], tiles: b64 }) + '\n');
console.log(`data/${name}.packed.json: ${n}x${n}, ${(b64.length / 1024).toFixed(0)} KB base64`);
