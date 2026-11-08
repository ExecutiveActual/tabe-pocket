// Tabe Pocket viewer: runs the deterministic sim live in the browser and draws it with Canvas 2D.
// Phone-first: drag to pan, pinch to zoom, tap a scout for his panel. The sim never touches the DOM.
import { createWorld, step, save, load, cashTarget } from '../sim/world';
import { CFG, SPECIES, NEED_IDS, COMPANY_NAME, TRAIT_FX, SQUADS, FEATURES } from '../sim/config';
import { World, Scout, hourOf, dayOf, clockStr, isDark, T } from '../sim/core';
import { chainOrder, commander, foodPoints, stock } from '../sim/ai';
import { canSee } from '../sim/combat';
import { pocketPts } from '../sim/pocket';
import { packFear } from '../sim/wild';
import { popup } from './ui';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const cv = $('cv') as HTMLCanvasElement; const ctx = cv.getContext('2d')!;
const SAVE_KEY = 'tabe-pocket-save-v1.2';   // v1.2: nests, packs and pocket food change the world shape, so v1.1 saves are not resumed
const params = new URLSearchParams(location.search);
const REVEAL = params.get('reveal') === '1';   // designer view: no fog, every bird drawn (?reveal=1); the sim is unchanged
void FEATURES;

let w: World;
let speed = 1, selected = -1, follow = true, muted = true, mapView = false, savedZ = 4;
let cam = { x: 0, y: 0, z: 3 };  // world metres at screen centre, pixels per metre
let fogAt = -1, camOn = -1;

function newWorld(seed: number): void {
  w = createWorld(seed); selected = -1; resetCaches();
  cam.x = w.landing.x; cam.y = w.landing.y; cam.z = 7;
    logSeen = 0; $('log').innerHTML = ''; popup.close();
}
function boot(): void {
  const s = params.get('seed');
  let saved: string | null | false = false; try { saved = !s && localStorage.getItem(SAVE_KEY); } catch { /* storage blocked (private mode / sandboxed frame): no resume */ }
  if (saved) { try { w = load(saved); resetCaches(); cam.x = w.camp.sited ? w.camp.x : w.landing.x; cam.y = w.camp.sited ? w.camp.y : w.landing.y } catch { newWorld(1); } }
  else newWorld(Number(s || 1));
  const d = Number(params.get('day') || 0); const hh = Number(params.get('hour') || 0);
  if (d || hh) { const target = (d ? (d - 1) : 0) * CFG.DAY_TICKS + ((hh || CFG.START_HOUR) - CFG.START_HOUR) * (CFG.DAY_TICKS / 24); while (w.tick < target) step(w); }
  const tk = Number(params.get('tick') || 0); while (w.tick < tk) step(w);   // land on an exact moment (screenshots, bug reports)
  if (params.get('speed')) speed = Number(params.get('speed'));
  if (params.get('pick') === 'fight') { const p = w.scouts.find((x) => x.combat) || w.scouts.find((x) => x.threat); if (p) { selected = p.id; cam.x = p.x; cam.y = p.y; } }
  else if (params.get('pick')) { const p = w.scouts.find((x) => x.name === params.get('pick')); if (p) { selected = p.id; cam.x = p.x; cam.y = p.y; } }
  else if (d || hh) { cam.x = w.camp.sited ? w.camp.x : cam.x; cam.y = w.camp.sited ? w.camp.y : cam.y; }
  const look = params.get('look');   // camera on the Roukha: ?look=nest (a nest calling a hunt, else the first), ?look=pack (a hunting pack)
  if (look === 'nest') { const n = w.nests.find((x) => x.muster) || w.nests[0]; if (n) { cam.x = n.x; cam.y = n.y; follow = false; } }
  if (look === 'fight') { const a = w.scouts.filter((x) => x.combat && x.status === 'ok'); const b = w.birds.filter((x) => x.state === 'charge'); const all = [...a, ...b]; if (all.length) { cam.x = all.reduce((t, e) => t + e.x, 0) / all.length; cam.y = all.reduce((t, e) => t + e.y, 0) / all.length; follow = false; } }
  if (look === 'pack') { const p = w.packs.find((x) => x.kind === 'hunt' && x.state !== 'gone' && x.members.length); if (p) { cam.x = p.x; cam.y = p.y; follow = false; } }
  if (params.get('panel') === '0') { camOn = selected; selected = -1; }   // keep the camera on him, without the card
  if (params.get('zoom')) cam.z = Number(params.get('zoom'));
  const ins = params.get('inset');   // preview a phone's safe-area insets on a desktop: ?inset=left,top,right,bottom (px)
  if (ins) {
    const [l, t, r, b] = ins.split(',').map((v) => Number(v) || 0); const st = document.documentElement.style;
    st.setProperty('--il', l + 'px'); st.setProperty('--it', t + 'px'); st.setProperty('--ir', r + 'px'); st.setProperty('--ib', b + 'px');
    const d = $('insetdbg'); d.style.display = 'block';   // shade the unsafe areas (notch side bands, home indicator)
    d.style.boxShadow = `inset ${l}px 0 0 #000c, inset -${r}px 0 0 #000c, inset 0 ${t}px 0 #000c, inset 0 -${b}px 0 #000c`;
  }
  setSpeedButtons(); resize(); showPanel(); requestAnimationFrame(frame);
  if (params.get('open') === 'hud') setTimeout(() => openHud(), 50);
  if (params.get('open') === 'speed') setTimeout(() => openSpeed(), 50);
  if (params.get('open') === 'log') setTimeout(() => $('logwrap').classList.add('open'), 50);
}

