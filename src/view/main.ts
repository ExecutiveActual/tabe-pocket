// Tabe Pocket viewer: runs the deterministic sim live in the browser and draws it with Canvas 2D.
// Phone-first: drag to pan, pinch to zoom, tap a scout for his panel. The sim never touches the DOM.
import { createWorld, step, save, load, cashTarget } from '../sim/world';
import { CFG, NEED_IDS, COMPANY_NAME, TRAIT_FX, SQUADS, FEATURES } from '../sim/config';
import { World, Scout, hourOf, dayOf, clockStr, isDark, T } from '../sim/core';
import { chainOrder, commander, foodPoints, stock } from '../sim/ai';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const cv = $('cv') as HTMLCanvasElement; const ctx = cv.getContext('2d')!;
const SAVE_KEY = 'tabe-pocket-save-v1';
const params = new URLSearchParams(location.search);
void FEATURES;

let w: World;
let speed = 1, selected = -1, follow = true, muted = true, mapView = false, savedZ = 4;
let cam = { x: 0, y: 0, z: 3 };  // world metres at screen centre, pixels per metre
let terrainCv: HTMLCanvasElement, fogCv: HTMLCanvasElement, fogAt = -1;

function newWorld(seed: number): void {
  w = createWorld(seed); selected = -1; terrainCv = drawTerrain(); fogAt = -1;
  cam.x = w.landing.x; cam.y = w.landing.y; cam.z = 7;
  ($('seed') as HTMLInputElement).value = String(seed);
  logSeen = 0; $('log').innerHTML = '';
}
function boot(): void {
  const s = params.get('seed');
  let saved: string | null | false = false; try { saved = !s && localStorage.getItem(SAVE_KEY); } catch { /* storage blocked (private mode / sandboxed frame): no resume */ }
  if (saved) { try { w = load(saved); terrainCv = drawTerrain(); cam.x = w.camp.sited ? w.camp.x : w.landing.x; cam.y = w.camp.sited ? w.camp.y : w.landing.y; ($('seed') as HTMLInputElement).value = String(w.seed); } catch { newWorld(1); } }
  else newWorld(Number(s || 1));
  const d = Number(params.get('day') || 0); const hh = Number(params.get('hour') || 0);
  if (d || hh) { const target = (d ? (d - 1) : 0) * CFG.DAY_TICKS + ((hh || CFG.START_HOUR) - CFG.START_HOUR) * (CFG.DAY_TICKS / 24); while (w.tick < target) step(w); }
  if (params.get('speed')) speed = Number(params.get('speed'));
  if (params.get('pick') === 'fight') { const p = w.scouts.find((x) => x.combat) || w.scouts.find((x) => x.threat); if (p) { selected = p.id; cam.x = p.x; cam.y = p.y; } }
  else if (params.get('pick')) { const p = w.scouts.find((x) => x.name === params.get('pick')); if (p) { selected = p.id; cam.x = p.x; cam.y = p.y; } }
  else if (d || hh) { cam.x = w.camp.sited ? w.camp.x : cam.x; cam.y = w.camp.sited ? w.camp.y : cam.y; }
  if (params.get('panel') === '0') { selected = -1; }
  if (params.get('zoom')) cam.z = Number(params.get('zoom'));
  setSpeedButtons(); resize(); showPanel(); requestAnimationFrame(frame);
}

