// Compact tile encodings shared by the map packer, the sim (map load, saves) and the viewer.
// Pure functions, no DOM, no Node: base64 is done by hand so it runs the same everywhere.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV: Record<string, number> = {}; for (let i = 0; i < 64; i++) B64_INV[B64[i]] = i;
export function bytesToB64(b: ArrayLike<number>): string {
  let s = ''; let i = 0;
  for (; i + 2 < b.length; i += 3) { const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]; s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63]; }
  if (i < b.length) { const v = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8); s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + (i + 1 < b.length ? B64[(v >> 6) & 63] : '=') + '='; }
  return s;
}
export function b64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, ''); const out = new Uint8Array(Math.floor((clean.length * 3) / 4)); let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (B64_INV[clean[i]] << 18) | (B64_INV[clean[i + 1]] << 12) | ((B64_INV[clean[i + 2]] || 0) << 6) | (B64_INV[clean[i + 3]] || 0);
    out[o++] = (v >> 16) & 255; if (i + 2 < clean.length) out[o++] = (v >> 8) & 255; if (i + 3 < clean.length) out[o++] = v & 255;
  }
  return out.subarray(0, o);
}
/** Run-length encode small values (0..15): byte = v << 4 | min(len, 15), then LEB128 (len - 15) if len >= 15. */
export function packTiles(t: ArrayLike<number>): string {
  const out: number[] = [];
  for (let i = 0; i < t.length;) {
    const v = t[i]; let j = i + 1; while (j < t.length && t[j] === v) j++;
    const len = j - i; out.push((v << 4) | Math.min(len, 15));
    if (len >= 15) { let r = len - 15; do { let b = r & 127; r >>>= 7; if (r) b |= 128; out.push(b); } while (r); }
    i = j;
  }
  return bytesToB64(out);
}
export function unpackTiles(s: string, count: number): Uint8Array {
  const b = b64ToBytes(s); const out = new Uint8Array(count); let o = 0;
  for (let i = 0; i < b.length && o < count;) {
    const v = b[i] >> 4; let len = b[i] & 15; i++;
    if (len === 15) { let r = 0, sh = 0, c: number; do { c = b[i++]; r |= (c & 127) << sh; sh += 7; } while (c & 128); len += r; }
    out.fill(v, o, Math.min(count, o + len)); o += len;
  }
  return out;
}