// ---------- terrain and fog: chunked offscreen canvases, only visible chunks are drawn ----------
// The island is 768x768 tiles. Terrain is cut into CH x CH tile chunks, each rendered once (on first sight) into
// a small offscreen canvas at 1 px per tile. Fog has its own per-chunk canvases, rebuilt only when that chunk's
// count of revealed tiles changes. Trees and bushes are indexed by chunk so a frame only touches what's on screen.
const CH = 64;
const TCOL = ['#2a5d7c', '#d9c58b', '#7aa35a', '#3f6b3a', '#8a8580', '#4a86a8', '#5b9cc0', '#c4a064', '#506e50', '#8c8264'];  // by terrain id (see core T)
const TRGB = TCOL.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
let terrainChunks = new Map<number, HTMLCanvasElement>();
let fogChunks = new Map<number, { cv: HTMLCanvasElement | null; count: number }>();
let floraIdx = new Map<number, { trees: number[]; bushes: number[] }>();
function resetCaches(): void {
  terrainChunks = new Map(); fogChunks = new Map(); fogAt = -1; prevPos = new WeakMap();
  floraIdx = new Map(); const M = CFG.TILE_M, nc = Math.ceil(w.map.n / CH);
  const at = (x: number, y: number): { trees: number[]; bushes: number[] } => { const k = Math.floor(y / M / CH) * nc + Math.floor(x / M / CH); let e = floraIdx.get(k); if (!e) floraIdx.set(k, (e = { trees: [], bushes: [] })); return e; };
  w.trees.forEach((t, i) => at(t.x, t.y).trees.push(i)); w.bushes.forEach((b, i) => at(b.x, b.y).bushes.push(i));
}
function clamp255(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v; }
function terrainChunk(cx: number, cy: number): HTMLCanvasElement {
  const n = w.map.n, nc = Math.ceil(n / CH), key = cy * nc + cx; let c = terrainChunks.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = CH; c.height = CH; const g = c.getContext('2d')!; const img = g.createImageData(CH, CH);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CH; x++) {
    const tx = cx * CH + x, ty = cy * CH + y, o = (y * CH + x) * 4; if (tx >= n || ty >= n) continue;
    const i = ty * n + tx; const col = TRGB[w.map.terrain[i]] || TRGB[0]; const v = ((i * 2654435761) >>> 28) - 8; // tiny texture
    img.data[o] = clamp255(col[0] + v); img.data[o + 1] = clamp255(col[1] + v); img.data[o + 2] = clamp255(col[2] + v); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); terrainChunks.set(key, c); return c;
}
/** Fog for one chunk, with a 1-tile border from the neighbours so smoothed edges match across chunk seams. */
function fogChunk(cx: number, cy: number, refresh: boolean): HTMLCanvasElement | null | 'clear' {
  if (REVEAL) return 'clear';
  const n = w.map.n, nc = Math.ceil(n / CH), key = cy * nc + cx; let e = fogChunks.get(key);
  if (e && !refresh) return e.count === CH * CH ? 'clear' : e.cv;
  let cnt = 0; const sn = w.map.seen;
  for (let y = cy * CH; y < Math.min(n, cy * CH + CH); y++) for (let x = cx * CH, i = y * n + x; x < Math.min(n, cx * CH + CH); x++, i++) cnt += sn[i];
  if (e && e.count === cnt) return cnt === CH * CH ? 'clear' : e.cv;
  if (!e) fogChunks.set(key, (e = { cv: null, count: -1 }));
  e.count = cnt;
  if (cnt === CH * CH) { e.cv = null; return 'clear'; }
  if (!e.cv) { e.cv = document.createElement('canvas'); e.cv.width = CH + 2; e.cv.height = CH + 2; }
  const g = e.cv.getContext('2d')!; const img = g.createImageData(CH + 2, CH + 2);
  for (let y = 0; y < CH + 2; y++) for (let x = 0; x < CH + 2; x++) {
    const tx = Math.min(n - 1, Math.max(0, cx * CH + x - 1)), ty = Math.min(n - 1, Math.max(0, cy * CH + y - 1)); const o = (y * (CH + 2) + x) * 4;
    img.data[o] = 18; img.data[o + 1] = 22; img.data[o + 2] = 28; img.data[o + 3] = sn[ty * n + tx] ? 0 : 205;
  }
  g.putImageData(img, 0, 0); return e.cv;
}

// ---------- render interpolation ----------
// The sim steps at 10 Hz; the screen runs at 60. We keep each moving thing's position from just before the latest
// sim step and draw it blended toward the current one by how far we are into the next step (fixed-timestep alpha).
let prevPos = new WeakMap<object, [number, number, number, number]>();
let alpha = 1;
function snapshot(): void {
  for (const s of w.scouts) prevPos.set(s, [s.x, s.y, s.fx, s.fy]);
  for (const b of w.birds) prevPos.set(b, [b.x, b.y, b.fx, b.fy]);
  for (const d of w.deer) prevPos.set(d, [d.x, d.y, 0, 0]);
  for (const b of w.bullets) prevPos.set(b, [b.x, b.y, 0, 0]);
}
function P(e: { x: number; y: number }): [number, number] {
  const p = prevPos.get(e); if (!p) return [e.x, e.y];
  if (Math.abs(p[0] - e.x) + Math.abs(p[1] - e.y) > 12) return [e.x, e.y];   // teleports (e.g. a rescue drag start) snap
  return [p[0] + (e.x - p[0]) * alpha, p[1] + (e.y - p[1]) * alpha];
}
function angleOf(e: { x: number; y: number; fx: number; fy: number }): number {
  const a1 = Math.atan2(e.fy, e.fx); const p = prevPos.get(e); if (!p || (p[2] === 0 && p[3] === 0)) return a1;
  const a0 = Math.atan2(p[3], p[2]); let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return a0 + d * alpha;
}

// ---------- camera and input ----------
function resize(): void { const d = window.devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; }
addEventListener('resize', resize);
const landscape = (): boolean => innerWidth > innerHeight;
// keep the followed man clear of the card: card is on the left in landscape, at the bottom in portrait
const midY = (): number => (selected >= 0 && !landscape() ? innerHeight * 0.27 : innerHeight / 2);
const midX = (): number => (selected >= 0 && landscape() ? innerWidth * 0.69 : innerWidth / 2);
const toWorld = (sx: number, sy: number): [number, number] => [cam.x + (sx - midX()) / cam.z, cam.y + (sy - midY()) / cam.z];
const pts = new Map<number, { x: number; y: number }>(); let moved = 0, pinch0 = 0, z0 = 0;
cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); z0 = cam.z; } });
cv.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId); if (!p) return;
  if (pts.size === 1) { const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy); if (moved > 6) { cam.x -= dx / cam.z; cam.y -= dy / cam.z; follow = false; camOn = -1; } }
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); cam.z = Math.max(0.2, Math.min(14, z0 * d / pinch0)); moved = 99; }
});
cv.addEventListener('pointerup', (e) => {
  pts.delete(e.pointerId);
  if (moved <= 6 && pts.size === 0) { // tap: pick nearest scout
    const [x, y] = toWorld(e.clientX, e.clientY); let best: Scout | null = null, bd = 20 / cam.z + 2;
    for (const s of w.scouts) { if (s.status === 'dead' && s.shipped) continue; const [px, py] = P(s); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = s; } }
    selected = best ? best.id : -1; camOn = -1; if (best) follow = true; showPanel();
  }
});
cv.addEventListener('wheel', (e) => { cam.z = Math.max(0.2, Math.min(14, cam.z * (e.deltaY < 0 ? 1.15 : 0.87))); e.preventDefault(); }, { passive: false });

// ---------- controls: little tap-to-open menus (see ui.ts) ----------
const SPEEDS = [0, 1, 2, 4, 16];
function setSpeedButtons(): void { $('speedbtn').textContent = speed === 0 ? '⏸' : speed + 'x'; $('viewbtn').classList.toggle('on', follow && !mapView); }
function speedSpec(): Parameters<typeof popup.open>[1] {
  return { id: 'speed', title: 'Speed', items: SPEEDS.map((v) => ({ label: v === 0 ? '⏸ pause' : v + 'x', on: v === speed, keepOpen: false, act: () => { speed = v; setSpeedButtons(); audioInit(); } })) };
}
function openSpeed(): void { popup.toggle($('speedbtn'), speedSpec()); }
$('speedbtn').addEventListener('click', openSpeed);
$('viewbtn').addEventListener('click', () => popup.toggle($('viewbtn'), { id: 'view', title: 'View', col: true, items: [
  { label: '🎯 Follow the squad', on: follow && !mapView && selected < 0, act: () => { selected = -1; showPanel(); follow = true; if (mapView) toggleMap(); setSpeedButtons(); } },
  { label: '🗺 Island map', on: mapView, act: () => { toggleMap(); setSpeedButtons(); } },
  { label: '📜 Camp log', on: $('logwrap').classList.contains('open'), act: () => $('logwrap').classList.toggle('open') },
  { label: muted ? '🔇 Sound off' : '🔊 Sound on', act: () => { muted = !muted; audioInit(); } },
] }));
$('menubtn').addEventListener('click', () => popup.toggle($('menubtn'), { id: 'menu', wide: true, html: menuHtml(), onRender: (el) => {
  const btn = el.querySelector('#newgame') as HTMLButtonElement; const inp = el.querySelector('#seed') as HTMLInputElement; inp.value = String(w.seed);
  btn.addEventListener('click', () => { const sd = Number(inp.value) || ((Date.now() / 1000) | 0); try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ } newWorld(sd); popup.close(); });
} }));
function openHud(): void { popup.toggle($('hud'), { id: 'hud', title: 'Camp', html: hudHtml() }); }
$('hud').addEventListener('click', openHud);
$('logchip').addEventListener('click', () => $('logwrap').classList.toggle('open'));
function toggleMap(): void {
  mapView = !mapView;
  if (mapView) { savedZ = cam.z; follow = false; const span = w.map.n * CFG.TILE_M; cam.x = span / 2; cam.y = span / 2; cam.z = Math.min(innerWidth, innerHeight) / span * 0.92; }
  else { cam.z = savedZ; follow = true; }
}
$('closepanel').addEventListener('click', () => { selected = -1; showPanel(); });