// ---------- terrain and fog ----------
const TCOL = ['#2a5d7c', '#d9c58b', '#7aa35a', '#3f6b3a', '#8a8580', '#4a86a8', '#5b9cc0', '#c4a064', '#506e50', '#8c8264'];  // by terrain id (see core T)
function drawTerrain(): HTMLCanvasElement {
  const n = w.map.n; const c = document.createElement('canvas'); c.width = n; c.height = n;
  const g = c.getContext('2d')!; const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const col = TCOL[w.map.terrain[i]]; const v = ((i * 2654435761) >>> 28) - 8; // tiny texture
    img.data[i * 4] = clamp255(parseInt(col.slice(1, 3), 16) + v); img.data[i * 4 + 1] = clamp255(parseInt(col.slice(3, 5), 16) + v); img.data[i * 4 + 2] = clamp255(parseInt(col.slice(5, 7), 16) + v); img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function clamp255(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v; }
function drawFog(): void {
  const n = w.map.n; if (!fogCv) { fogCv = document.createElement('canvas'); fogCv.width = n; fogCv.height = n; }
  const g = fogCv.getContext('2d')!; const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { img.data[i * 4 + 3] = w.map.seen[i] ? 0 : 200; img.data[i * 4] = 18; img.data[i * 4 + 1] = 22; img.data[i * 4 + 2] = 28; }
  g.putImageData(img, 0, 0);
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
  if (pts.size === 1) { const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy); if (moved > 6) { cam.x -= dx / cam.z; cam.y -= dy / cam.z; follow = false; } }
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); cam.z = Math.max(0.8, Math.min(14, z0 * d / pinch0)); moved = 99; }
});
cv.addEventListener('pointerup', (e) => {
  pts.delete(e.pointerId);
  if (moved <= 6 && pts.size === 0) { // tap: pick nearest scout
    const [x, y] = toWorld(e.clientX, e.clientY); let best: Scout | null = null, bd = 20 / cam.z + 2;
    for (const s of w.scouts) { if (s.status === 'dead' && s.shipped) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
    selected = best ? best.id : -1; if (best) follow = true; showPanel();
  }
});
cv.addEventListener('wheel', (e) => { cam.z = Math.max(0.8, Math.min(14, cam.z * (e.deltaY < 0 ? 1.15 : 0.87))); e.preventDefault(); }, { passive: false });

// ---------- controls ----------
function setSpeedButtons(): void { document.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed)); }
document.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => { speed = Number(b.dataset.speed); setSpeedButtons(); audioInit(); }));
$('mute').addEventListener('click', () => { muted = !muted; $('mute').textContent = muted ? '🔇' : '🔊'; audioInit(); });
$('logbtn').addEventListener('click', () => { const l = $('logwrap'); if (!l.classList.contains('open')) l.classList.add('open'); else if (!l.classList.contains('big')) l.classList.add('big'); else l.classList.remove('open', 'big'); });
$('menubtn').addEventListener('click', () => { $('menu').classList.toggle('open'); renderMenu(); });
$('newgame').addEventListener('click', () => { const s = Number(($('seed') as HTMLInputElement).value) || ((Date.now() / 1000) | 0); try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ } newWorld(s); $('menu').classList.remove('open'); });
$('follow').addEventListener('click', () => { follow = true; if (mapView) toggleMap(); });
$('mapbtn').addEventListener('click', () => toggleMap());
function toggleMap(): void {
  mapView = !mapView;
  if (mapView) { savedZ = cam.z; follow = false; const span = w.map.n * CFG.TILE_M; cam.x = span / 2; cam.y = span / 2; cam.z = Math.min(innerWidth, innerHeight) / span * 0.95; }
  else { cam.z = savedZ; follow = true; }
  $('mapbtn').classList.toggle('on', mapView);
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
  while (acc >= 1 && n < 400) { step(w); acc -= 1; n++; }
  if (n >= 400) acc = 0;
  if (w.stats.shots > prevShots) { const d = w.stats.shots - prevShots; prevShots = w.stats.shots; if (speed <= 4) sfx('shot', Math.min(1, 0.4 + d * 0.2)); }
  if (w.stats.charges > prevCharges) { prevCharges = w.stats.charges; sfx('call'); }
  if (speed <= 4 && w.scouts.some((s) => s.act && (s.act.kind === 'chop' || s.act.kind === 'fell') && s.posture === 'crouch' && w.tick % 12 === 0)) sfx('chop', 0.4);
  if (w.tick - fogAt > 20 || fogAt < 0) { drawFog(); fogAt = w.tick; }
  if (follow) {
    const s = selected >= 0 ? w.scouts.find((x) => x.id === selected) : undefined;
    const [fx, fy] = s ? [s.x, s.y] : squadCentre();
    cam.x += (fx - cam.x) * 0.12; cam.y += (fy - cam.y) * 0.12;
  }
  $('follow').classList.toggle('on', follow);
  draw(); hud(); pumpLog();
  if (selected >= 0 && w.tick % 5 === 0) showPanel();
  if (now - lastSave > 30000) { lastSave = now; try { localStorage.setItem(SAVE_KEY, save(w)); } catch { /* storage full: skip */ } }
  requestAnimationFrame(frame);
}

