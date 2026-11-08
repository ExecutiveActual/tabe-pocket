// Stability audit probes (v1.2.1): npx tsx scripts/audit.ts [probe...]
//   osc      - where the oscillation monitor fires (soak seeds 200-229 x 20 days)
//   spiral   - short-handed and wiped-out camps: no exceptions, no frozen world, clean game over
//   saveload - save/load at many moments (incl. mid-fight) continues bit-identically; save size over 60 days
//   perf     - ms per sim tick on the big island
import { createWorld, step, runTicks, save, load, hashWorld } from '../src/sim/world';
import { CFG } from '../src/sim/config';
import { World } from '../src/sim/core';
import { killScout } from '../src/sim/combat';
const probes = process.argv.slice(2); const want = (p: string): boolean => !probes.length || probes.includes(p);
const D = CFG.DAY_TICKS;

if (want('osc')) {
  const kinds: Record<string, number> = {};
  for (let seed = 200; seed < 230; seed++) {
    const w = createWorld(seed); runTicks(w, 20 * D);
    for (const n of w.stats.mon.notes) if (/^osc|^combat-flip/.test(n)) { const k = n.startsWith('combat') ? 'combat-flip' : 'osc ' + n.split(' ').pop(); kinds[k] = (kinds[k] || 0) + 1; }
  }
  console.log('oscillation notes by kind', kinds);
}
function finiteAll(o: unknown, out: string[], path = 'w'): void {
  if (typeof o === 'number') { if (!Number.isFinite(o)) out.push(path); return; }
  if (!o || typeof o !== 'object' || out.length > 5) return;
  for (const k of Object.keys(o as object)) if (k !== 'map') finiteAll((o as Record<string, unknown>)[k], out, path + '.' + k);
}
if (want('spiral')) {
  // camps that lose men early: the rest must keep living (or die / go bankrupt cleanly), never crash or freeze
  for (const lose of [2, 3, 4, 5]) for (let seed = 300; seed < 306; seed++) {
    const w = createWorld(seed); runTicks(w, Math.round(D * 1.2));
    for (const s of w.scouts.slice(0, lose)) if (s.status !== 'dead') killScout(w, s, 'audit');
    let ticks = 0; const bad: string[] = [];
    for (; ticks < 30 * D && !w.over; ticks++) step(w);
    finiteAll(w, bad);
    const alive = w.scouts.filter((s) => s.status !== 'dead');
    console.log(`lose ${lose} seed ${seed}: day ${Math.floor(w.tick / D) + 1} over=${w.over || '-'} alive ${alive.length} [${alive.map((s) => s.status + ':' + (s.act ? s.act.kind : '-')).join(' ')}] exc ${w.stats.mon.exceptions} stuck ${w.stats.mon.stuck} idle ${w.stats.mon.idle} nonfinite ${bad.join(',') || 0} funds ${Math.round(w.ledger.credits + w.ledger.cash)}`);
  }
}
if (want('saveload')) {
  let bad = 0, n = 0;
  for (let seed = 200; seed < 206; seed++) {
    const w = createWorld(seed);
    for (let d = 0; d < 6; d++) {
      runTicks(w, D - 977 + seed * 13);
      const fight = w.scouts.some((s) => s.combat);
      const b = load(save(w)); n++;
      if (hashWorld(b) !== hashWorld(w)) { bad++; console.log('hash differs right after load', seed, w.tick); }
      const c = load(save(w)); runTicks(c, 1500); const ref = load(save(w)); runTicks(ref, 1500);
      if (hashWorld(c) !== hashWorld(ref)) { bad++; console.log('diverged after load', seed, w.tick, fight); }
    }
  }
  console.log(`save/load: ${n} checkpoints, ${bad} mismatches`);
  const w = createWorld(77); const sizes: number[] = [];
  for (let d = 1; d <= 60; d++) { runTicks(w, D); if (d % 10 === 0) sizes.push(save(w).length); }
  const coolKeys = w.scouts.reduce((t, s) => t + Object.keys(s.cool).length, 0);
  console.log('save bytes at day 10..60', sizes.join(' '), '| notes', w.stats.mon.notes.length, '| cool keys', coolKeys, '| warned keys', Object.keys(w.plan.warned).length, '| intel', w.intel.length, 'signs', w.signs.length, 'packs', w.packs.length, 'carcasses', w.carcasses.length);
}
if (want('perf')) {
  const w: World = createWorld(5); runTicks(w, 2 * D);
  const t0 = performance.now(); runTicks(w, 3 * D); const ms = (performance.now() - t0) / (3 * D);
  console.log(`perf: ${(ms * 1000).toFixed(1)} us/tick (16x = 160 ticks/s -> ${(ms * 160).toFixed(1)} ms per real second)`);
}