// ---------- sound (procedural Web Audio, original) ----------
let ac: AudioContext | null = null;
function audioInit(): void { if (!ac) { try { ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { ac = null; } } if (ac && ac.state === 'suspended') void ac.resume(); }
const lastSfx: Record<string, number> = {};
function sfx(kind: 'shot' | 'call' | 'chop' | 'horn', vol = 1): void {
  if (muted || !ac) return; const now = ac.currentTime; if ((lastSfx[kind] || 0) > now - (kind === 'shot' ? 0.08 : 0.4)) return; lastSfx[kind] = now;
  const g = ac.createGain(); g.connect(ac.destination);
  if (kind === 'shot' || kind === 'chop') {
    const len = kind === 'shot' ? 0.35 : 0.08; const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'shot' ? 4 : 2);
    const src = ac.createBufferSource(); src.buffer = buf; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'shot' ? 1800 : 900;
    src.connect(f); f.connect(g); g.gain.value = 0.5 * vol; src.start();
  } else if (kind === 'call') {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(320, now); o.frequency.exponentialRampToValueAtTime(140, now + 0.5);
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; o.connect(f); f.connect(g);
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.25 * vol, now + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6); o.start(); o.stop(now + 0.65);
  } else {
    for (const fr of [110, 138.6]) { const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = fr; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; o.connect(f); f.connect(g); o.start(); o.stop(now + 1.6); }
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.15, now + 0.1); g.gain.setValueAtTime(0.15, now + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
  }
}

// ---------- main loop ----------
let last = performance.now(), acc = 0, lastSave = 0, prevShots = 0, prevCharges = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  acc += dt * speed * CFG.TICK_HZ; let n = 0;
  // fixed timestep: snapshot positions before the LAST step of this frame, then draw blended by the leftover fraction
  while (acc >= 1 && n < 400) { if (acc < 2 || n === 399) snapshot(); step(w); acc -= 1; n++; }
  if (n >= 400) acc = 0;
  alpha = Math.max(0, Math.min(1, acc));
  if (w.stats.shots > prevShots) { const d = w.stats.shots - prevShots; prevShots = w.stats.shots; if (speed <= 4) sfx('shot', Math.min(1, 0.4 + d * 0.2)); }
  if (w.stats.charges > prevCharges) { prevCharges = w.stats.charges; sfx('call'); }
  if (speed <= 4 && w.scouts.some((s) => s.act && (s.act.kind === 'chop' || s.act.kind === 'fell') && s.posture === 'crouch' && w.tick % 12 === 0)) sfx('chop', 0.4);
  const fogRefresh = w.tick - fogAt >= 10 || fogAt < 0; if (fogRefresh) fogAt = w.tick;
  if (follow) {
    const fid = selected >= 0 ? selected : camOn;
    const s = fid >= 0 ? w.scouts.find((x) => x.id === fid) : undefined;
    const [fx, fy] = s ? P(s) : squadCentre();
    const k = 1 - Math.pow(0.88, dt * 60);   // same feel at any frame rate
    cam.x += (fx - cam.x) * k; cam.y += (fy - cam.y) * k;
  }
  draw(fogRefresh); hud(); pumpLog();
  if (popup.isOpen('hud') && w.tick % 10 === 0) popup.refresh({ id: 'hud', title: 'Camp', html: hudHtml() });
  if (selected >= 0 && w.tick % 5 === 0) showPanel();
  if (now - lastSave > 30000) { lastSave = now; try { localStorage.setItem(SAVE_KEY, save(w)); } catch { /* storage full: skip */ } }
  requestAnimationFrame(frame);
}