/** Centre of the squad: the men who are up and about, or the commander if they're spread wide. */
function squadCentre(): [number, number] {
  const up = w.scouts.filter((s) => s.status !== 'dead');
  if (!up.length) return [cam.x, cam.y];
  let x = 0, y = 0; for (const s of up) { x += s.x; y += s.y; } x /= up.length; y /= up.length;
  const spread = Math.max(...up.map((s) => Math.hypot(s.x - x, s.y - y)));
  if (spread * cam.z > Math.min(innerWidth, innerHeight) * 0.45) { const c = commander(w) || up[0]; return [c.x, c.y]; }
  return [x, y];
}
// ---------- drawing ----------
function draw(): void {
  const d = window.devicePixelRatio || 1; ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = '#1d4a66'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.save(); ctx.translate(midX(), midY()); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
  const M = CFG.TILE_M, n = w.map.n;
  ctx.imageSmoothingEnabled = false; ctx.drawImage(terrainCv, 0, 0, n * M, n * M);
  const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(innerWidth, innerHeight);
  const vis = (x: number, y: number, r = 4): boolean => x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r;
  const seen = (x: number, y: number): boolean => !!w.map.seen[Math.floor(y / M) * n + Math.floor(x / M)];
  // landing and boat
  if (w.boat.state === 'docked') { const bx = w.landing.x + w.landing.sx * 14, by = w.landing.y + w.landing.sy * 14; ctx.fillStyle = '#5a3d22'; ellipse(bx, by, 7, 3, Math.atan2(w.landing.sy, w.landing.sx) + Math.PI / 2); ctx.fillStyle = '#eee'; ctx.fillRect(bx - 1, by - 5, 2, 4); }
  // camp
  if (w.camp.sited) {
    const c = w.camp;
    ctx.strokeStyle = 'rgba(255,240,200,.25)'; ctx.lineWidth = 0.3; ctx.setLineDash([1, 1]); circle(c.x, c.y, 14, false); ctx.setLineDash([]);
    for (const k in c.builds) { const b = c.builds[k]; if (!b.built && b.progress <= 0) continue; ctx.globalAlpha = b.built ? 1 : 0.4; ctx.fillStyle = BCOL[k] || '#a08060'; ctx.fillRect(b.x - 1.6, b.y - 1.2, 3.2, 2.4); ctx.globalAlpha = 1; if (cam.z > 5) label(BLAB[k] || k, b.x, b.y + 2.4, '#ddd', 2.2); }
    if (c.builds.palisade && c.builds.palisade.built) { ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 0.8; circle(c.x, c.y, 16, false); }
    if (c.latrine.built) { ctx.fillStyle = '#6b5a3a'; ctx.fillRect(c.latrine.x - 0.8, c.latrine.y - 0.8, 1.6, 1.6); }
    ctx.fillStyle = '#8b6b3e'; ctx.fillRect(c.pile.x - 1.2, c.pile.y - 0.8, 2.4, 1.6);
    ctx.fillStyle = '#4b6f8a'; circle(c.cask.x, c.cask.y, 0.7);
    for (const s of w.scouts) if (s.status !== 'dead') { const k = s.id % 8; const ring = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]]; ctx.fillStyle = '#7a6a4a'; ellipse(c.fire.x + ring[k][0] * 3.2, c.fire.y + ring[k][1] * 3.2, 0.9, 0.45, Math.atan2(ring[k][1], ring[k][0])); }
    if (c.fire.built) { const lit = c.fire.fuel > 0; ctx.fillStyle = '#555'; circle(c.fire.x, c.fire.y, 1.1); if (lit) { const f = 0.7 + 0.15 * Math.sin(performance.now() / 90); ctx.fillStyle = '#ff9a2a'; circle(c.fire.x, c.fire.y, f); ctx.fillStyle = '#ffe07a'; circle(c.fire.x, c.fire.y, f * 0.45); } }
  }
  // flora
  for (const t of w.trees) { if (!vis(t.x, t.y) || !seen(t.x, t.y)) continue; if (t.felled) { ctx.fillStyle = '#6b4f2e'; circle(t.x, t.y, 0.5); } else { ctx.fillStyle = '#2d5a2a'; circle(t.x, t.y, 0.9 + t.size * 0.35); ctx.fillStyle = '#3d7a37'; circle(t.x - 0.3, t.y - 0.3, 0.5 + t.size * 0.2); } }
  for (const b of w.bushes) { if (!vis(b.x, b.y) || !seen(b.x, b.y)) continue; ctx.fillStyle = '#4f7f3a'; circle(b.x, b.y, 0.8); if (b.berries >= 1) { ctx.fillStyle = '#c03a4a'; circle(b.x + 0.3, b.y - 0.2, 0.22); circle(b.x - 0.3, b.y + 0.1, 0.22); } }
  for (const r of w.rookeries) if (seen(r.x, r.y)) { ctx.strokeStyle = 'rgba(200,60,40,.6)'; ctx.lineWidth = 0.4; circle(r.x, r.y, CFG.ROOKERY_GUARD_M, false); ctx.fillStyle = '#7a5a3a'; circle(r.x, r.y, 2.5); if (r.eggs) { ctx.fillStyle = '#f2ead0'; for (let i = 0; i < Math.min(r.eggs, 6); i++) circle(r.x - 1.2 + (i % 3) * 1.2, r.y - 0.5 + Math.floor(i / 3), 0.35); } }
  for (const c of w.carcasses) { if (!vis(c.x, c.y)) continue; ctx.fillStyle = c.kind === 'deer' ? '#7a5a3a' : '#5a2a2a'; ellipse(c.x, c.y, 1.1, 0.6, 0.4); }
  for (const g of w.signs) { if (!vis(g.x, g.y) || cam.z < 4) continue; ctx.fillStyle = g.kind === 'blood' ? '#a01818' : 'rgba(60,40,30,.7)'; circle(g.x, g.y, 0.18); }
  // animals
  for (const d of w.deer) { if (d.state === 'dead' || !vis(d.x, d.y) || !seen(d.x, d.y)) continue; ctx.fillStyle = '#9a6b3e'; ellipse(d.x, d.y, 0.9, 0.5, Math.atan2(d.ty - d.y, d.tx - d.x)); }
  for (const b of w.birds) {
    if (b.state === 'dead' || !vis(b.x, b.y)) continue;
    const near = w.scouts.some((s) => s.status !== 'dead' && Math.hypot(s.x - b.x, s.y - b.y) < (isDark(hourOf(w.tick)) ? CFG.SCOUT_SIGHT_NIGHT_M : CFG.SCOUT_SIGHT_DAY_M));
    if (!near) continue;
    const sz = b.age === 'B' ? 1.6 : b.age === 'A' ? 1.25 : 0.9; const a = Math.atan2(b.fy, b.fx);
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
    ctx.fillStyle = b.state === 'charge' ? '#b02a1a' : '#4a2a22'; ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8c040'; ctx.beginPath(); ctx.moveTo(sz * 0.8, -sz * 0.25); ctx.lineTo(sz * 1.8, 0); ctx.lineTo(sz * 0.8, sz * 0.25); ctx.fill();
    ctx.restore();
    if (b.bleeding) { ctx.fillStyle = '#d01010'; circle(b.x, b.y + sz, 0.2); }
  }
  // bullets
  ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 0.25; for (const b of w.bullets) { ctx.beginPath(); ctx.moveTo(b.x - b.dx * 2.5, b.y - b.dy * 2.5); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  // scouts: little top-down men (hat + rifle). Squads differ by colour AND hat shape.
  for (const s of w.scouts) {
    if (s.status === 'dead' && s.shipped) continue;
    if (s.id === selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.25; circle(s.x, s.y, 1.9, false); }
    drawMan(s);
    if (s.carcassMode === 'drag') { ctx.fillStyle = '#5a2a2a'; ellipse(s.x - s.fx * 2.2, s.y - s.fy * 2.2, 1.1, 0.6, Math.atan2(s.fy, s.fx)); }
    if (s.sleeping) label('z', s.x + 1.2, s.y - 1.2, '#cde', 1.6);
  }
  // labels above heads (short thinking label) and names, readable at phone zoom
  if (cam.z >= 2.2) for (const s of w.scouts) {
    if (s.status === 'dead' && s.shipped) continue;
    const tag = shortLabel(s);
    label(tag.text, s.x, s.y - 2.0, tag.col, 1.45);
    if (cam.z >= 3.5) label(s.name + (s === commander(w) ? ' ★' : ''), s.x, s.y + 2.6, '#fff', 1.25);
  }
  // night: darkness with light around the fire and a little around each man
  const h = hourOf(w.tick); const dark = nightAlpha(h) + (w.weather === 'storm' ? 0.15 : w.weather === 'rain' ? 0.08 : 0);
  ctx.globalAlpha = 1; ctx.drawImage(fogCv, 0, 0, n * M, n * M);
  ctx.restore();
  if (dark > 0.02) drawNight(Math.min(0.75, dark));
  if (w.weather === 'rain' || w.weather === 'storm') { ctx.strokeStyle = 'rgba(180,200,255,.25)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < (w.weather === 'storm' ? 120 : 60); i++) { const x = (i * 97 + w.tick * 7) % innerWidth, y = (i * 53 + w.tick * 23) % innerHeight; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 9); } ctx.stroke(); }
  if (w.weather === 'fog') { ctx.fillStyle = 'rgba(220,225,230,.25)'; ctx.fillRect(0, 0, innerWidth, innerHeight); }
  // speech bubbles (screen space, so they stay readable)
  ctx.font = '12px -apple-system, system-ui, sans-serif';
  for (const s of w.scouts) {
    if (s.status === 'dead' || !s.bark || s.barkUntil < w.tick) continue;
    const sx = (s.x - cam.x) * cam.z + midX(), sy = (s.y - cam.y) * cam.z + midY() - 26 - cam.z * 1.2;
    if (sx < -100 || sx > innerWidth + 100 || sy < -40 || sy > innerHeight + 40) continue;
    const text = s.bark.length > 46 ? s.bark.slice(0, 44) + '…' : s.bark; const tw = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(255,250,235,.93)'; roundRect(sx - tw / 2, sy - 20, tw, 18, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx - 4, sy - 2); ctx.lineTo(sx, sy + 4); ctx.lineTo(sx + 4, sy - 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.fillText(text, sx, sy - 7);
  }
  if (w.over) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, innerHeight / 2 - 40, innerWidth, 80); ctx.fillStyle = '#fff'; ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center'; ctx.fillText(w.over === 'wiped' ? 'The company is dead.' : 'The company is bankrupt.', innerWidth / 2, innerHeight / 2 + 8); }
}
const MAN_SCALE = 1.4;  // men drawn a bit larger than life so they read on a phone
/** A scout as a small top-down man: shoulders in squad colour, head, hat (squad shape) and a rifle. */
function drawMan(s: Scout): void {
  const sq = SQUADS[s.squad % SQUADS.length]; const a = Math.atan2(s.fy, s.fx);
  ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a); ctx.scale(MAN_SCALE, MAN_SCALE);
  if (s.status === 'dead') { ctx.fillStyle = '#d8d0c0'; ctx.fillRect(-1.1, -0.45, 2.2, 0.9); ctx.restore(); return; }
  if (s.status === 'downed') { ctx.fillStyle = '#7a1a1a'; ctx.beginPath(); ctx.ellipse(0, 0, 1.3, 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
  if (s.sleeping) { ctx.fillStyle = '#6a5a3a'; ctx.beginPath(); ctx.ellipse(-0.3, 0, 1.3, 0.7, 0, 0, Math.PI * 2); ctx.fill(); }
  // rifle: forward when fighting, slung across the back otherwise
  ctx.strokeStyle = '#2a1f14'; ctx.lineWidth = 0.22; ctx.beginPath();
  if (s.combat) { ctx.moveTo(0.1, 0.45); ctx.lineTo(1.9, 0.3); } else { ctx.moveTo(-0.7, -0.6); ctx.lineTo(-0.2, 0.75); }
  ctx.stroke();
  // shoulders
  ctx.fillStyle = s.status === 'downed' ? '#b04040' : sq.color; ctx.beginPath(); ctx.ellipse(0, 0, 0.55, 0.9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 0.12; ctx.stroke();
  // hat
  ctx.fillStyle = '#5a4630';
  if (sq.hat === 'brim') { ctx.beginPath(); ctx.arc(0.05, 0, 0.62, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#7a6040'; ctx.beginPath(); ctx.arc(0.05, 0, 0.34, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.fillStyle = '#d8d0b0'; ctx.beginPath(); ctx.ellipse(0.1, 0, 0.6, 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#b0a888'; ctx.fillRect(0.05, -0.08, 0.5, 0.16); }
  ctx.restore();
}
const SHORT: Record<string, string> = { eat: 'eating', drink: 'drinking', sleep: 'asleep', watch: 'on watch', chop: 'firewood', fell: 'timber', forage: 'foraging', cook: 'cooking', fuel: 'fire', build: 'building', fetchWater: 'water run', hunt: 'hunting', rhunt: 'tracking', loot: 'loot', process: 'butchering', unpack: 'unpacking', unload: 'hauling', load: 'loading', meetBoat: 'trading', rescue: 'rescue!', treat: 'patching up', buddy: 'escort', idle: 'resting', explore: 'scouting', warm: 'warming up', scrape: 'hides' };
function shortLabel(s: Scout): { text: string; col: string } {
  if (s.status === 'dead') return { text: 'dead', col: '#bbb' };
  if (s.status === 'downed') return { text: 'DOWN', col: '#ff6a6a' };
  if (s.combat) return { text: 'fighting!', col: '#ffb040' };
  if (s.status === 'recovering') return { text: 'recovering', col: '#ffb0b0' };
  const k = s.act ? s.act.kind : 'idle';
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
  for (const s of w.scouts) if (s.status !== 'dead') hole(s.x, s.y, 6, 0.55);
  ctx.drawImage(nightCv, 0, 0, innerWidth, innerHeight);
  if (lit) { const [sx, sy] = S(w.camp.fire.x, w.camp.fire.y); const r = CFG.FIRE_LIGHT_M * 0.8 * cam.z * flick; const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r); gr.addColorStop(0, `rgba(255,170,70,${0.35 * alpha / 0.75})`); gr.addColorStop(1, 'rgba(255,120,40,0)'); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
}
function nightAlpha(h: number): number { if (h >= 20 || h < 5) return 0.62; if (h >= 18) return ((h - 18) / 2) * 0.62; if (h < 7) return ((7 - h) / 2) * 0.62; return 0; }

const BCOL: Record<string, string> = { shelter: '#8a7a5a', barrel: '#4b6f8a', racks: '#9a7a4a', butcher: '#8a4a3a', shed: '#7a6040', mess: '#c8b890', tower: '#6a5030', palisade: '#6b4a2a' };
const BLAB: Record<string, string> = { shelter: 'fire shelter', barrel: 'rain barrel', racks: 'drying racks', butcher: 'butchering', shed: 'shed', mess: 'mess tent', tower: 'watchtower', palisade: 'palisade' };
function circle(x: number, y: number, r: number, fill = true): void { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); if (fill) ctx.fill(); else ctx.stroke(); }
function ellipse(x: number, y: number, rx: number, ry: number, a: number): void { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); ctx.fill(); }
function label(t: string, x: number, y: number, col: string, size: number): void { ctx.save(); ctx.font = `${size}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = size * 0.18; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y); ctx.restore(); }
function roundRect(x: number, y: number, ww: number, hh: number, r: number): void { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath(); }

// ---------- HUD, panel, log ----------
const WEATHER_ICON: Record<string, string> = { clear: '☀️', rain: '🌧', storm: '⛈', fog: '🌫' };
function hud(): void {
  const h = hourOf(w.tick);
  const icon = isDark(h) ? '🌙' : WEATHER_ICON[w.weather] || '';
  const alive = w.scouts.filter((s) => s.status !== 'dead').length;
  const money = Math.round(w.ledger.credits + w.ledger.cash);
  const boat = w.boat.state === 'docked' ? 'at the landing' : `in ${Math.max(0, (w.boat.nextArrive - w.tick) / CFG.DAY_TICKS).toFixed(1)} d`;
  const foodDays = foodPoints(w) / Math.max(1, alive * CFG.FOOD_PER_DAY);
  const ammo = Math.round(stock(w, 'ammo') + w.scouts.reduce((t, s) => t + (s.status !== 'dead' ? s.ammo + s.mag : 0), 0));
  $('clock').textContent = `Day ${dayOf(w.tick)} ${clockStr(w.tick)} ${icon}`;
  $('season').textContent = CFG.SEASONS[w.season];
  $('money').textContent = `💰 ${money} cr`;
  $('boat').textContent = `⛵ ${boat}`;
  $('food').textContent = `🍖 ${foodDays.toFixed(1)} d`;
  $('ammo').textContent = `🔫 ${ammo}`;
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
function renderMenu(): void {
  const st = w.stats; const order = chainOrder(w);
  $('stats').innerHTML = `<h3>${COMPANY_NAME}</h3>
  <div><b>Chain of command</b><br>${order.map((s, i) => `${i + 1}. ${CFG.RANKS[s.rank]} ${s.name}${s.status !== 'ok' ? ' (' + s.status + ')' : ''}`).join('<br>')}</div>
  <div><b>Score (profit):</b> ${Math.round(w.ledger.income - w.ledger.spending)} cr · account ${Math.round(w.ledger.credits)} · camp cash ${Math.round(w.ledger.cash)} (commander keeps ~${Math.round(cashTarget(w))})</div>
  <div><b>Stats:</b> Roukha killed ${st.birdKills} · beaks sold ${st.beaksSold} · deer ${st.deerKills} · downs ${st.downs} · rescues ${st.rescues} · deaths ${st.deaths} · boats ${st.boatsDone}</div>
  <div><b>Stores:</b> ${Object.entries(w.camp.stock).filter(([, v]) => (v || 0) >= 1).map(([k, v]) => `${k} ${Math.floor(v || 0)}`).join(' · ')}</div>
  <div><b>Built:</b> ${Object.entries(w.camp.builds).filter(([, b]) => b.built).map(([k]) => BLAB[k] || k).join(', ') || 'bedrolls round a fire'}</div>
  <div><b>Plan:</b> ${w.plan.goals.slice(0, 8).map((g) => g.label).join(' · ')}</div>`;
}
boot();