/** Centre of the squad: the men who are up and about, or the commander if they're spread wide. */
function squadCentre(): [number, number] {
  const up = w.scouts.filter((s) => s.status !== 'dead');
  if (!up.length) return [cam.x, cam.y];
  let x = 0, y = 0; for (const s of up) { const [px, py] = P(s); x += px; y += py; } x /= up.length; y /= up.length;
  const spread = Math.max(...up.map((s) => Math.hypot(s.x - x, s.y - y)));
  if (spread * cam.z > Math.min(innerWidth, innerHeight) * 0.45) { const c = commander(w) || up[0]; return P(c); }
  return [x, y];
}
// ---------- drawing ----------
function draw(fogRefresh: boolean): void {
  const d = window.devicePixelRatio || 1; ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = '#1d4a66'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.save(); ctx.translate(midX(), midY()); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
  const M = CFG.TILE_M, n = w.map.n, nc = Math.ceil(n / CH), CM = CH * M;
  const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(innerWidth, innerHeight);
  const vis = (x: number, y: number, r = 4): boolean => x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r;
  const seen = (x: number, y: number): boolean => REVEAL || !!w.map.seen[Math.floor(y / M) * n + Math.floor(x / M)];
  // visible chunk range
  const cx0 = Math.max(0, Math.floor(x0 / CM)), cx1 = Math.min(nc - 1, Math.floor(x1 / CM)), cy0 = Math.max(0, Math.floor(y0 / CM)), cy1 = Math.min(nc - 1, Math.floor(y1 / CM));
  ctx.imageSmoothingEnabled = false;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) ctx.drawImage(terrainChunk(cx, cy), cx * CM - 0.02, cy * CM - 0.02, CM + 0.04, CM + 0.04);
  // landing and boat
  if (w.boat.state === 'docked') { const bx = w.landing.x + w.landing.sx * 14, by = w.landing.y + w.landing.sy * 14; ctx.fillStyle = '#5a3d22'; ellipse(bx, by, 7, 3, Math.atan2(w.landing.sy, w.landing.sx) + Math.PI / 2); ctx.fillStyle = '#eee'; ctx.fillRect(bx - 1, by - 5, 2, 4); }
  // camp
  if (w.camp.sited) {
    const c = w.camp;
    ctx.strokeStyle = 'rgba(255,240,200,.25)'; ctx.lineWidth = 0.3; ctx.setLineDash([1, 1]); circle(c.x, c.y, 14, false);
    if (cam.z > 1.2) { ctx.strokeStyle = 'rgba(255,240,200,.12)'; ctx.setLineDash([2, 3]); circle(c.x, c.y, SPECIES.scout.home.safeR, false); }   // the camp perimeter: beyond it, men go in teams
    ctx.setLineDash([]);
    for (const k in c.builds) { const b = c.builds[k]; if (!b.built && b.progress <= 0) continue; ctx.globalAlpha = b.built ? 1 : 0.4; ctx.fillStyle = BCOL[k] || '#a08060'; ctx.fillRect(b.x - 1.6, b.y - 1.2, 3.2, 2.4); ctx.globalAlpha = 1; if (cam.z > 5) label(BLAB[k] || k, b.x, b.y + 2.4, '#ddd', 2.2); }
    if (c.builds.palisade && c.builds.palisade.built) { ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 0.8; circle(c.x, c.y, 16, false); }
    if (c.latrine.built) { ctx.fillStyle = '#6b5a3a'; ctx.fillRect(c.latrine.x - 0.8, c.latrine.y - 0.8, 1.6, 1.6); }
    ctx.fillStyle = '#8b6b3e'; ctx.fillRect(c.pile.x - 1.2, c.pile.y - 0.8, 2.4, 1.6);
    ctx.fillStyle = '#4b6f8a'; circle(c.cask.x, c.cask.y, 0.7);
    for (const s of w.scouts) if (s.status !== 'dead') { const k = s.id % 8; const ring = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]]; ctx.fillStyle = '#7a6a4a'; ellipse(c.fire.x + ring[k][0] * 3.2, c.fire.y + ring[k][1] * 3.2, 0.9, 0.45, Math.atan2(ring[k][1], ring[k][0])); }
    if (c.fire.built) { const lit = c.fire.fuel > 0; ctx.fillStyle = '#555'; circle(c.fire.x, c.fire.y, 1.1); if (lit) { const f = 0.7 + 0.15 * Math.sin(performance.now() / 90); ctx.fillStyle = '#ff9a2a'; circle(c.fire.x, c.fire.y, f); ctx.fillStyle = '#ffe07a'; circle(c.fire.x, c.fire.y, f * 0.45); } }
  }
  // flora (by chunk; skipped when zoomed far out, where the terrain colours carry it)
  if (cam.z >= 1.4) for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const e = floraIdx.get(cy * nc + cx); if (!e) continue;
    for (const i of e.trees) { const t = w.trees[i]; if (!vis(t.x, t.y) || !seen(t.x, t.y)) continue; if (t.felled) { ctx.fillStyle = '#6b4f2e'; circle(t.x, t.y, 0.5); } else { ctx.fillStyle = '#2d5a2a'; circle(t.x, t.y, 0.9 + t.size * 0.35); ctx.fillStyle = '#3d7a37'; circle(t.x - 0.3, t.y - 0.3, 0.5 + t.size * 0.2); } }
    for (const i of e.bushes) { const b = w.bushes[i]; if (!vis(b.x, b.y) || !seen(b.x, b.y)) continue; ctx.fillStyle = '#4f7f3a'; circle(b.x, b.y, 0.8); if (b.berries >= 1) { ctx.fillStyle = '#c03a4a'; circle(b.x + 0.3, b.y - 0.2, 0.22); circle(b.x - 0.3, b.y + 0.1, 0.22); } }
  }
  for (const r of w.rookeries) if (seen(r.x, r.y)) { ctx.strokeStyle = 'rgba(200,60,40,.6)'; ctx.lineWidth = 0.4; circle(r.x, r.y, CFG.ROOKERY_GUARD_M, false); ctx.fillStyle = '#7a5a3a'; circle(r.x, r.y, 2.5); if (r.eggs) { ctx.fillStyle = '#f2ead0'; for (let i = 0; i < Math.min(r.eggs, 6); i++) circle(r.x - 1.2 + (i % 3) * 1.2, r.y - 0.5 + Math.floor(i / 3), 0.35); } }
  // Roukha nests (v1.2): twig ring + eggs; dashed ring = the birds' home range (where they feel safe)
  for (const n of w.nests) {
    if (!seen(n.x, n.y) || !vis(n.x, n.y)) continue;
    ctx.strokeStyle = 'rgba(200,90,50,.35)'; ctx.lineWidth = 0.3; ctx.setLineDash([1.5, 1.5]); circle(n.x, n.y, SPECIES.roukha.home.safeR, false); ctx.setLineDash([]);
    ctx.fillStyle = '#6b5236'; circle(n.x, n.y, 3.2); ctx.fillStyle = '#8a6c48'; circle(n.x, n.y, 2.2); ctx.fillStyle = '#5a4430'; circle(n.x, n.y, 1.3);
    ctx.fillStyle = '#efe6cc'; circle(n.x - 0.5, n.y - 0.2, 0.45); circle(n.x + 0.45, n.y + 0.3, 0.45); circle(n.x + 0.1, n.y - 0.6, 0.4);
  }
  for (const c of w.carcasses) { if (!vis(c.x, c.y) || !seen(c.x, c.y)) continue; ctx.fillStyle = c.kind === 'deer' ? '#7a5a3a' : '#5a2a2a'; ellipse(c.x, c.y, c.age === 'B' ? 1.5 : 1.1, c.age === 'B' ? 0.8 : 0.6, 0.4); }
  for (const g of w.signs) { if (!vis(g.x, g.y) || cam.z < 4 || !seen(g.x, g.y)) continue; ctx.fillStyle = g.kind === 'blood' ? '#a01818' : 'rgba(60,40,30,.7)'; circle(g.x, g.y, 0.18); }
  // animals: only what some scout can actually see (the same test the shooting uses, so nothing is shot unseen)
  for (const dd of w.deer) { if (dd.state === 'dead' || !vis(dd.x, dd.y) || !seen(dd.x, dd.y)) continue; const [px, py] = P(dd); ctx.fillStyle = '#9a6b3e'; ellipse(px, py, 0.9, 0.5, Math.atan2(dd.ty - dd.y, dd.tx - dd.x)); }
  const fireLitNow = w.camp.sited && w.camp.fire.built && w.camp.fire.fuel > 0;
  for (const b of w.birds) {
    if (b.state === 'dead' || !vis(b.x, b.y)) continue;
    const near = REVEAL || w.scouts.some((s) => s.status !== 'dead' && canSee(w, s, b.x, b.y)) || (fireLitNow && seen(b.x, b.y) && Math.hypot(b.x - w.camp.fire.x, b.y - w.camp.fire.y) < CFG.FIRE_LIGHT_M);
    if (!near) continue;
    const [bx, by] = P(b);
    const sz = b.age === 'B' ? 1.6 : b.age === 'A' ? 1.25 : 0.9; const a = angleOf(b);
    ctx.save(); ctx.translate(bx, by); ctx.rotate(a);
    ctx.fillStyle = b.state === 'charge' ? '#b02a1a' : '#4a2a22'; ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8c040'; ctx.beginPath(); ctx.moveTo(sz * 0.8, -sz * 0.25); ctx.lineTo(sz * 1.8, 0); ctx.lineTo(sz * 0.8, sz * 0.25); ctx.fill();
    ctx.restore();
    if (b.bleeding) { ctx.fillStyle = '#d01010'; circle(bx, by + sz, 0.2); }
    if (b.job === 'muster') { ctx.strokeStyle = 'rgba(255,210,110,.8)'; ctx.lineWidth = 0.2; circle(bx, by, sz + 0.6, false); }
    if (b.state === 'flee') { ctx.strokeStyle = 'rgba(255,120,120,.8)'; ctx.lineWidth = 0.2; circle(bx, by, sz + 0.6, false); }
  }
  // firing sequence: aim line (brightens as the aim settles), muzzle flash on the shot
  for (const s of w.scouts) {
    if (s.status !== 'ok' || !s.combat) continue;
    const [sx, sy] = P(s);
    if (s.firePhase === 'aim' && s.aimTarget >= 0) {
      const b = w.birds.find((x) => x.id === s.aimTarget && x.state !== 'dead');
      if (b) { const [bx, by] = P(b); const k = Math.min(1, s.aimT / Math.max(1, s.aimNeed)); ctx.strokeStyle = `rgba(255,${Math.round(240 - 140 * k)},${Math.round(120 - 80 * k)},${0.25 + 0.6 * k})`; ctx.lineWidth = 0.12 + 0.18 * k; ctx.setLineDash([0.8, 0.6]); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (w.tick - s.flashT < 3) { const a = angleOf(s); const mx = sx + Math.cos(a) * 2.9, my = sy + Math.sin(a) * 2.9; ctx.fillStyle = 'rgba(255,230,120,.95)'; circle(mx, my, 0.9); ctx.fillStyle = 'rgba(255,255,230,1)'; circle(mx, my, 0.45); }
  }
  // bullets
  ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 0.25; for (const b of w.bullets) { const [bx, by] = P(b); ctx.beginPath(); ctx.moveTo(bx - b.dx * 2.5, by - b.dy * 2.5); ctx.lineTo(bx, by); ctx.stroke(); }
  // teams: a faint line from each man to the leader he's forming up on; ropes from the haulers to a dragged bird
  for (const s of w.scouts) {
    const a = s.act; if (!a || s.status === 'dead') continue;
    const [sx, sy] = P(s);
    if (a.kind === 'buddy' || a.kind === 'assist') {
      const l = w.scouts.find((x) => x.id === a.leader); if (!l) continue; const [lx, ly] = P(l);
      const rally = l.act && l.act.team && l.act.team.phase === 'rally';
      if (l.carcassMode === 'drag' && Math.hypot(lx - sx, ly - sy) < 7) {   // on the rope
        const la = angleOf(l), cxp = lx - Math.cos(la) * 2.8, cyp = ly - Math.sin(la) * 2.8; ctx.strokeStyle = '#c8b080'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cxp, cyp); ctx.stroke();
      } else if (rally || a.kind === 'assist') { ctx.strokeStyle = rally ? 'rgba(255,220,120,.45)' : 'rgba(160,220,255,.35)'; ctx.lineWidth = 0.2; ctx.setLineDash([0.6, 0.6]); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lx, ly); ctx.stroke(); ctx.setLineDash([]); }
    }
  }
  // scouts: little top-down men (hat + rifle). Squads differ by colour AND hat shape.
  for (const s of w.scouts) {
    if (s.status === 'dead' && s.shipped) continue;
    const [sx, sy] = P(s);
    if (s.id === selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.25; circle(sx, sy, 1.9, false); }
    if (s.carcassMode === 'drag') { const a = angleOf(s); const bx = sx - Math.cos(a) * 2.8, by = sy - Math.sin(a) * 2.8; ctx.fillStyle = '#4a3a30'; ellipse(bx, by, 1.6, 0.95, a); ctx.fillStyle = '#6b5544'; ellipse(bx - Math.cos(a) * 1.9, by - Math.sin(a) * 1.9, 0.45, 0.35, a); ctx.fillStyle = '#d9c27a'; ellipse(bx - Math.cos(a) * 2.35, by - Math.sin(a) * 2.35, 0.35, 0.18, a); ctx.strokeStyle = '#c8b080'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(a) * 2.4, sy - Math.sin(a) * 2.4); ctx.stroke(); }
    drawMan(s, sx, sy);
    if (s.sleeping) label('z', sx + 1.2, sy - 1.2, '#cde', 1.6);
  }
  if (mapView || cam.z < 1.4) for (const s of w.scouts) { if (s.status === 'dead') continue; const [sx, sy] = P(s); ctx.fillStyle = SQUADS[s.squad % SQUADS.length].color; circle(sx, sy, 3 / cam.z * 1.6); }
  // fog of war (per chunk, smoothed edges)
  const h = hourOf(w.tick); const dark = nightAlpha(h) + (w.weather === 'storm' ? 0.15 : w.weather === 'rain' ? 0.08 : 0);
  ctx.imageSmoothingEnabled = true;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const f = fogChunk(cx, cy, fogRefresh); if (f === 'clear') continue;
    if (f) ctx.drawImage(f, 1, 1, CH, CH, cx * CM - 0.02, cy * CM - 0.02, CM + 0.04, CM + 0.04);
  }
  ctx.restore();
  if (dark > 0.02) drawNight(Math.min(0.75, dark));
  if (w.weather === 'rain' || w.weather === 'storm') { ctx.strokeStyle = 'rgba(180,200,255,.25)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < (w.weather === 'storm' ? 120 : 60); i++) { const x = (i * 97 + w.tick * 7) % innerWidth, y = (i * 53 + w.tick * 23) % innerHeight; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 9); } ctx.stroke(); }
  if (w.weather === 'fog') { ctx.fillStyle = 'rgba(220,225,230,.25)'; ctx.fillRect(0, 0, innerWidth, innerHeight); }
  // speech bubbles (screen space, so they stay readable)
  ctx.font = '12px -apple-system, system-ui, sans-serif';
  const bubbles: [number, number, number][] = [];
  const bubbleDraws: { sx: number; sy: number; sy0: number; tw: number; text: string; tail: boolean }[] = [];
  for (const s of w.scouts) {
    if (mapView || s.status === 'dead' || !s.bark || s.barkUntil < w.tick) continue;
    const [px, py] = P(s);
    const sx = (px - cam.x) * cam.z + midX(); let sy = (py - cam.y) * cam.z + midY() - 30 - cam.z * 2.1;
    if (sx < -100 || sx > innerWidth + 100 || sy < -40 || sy > innerHeight + 40) continue;
    const text = s.bark.length > 46 ? s.bark.slice(0, 44) + '…' : s.bark; const tw = ctx.measureText(text).width + 12;
    let by = sy; for (let k = 0; k < 4 && bubbles.some((r) => Math.abs(r[0] - sx) < (r[2] + tw) / 2 && Math.abs(r[1] - by) < 20); k++) by -= 21;   // stack, don't overlap
    bubbles.push([sx, by, tw]); const tail = by === sy; const sy0 = sy; sy = by;
    bubbleDraws.push({ sx, sy, sy0, tw, text, tail });
  }
  placed.length = 0;
  for (const b of bubbleDraws) placed.push([b.sx, b.sy - 11, b.tw, 20]);
  // labels (screen space, placed so they don't pile on top of each other): what he's doing, the request flag, his name
  if (cam.z >= 2.2 && !mapView) {
    const L = (t: string, x: number, y: number, col: string, px: number): void => { if (t) placeLabel(t, x, y, col, px); };
    const order = [...w.scouts].sort((p, q) => (q.id === selected ? 1 : 0) - (p.id === selected ? 1 : 0) || (q.act && q.act.team ? 1 : 0) - (p.act && p.act.team ? 1 : 0) || p.id - q.id);
    // nests and packs (v1.2): what the birds are up to, where a scout could see it
    for (const n of w.nests) {
      if (!seen(n.x, n.y)) continue;
      const [px, py] = [n.x, n.y]; const sx = (px - cam.x) * cam.z + midX(), sy = (py - cam.y) * cam.z + midY();
      if (sx < -80 || sx > innerWidth + 80 || sy < -40 || sy > innerHeight + 40) continue;
      const m = n.muster; const watched = REVEAL || w.birds.some((b) => b.nest === n.id && b.state !== 'dead' && w.scouts.some((o) => o.status !== 'dead' && canSee(w, o, b.x, b.y)));
      L(`${n.name} nest` + (m && watched ? ` · mustering ${1 + m.crew.length}/${m.need}` : ''), sx, sy + 3.5 * cam.z + 10, m && watched ? '#ffd27a' : '#e0b090', 11);
    }
    for (const p of w.packs) {
      if (p.kind !== 'hunt' || p.state === 'gone') continue;
      const ms = w.birds.filter((b) => b.pack === p.id && b.state !== 'dead');
      if (!REVEAL && !ms.some((b) => w.scouts.some((o) => o.status !== 'dead' && canSee(w, o, b.x, b.y)))) continue;
      const sx = (p.x - cam.x) * cam.z + midX(), sy = (p.y - cam.y) * cam.z + midY();
      const txt = p.state === 'retreat' ? `retreating (${ms.length}) · fear ${Math.round(packFear(w, p))}` : p.state === 'return' ? `pack heading home (${ms.length})` : p.state === 'charge' ? `charging! (${ms.length})` : p.state === 'stalk' ? `pack stalking (${ms.length})` : `hunting pack (${ms.length})`;
      L(txt, sx, sy - 3 * cam.z - 8, p.state === 'retreat' || p.state === 'return' ? '#9fe0a0' : '#ff8a70', 11);
    }
    for (const s of order) {
      if (s.status === 'dead' && s.shipped) continue;
      const [px, py] = P(s); const sx = (px - cam.x) * cam.z + midX(), sy = (py - cam.y) * cam.z + midY();
      if (sx < -60 || sx > innerWidth + 60 || sy < -40 || sy > innerHeight + 40) continue;
      const tag = shortLabel(s); const t = s.act && s.act.team;
      L(t && t.phase === 'rally' ? `${tag.text} · need ${t.need - 1 - t.crew.length} more` : tag.text, sx, sy - 2.1 * cam.z - 4, t && t.phase === 'rally' ? '#ffd27a' : tag.col, 11);
      if (cam.z >= 3.5) L(s.name + (s === commander(w) ? ' ★' : ''), sx, sy + 2.2 * cam.z + 9, '#fff', 10);
    }
  }
  // bubbles go on top; the labels were placed around them
  ctx.font = '12px -apple-system, system-ui, sans-serif';
  for (const { sx, sy, sy0, tw, text, tail } of bubbleDraws) {
    ctx.fillStyle = 'rgba(255,250,235,.93)'; roundRect(sx - tw / 2, sy - 20, tw, 18, 6); ctx.fill();
    if (tail) { ctx.beginPath(); ctx.moveTo(sx - 4, sy - 2); ctx.lineTo(sx, sy + 4); ctx.lineTo(sx + 4, sy - 2); ctx.fill(); } else { ctx.fillStyle = 'rgba(255,250,235,.6)'; ctx.fillRect(sx - 0.75, sy - 2, 1.5, sy0 - sy); }
    ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.fillText(text, sx, sy - 7);
  }
  if (w.over) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, innerHeight / 2 - 40, innerWidth, 80); ctx.fillStyle = '#fff'; ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center'; ctx.fillText(w.over === 'wiped' ? 'The company is dead.' : 'The company is bankrupt.', innerWidth / 2, innerHeight / 2 + 8); }
}
const MAN_SCALE = 1.4;  // men drawn a bit larger than life so they read on a phone
/** A scout as a small top-down man: shoulders in squad colour, head, hat (squad shape) and a rifle. */
function drawMan(s: Scout, x: number, y: number): void {
  const sq = SQUADS[s.squad % SQUADS.length]; const a = angleOf(s);
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(MAN_SCALE, MAN_SCALE);
  if (s.status === 'dead') { ctx.fillStyle = '#d8d0c0'; ctx.fillRect(-1.1, -0.45, 2.2, 0.9); ctx.restore(); return; }
  if (s.status === 'downed') { ctx.fillStyle = '#7a1a1a'; ctx.beginPath(); ctx.ellipse(0, 0, 1.3, 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
  if (s.sleeping) { ctx.fillStyle = '#6a5a3a'; ctx.beginPath(); ctx.ellipse(-0.3, 0, 1.3, 0.7, 0, 0, Math.PI * 2); ctx.fill(); }
  // rifle: forward when fighting, slung across the back otherwise
  ctx.strokeStyle = '#2a1f14'; ctx.lineWidth = 0.22; ctx.beginPath();
  const up = s.combat && (s.firePhase === 'aim' || s.firePhase === 'bolt');   // rifle presented: shouldered and pointed
  if (up) { ctx.moveTo(0.0, 0.25); ctx.lineTo(2.1, 0.05); } else if (s.combat) { ctx.moveTo(0.1, 0.45); ctx.lineTo(1.6, 0.6); } else { ctx.moveTo(-0.7, -0.6); ctx.lineTo(-0.2, 0.75); }
  ctx.stroke();
  // crouched: a knee/boot block behind him so the stance reads at a glance
  if (s.posture === 'crouch' && s.status === 'ok' && !s.sleeping) { ctx.fillStyle = '#3a2c1c'; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.1; ctx.beginPath(); ctx.ellipse(-1.0, 0.35, 0.62, 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(-0.85, -0.45, 0.4, 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  // shoulders
  ctx.fillStyle = s.status === 'downed' ? '#b04040' : sq.color; ctx.beginPath(); ctx.ellipse(0, 0, 0.55, 0.9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 0.12; ctx.stroke();
  // hat
  ctx.fillStyle = '#5a4630';
  if (sq.hat === 'brim') { ctx.beginPath(); ctx.arc(0.05, 0, 0.62, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#7a6040'; ctx.beginPath(); ctx.arc(0.05, 0, 0.34, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.fillStyle = '#d8d0b0'; ctx.beginPath(); ctx.ellipse(0.1, 0, 0.6, 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#b0a888'; ctx.fillRect(0.05, -0.08, 0.5, 0.16); }
  ctx.restore();
  if (s.status === 'ok' && s.combat) {
    if (s.firePhase === 'aim') { const k = Math.min(1, s.aimT / Math.max(1, s.aimNeed)); ctx.strokeStyle = 'rgba(255,220,120,.9)'; ctx.lineWidth = 0.25; ctx.beginPath(); ctx.arc(x, y, 2.3, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke(); }
    else if (s.firePhase === 'bolt' || s.reload > 0) { const k = s.reload > 0 ? 1 : s.fireT / Math.max(1, CFG.BOLT_TICKS); ctx.strokeStyle = s.reload > 0 ? 'rgba(255,140,90,.9)' : 'rgba(170,210,255,.9)'; ctx.lineWidth = 0.25; ctx.beginPath(); ctx.arc(x, y, 2.3, -Math.PI / 2, -Math.PI / 2 + (1 - k) * Math.PI * 2 + 0.3); ctx.stroke(); label('⟲', x + 2.4, y - 2.0, s.reload > 0 ? '#ffb080' : '#bfe0ff', 1.6); }
  }
}
const SHORT: Record<string, string> = { eat: 'eating', drink: 'drinking', sleep: 'asleep', watch: 'on watch', chop: 'firewood', fell: 'timber', forage: 'foraging', cook: 'cooking', fuel: 'fire', build: 'building', fetchWater: 'water run', hunt: 'hunting', rhunt: 'tracking', loot: 'loot', process: 'butchering', unpack: 'unpacking', unload: 'hauling', load: 'loading', meetBoat: 'trading', rescue: 'rescue!', treat: 'patching up', buddy: 'with team', assist: 'helping', home: 'heading back', idle: 'resting', explore: 'scouting', warm: 'warming up', scrape: 'hides' };
function shortLabel(s: Scout): { text: string; col: string } {
  if (s.status === 'dead') return { text: 'dead', col: '#bbb' };
  if (s.status === 'downed') return { text: 'DOWN', col: '#ff6a6a' };
  if (s.combat) {
    if (s.act && s.act.label === 'Fighting hand to hand') return { text: 'hand to hand!', col: '#ff8060' };
    if (s.reload > 0) return { text: 'reloading', col: '#ffb080' };
    if (s.firePhase === 'bolt') return { text: 'working the bolt', col: '#bfe0ff' };
    if (s.firePhase === 'aim') return { text: 'aiming', col: '#ffd27a' };
    if (s.firePhase === 'present') return { text: 'raising rifle', col: '#ffd27a' };
    return { text: s.posture === 'crouch' ? 'crouched' : 'fighting!', col: '#ffb040' };
  }
  if (s.status === 'recovering') return { text: 'recovering', col: '#ffb0b0' };
  const k = s.act ? s.act.kind : 'idle';
  if (k === 'loot') return { text: s.carcassMode === 'drag' ? 'hauling the bird' : 'taking the bird', col: '#e8eef4' };
  if (k === 'buddy' && s.act) { const l = w.scouts.find((x) => x.id === s.act!.leader); if (l && l.carcassMode === 'drag' && Math.hypot(l.x - s.x, l.y - s.y) < 7) return { text: 'on the rope', col: '#e8eef4' }; }
  const urgent = s.needs.food < CFG.NEED_URGENT || s.needs.water < CFG.NEED_URGENT;
  return { text: SHORT[k] || k, col: urgent ? '#ffd27a' : '#e8eef4' };
}
let nightCv: HTMLCanvasElement | null = null;
/** Night: darken the screen, cut soft radial holes for the fire and each man, then add a warm glow at the fire. */
function drawNight(alpha: number): void {
  const d = window.devicePixelRatio || 1;
  if (!nightCv) nightCv = document.createElement('canvas');
  if (nightCv.width !== cv.width || nightCv.height !== cv.height) { nightCv.width = cv.width; nightCv.height = cv.height; }
  const g = nightCv.getContext('2d')!; g.setTransform(d, 0, 0, d, 0, 0); g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, innerWidth, innerHeight); g.fillStyle = `rgba(8,12,34,${alpha})`; g.fillRect(0, 0, innerWidth, innerHeight);
  g.globalCompositeOperation = 'destination-out';
  const S = (x: number, y: number): [number, number] => [(x - cam.x) * cam.z + midX(), (y - cam.y) * cam.z + midY()];
  const hole = (x: number, y: number, r: number, k: number): void => { const [sx, sy] = S(x, y); const gr = g.createRadialGradient(sx, sy, 0, sx, sy, r * cam.z); gr.addColorStop(0, `rgba(0,0,0,${k})`); gr.addColorStop(0.6, `rgba(0,0,0,${k * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, r * cam.z, 0, Math.PI * 2); g.fill(); };
  const lit = w.camp.sited && w.camp.fire.built && w.camp.fire.fuel > 0;
  const flick = 1 + 0.04 * Math.sin(performance.now() / 110);
  if (lit) hole(w.camp.fire.x, w.camp.fire.y, CFG.FIRE_LIGHT_M * flick, 1);
  for (const s of w.scouts) if (s.status !== 'dead') { const [px, py] = P(s); hole(px, py, 6, 0.55); }
  ctx.drawImage(nightCv, 0, 0, innerWidth, innerHeight);
  if (lit) { const [sx, sy] = S(w.camp.fire.x, w.camp.fire.y); const r = CFG.FIRE_LIGHT_M * 0.8 * cam.z * flick; const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r); gr.addColorStop(0, `rgba(255,170,70,${0.35 * alpha / 0.75})`); gr.addColorStop(1, 'rgba(255,120,40,0)'); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
}
function nightAlpha(h: number): number { if (h >= 20 || h < 5) return 0.62; if (h >= 18) return ((h - 18) / 2) * 0.62; if (h < 7) return ((7 - h) / 2) * 0.62; return 0; }

const BCOL: Record<string, string> = { shelter: '#8a7a5a', barrel: '#4b6f8a', racks: '#9a7a4a', butcher: '#8a4a3a', shed: '#7a6040', mess: '#c8b890', tower: '#6a5030', palisade: '#6b4a2a' };
const BLAB: Record<string, string> = { shelter: 'fire shelter', barrel: 'rain barrel', racks: 'drying racks', butcher: 'butchering', shed: 'shed', mess: 'mess tent', tower: 'watchtower', palisade: 'palisade' };
function circle(x: number, y: number, r: number, fill = true): void { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); if (fill) ctx.fill(); else ctx.stroke(); }
function ellipse(x: number, y: number, rx: number, ry: number, a: number): void { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); ctx.fill(); }
function label(t: string, x: number, y: number, col: string, size: number): void { ctx.save(); ctx.font = `${size}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = size * 0.18; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y); ctx.restore(); }
const placed: [number, number, number, number][] = [];
/** Screen-space label that steps aside (up, then down) instead of overlapping one already drawn; skipped if no room. */
function placeLabel(t: string, x: number, y: number, col: string, px: number): void {
  ctx.font = `${px}px -apple-system, system-ui, sans-serif`; const wdt = ctx.measureText(t).width + 4, h = px + 2;
  for (const dy of [0, -h, h, -2 * h]) {
    const yy = y + dy; if (placed.some((r) => Math.abs(r[0] - x) < (r[2] + wdt) / 2 && Math.abs(r[1] - yy) < (r[3] + h) / 2)) continue;
    placed.push([x, yy, wdt, h]); ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(t, x, yy); ctx.fillStyle = col; ctx.fillText(t, x, yy); return;
  }
}
function roundRect(x: number, y: number, ww: number, hh: number, r: number): void { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath(); }

// ---------- HUD, panel, log ----------
const WEATHER_ICON: Record<string, string> = { clear: '☀️', rain: '🌧', storm: '⛈', fog: '🌫' };
function hud(): void {
  const h = hourOf(w.tick);
  const icon = isDark(h) ? '🌙' : WEATHER_ICON[w.weather] || '';
  $('clock').textContent = `Day ${dayOf(w.tick)} ${clockStr(w.tick)} ${icon}`;
  $('money').textContent = `💰 ${Math.round(w.ledger.credits + w.ledger.cash)}`;
  $('foodpts').textContent = `🍖 ${Math.round(foodPoints(w))}`;
}
/** The expanded HUD: everything the compact chip leaves out. */
function hudHtml(): string {
  const alive = w.scouts.filter((s) => s.status !== 'dead').length;
  const boat = w.boat.state === 'docked' ? 'at the landing' : `in ${Math.max(0, (w.boat.nextArrive - w.tick) / CFG.DAY_TICKS).toFixed(1)} days`;
  const foodDays = foodPoints(w) / Math.max(1, alive * CFG.FOOD_PER_DAY);
  const ammo = Math.round(stock(w, 'ammo') + w.scouts.reduce((t, s) => t + (s.status !== 'dead' ? s.ammo + s.mag : 0), 0));
  const teams = w.scouts.filter((s) => s.act && s.act.team && s.status !== 'dead');
  const teamLine = teams.length ? teams.map((s) => `${s.name} ${s.act!.team!.phase === 'rally' ? 'forming up' : 'out'} (${1 + s.act!.team!.crew.length}/${s.act!.team!.need}) ${s.act!.team!.noun}`).join('<br>') : 'nobody out';
  return `<div>📅 ${CFG.SEASONS[w.season]} · ${WEATHER_ICON[w.weather] || ''} ${w.weather}</div>
  <div>👥 ${alive}/${w.scouts.length} men · Boss ${commander(w)?.name || '—'}</div>
  <div>💰 ${Math.round(w.ledger.credits)} cr account · ${Math.round(w.ledger.cash)} cash</div>
  <div>⛵ boat ${boat}</div>
  <div>🍖 food ${Math.round(foodPoints(w))} pts (${foodDays.toFixed(1)} days; a meal = 100) · 💧 water ${Math.floor(stock(w, 'water'))} · 🪵 wood ${Math.floor(stock(w, 'wood'))}</div>
  <div>🔫 ${ammo} rounds</div>
  <div>🧭 teams: ${teamLine}</div>`;
}
function bar(v: number, col: string): string { return `<span class="bar"><span style="width:${Math.max(0, Math.min(100, v))}%;background:${col}"></span></span>`; }
// v1 shows the four core needs; the leisure needs (warmth, social, fitness, stress) come with FEATURES.leisure
const SHOWN_NEEDS: string[] = FEATURES.leisure ? [...NEED_IDS, 'morale', 'stress'] : ['food', 'water', 'rest', 'morale'];
const NEED_COL: Record<string, string> = { food: '#e0a040', water: '#40a0e0', rest: '#9a7ae0', warmth: '#e06040', social: '#e0d040', fitness: '#50c070', morale: '#ffffff', stress: '#ff4060' };
function showPanel(): void {
  const p = $('panel'); const s = w.scouts.find((x) => x.id === selected);
  if (!s) { p.classList.remove('open'); document.body.classList.remove('card-open'); return; }
  p.classList.add('open'); document.body.classList.add('card-open');
  const order = chainOrder(w); const pos = order.indexOf(s) + 1;
  const status = s.status === 'ok' ? (s.sleeping ? 'asleep' : s.combat ? 'fighting' : 'fit') : s.status;
  const needs = ([...NEED_IDS.map((k) => [k, s.needs[k]] as [string, number]), ['morale', s.morale], ['stress', s.stress]] as [string, number][]).filter(([k]) => SHOWN_NEEDS.indexOf(k) >= 0);
  $('pbody').innerHTML = `
    <div class="ph"><b>${s.name}</b> <span class="rank">${CFG.RANKS[s.rank]}${pos ? ' · #' + pos + ' in command' : ''}</span></div>
    <div class="traits">${s.traits.map((t) => `<span class="tag">${TRAIT_FX[t].label}</span>`).join('')}${s.injuries.map((i) => `<span class="tag bad">${CFG.INJURIES[i].label}</span>`).join('')}${s.sick > 0 ? `<span class="tag bad">${CFG.SICKNESS[s.sickKind]?.label || 'Sick'}</span>` : ''}${s.hangover > w.tick ? '<span class="tag bad">Hungover</span>' : ''}</div>
    <div class="row">HP ${Math.round(s.hp)}/${s.maxHp} · ${status} · ammo ${s.mag + s.ammo} · ${s.guns.map((g) => `${g.type} ${Math.round(g.cond)}%`).join(', ') || 'unarmed'} · purse ${Math.round(s.purse)}</div>
    <div class="row">🎒 pocket food: ${pocketPts(s) > 0 ? `<b>${Math.round(pocketPts(s))} pts</b> (${Object.entries(s.pocket).filter(([, v]) => (v || 0) > 0).map(([k, v]) => `${v} ${k === 'smoked' ? 'jerky' : k}`).join(', ')})` : 'none'}</div>
    <div class="row"><b>Doing:</b> ${s.act ? s.act.label : '—'}</div>
    <div class="row"><b>Thinking:</b> <i>${s.thought || s.why || '—'}</i></div>
    <div class="needs">${needs.map(([k, v]) => `<div><span class="nl">${k === 'rest' ? 'sleep' : k}</span>${bar(v, NEED_COL[k])}<span class="nv">${Math.round(v)}</span></div>`).join('')}</div>
    <div class="row mood">${s.thoughts.map((t) => `<span class="${t.v < 0 ? 'neg' : 'pos'}">${t.text} ${t.v > 0 ? '+' : ''}${t.v}</span>`).join(' ')}</div>
    <canvas id="chart" width="600" height="150"></canvas>
    <div class="row small">Skills: ${Object.entries(s.skills).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}</div>`;
  drawChart(s);
}
function drawChart(s: Scout): void {
  const c = document.getElementById('chart') as HTMLCanvasElement | null; if (!c) return; const g = c.getContext('2d')!;
  g.fillStyle = '#1c2026'; g.fillRect(0, 0, c.width, c.height);
  const H = s.hist; if (H.length < 2) { g.fillStyle = '#888'; g.font = '20px system-ui'; g.fillText('needs timeline fills in hourly', 12, 40); return; }
  const t0 = H[0][0], t1 = H[H.length - 1][0] || t0 + 1;
  // night bands
  for (let t = t0; t < t1; t += CFG.DAY_TICKS / 24) { const hh = hourOf(t); if (hh >= 20 || hh < 6) { g.fillStyle = 'rgba(80,90,160,.18)'; g.fillRect(((t - t0) / (t1 - t0)) * c.width, 0, c.width / ((t1 - t0) / (CFG.DAY_TICKS / 24)) + 1, c.height); } }
  const keys = [...NEED_IDS, 'morale', 'stress'];
  keys.forEach((k, ki) => { if (SHOWN_NEEDS.indexOf(k) < 0) return; g.strokeStyle = NEED_COL[k]; g.lineWidth = k === 'morale' ? 3 : 1.5; g.beginPath(); H.forEach((r, i) => { const x = ((r[0] - t0) / (t1 - t0)) * c.width, y = c.height - (r[ki + 1] / 100) * (c.height - 6) - 3; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); });
}
let logSeen = 0;
function pumpLog(): void {
  const el = $('log'); const L = w.log; const lastN = L.length ? L[L.length - 1].n : 0;
  if (lastN < logSeen) logSeen = 0;   // a different world was loaded
  if (lastN === logSeen) return;
  const frag = document.createDocumentFragment();
  for (const l of L) {
    if (l.n <= logSeen) continue; if (l.kind === 'bark' && speed > 4) continue;
    if (l.who === 'Boat' && /drops anchor/.test(l.text)) sfx('horn');
    const d = document.createElement('div'); d.className = 'l ' + l.kind; d.textContent = `${clockStr(l.t)} ${l.who}: ${l.text}`; frag.appendChild(d);
  }
  logSeen = lastN; el.appendChild(frag);
  while (el.childNodes.length > 300) el.removeChild(el.firstChild!);
  el.scrollTop = el.scrollHeight;
  const lastImportant = [...L].reverse().find((l) => l.kind !== 'bark'); if (lastImportant) $('ticker').textContent = `${lastImportant.who}: ${lastImportant.text}`;
}
function menuHtml(): string {
  const st = w.stats; const order = chainOrder(w); const T = st.team;
  return `<h4>${COMPANY_NAME}</h4>
  <div><b>Chain of command</b><br>${order.map((s, i) => `${i + 1}. ${CFG.RANKS[s.rank]} ${s.name}${s.status !== 'ok' ? ' (' + s.status + ')' : ''}`).join('<br>')}</div>
  <div><b>Score (profit):</b> ${Math.round(w.ledger.income - w.ledger.spending)} cr · account ${Math.round(w.ledger.credits)} · camp cash ${Math.round(w.ledger.cash)} (commander keeps ~${Math.round(cashTarget(w))})</div>
  <div><b>Stats:</b> Roukha killed ${st.birdKills} · beaks sold ${st.beaksSold} · downs ${st.downs} · rescues ${st.rescues} · deaths ${st.deaths} · boats ${st.boatsDone}</div>
  <div><b>Teams:</b> ${T.departed} trips out (${T.solo} alone) · ${T.now} came at once · ${T.promise} "gimme a sec" · ${T.helpFirst} "help me first" · ${T.assists} hands lent in camp</div>
  <div><b>Stores:</b> ${Object.entries(w.camp.stock).filter(([, v]) => (v || 0) >= 1).map(([k, v]) => `${k} ${Math.floor(v || 0)}`).join(' · ')}</div>
  <div><b>Built:</b> ${Object.entries(w.camp.builds).filter(([, b]) => b.built).map(([k]) => BLAB[k] || k).join(', ') || 'bedrolls round a fire'}</div>
  <div><b>Plan:</b> ${w.plan.goals.slice(0, 8).map((g) => g.label).join(' · ')}</div>
  <hr><div>Island seed <input id="seed" inputmode="numeric"> <button id="newgame">New game</button></div>
  <div class="small">Tap a scout to follow him. Drag to look around, pinch to zoom. The sim runs on your phone and autosaves every 30 s.</div>`;
}
boot();
