// Headless run: `npx tsx scripts/summary.ts [seed] [days] [-v]` prints the daily needs report and a final summary.
import { createWorld, step, summaryLine } from '../src/sim/world';
import { CFG, NEED_IDS, COMPANY_NAME, TRAIT_FX } from '../src/sim/config';
import { clockStr, dayOf } from '../src/sim/core';
import { chainOrder } from '../src/sim/ai';

const seed = Number(process.argv[2] || 1), days = Number(process.argv[3] || 3);
const verbose = process.argv.includes('-v');
const w = createWorld(seed, {});
const t0 = Date.now();
let seenLog = 0;
for (let i = 0; i < days * CFG.DAY_TICKS; i++) {
  step(w);
  if (verbose) { const last = w.log[w.log.length - 1]; let k = w.log.length - 1; while (k >= 0 && w.log[k].t >= seenLog && w.log[k].t === w.tick - 1) k--; for (const l of w.log.slice(k + 1)) console.log(`  [d${dayOf(l.t)} ${clockStr(l.t)}] ${l.who}: ${l.text}`); void last; seenLog = w.tick; }
}
console.log(`${COMPANY_NAME} | seed ${seed} | ${days} days | ${(Date.now() - t0) / 1000}s sim time`);
console.log('Chain of command: ' + chainOrder(w).map((s) => `${CFG.RANKS[s.rank]} ${s.name} [${s.traits.map((t) => TRAIT_FX[t].label).join(', ')}]`).join(' > '));
for (const d of w.stats.days) {
  console.log(`\n== Day ${d.day} needs report (21:00) | alive ${d.alive} | credits ${d.credits} | profit ${d.profit}`);
  console.log('   stock: ' + Object.entries(d.stock).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log('   ' + ''.padEnd(9) + 'END: ' + [...NEED_IDS, 'morale', 'stress'].map((k) => k.slice(0, 5).padStart(6)).join('') + '   DAY MIN: ' + [...NEED_IDS, 'morale'].map((k) => k.slice(0, 5).padStart(6)).join(''));
  for (const s of d.scouts) {
    if (s.status === 'dead') { console.log(`   ${s.name.padEnd(9)}DEAD`); continue; }
    console.log(`   ${s.name.padEnd(9)}     ` + [...NEED_IDS, 'morale', 'stress'].map((k) => String(s.end[k]).padStart(6)).join('') + '            ' + [...NEED_IDS, 'morale'].map((k) => String(s.min[k] ?? '-').padStart(6)).join('') + (s.status !== 'ok' ? ' ' + s.status : '') + (s.thoughts.length ? `  | ${s.thoughts.join(', ')}` : ''));
  }
}
const st = w.stats;
console.log('\n' + summaryLine(w));
console.log(`camp ready day 1: fire ${w.camp.readyTick.fire >= 0 ? clockStr(w.camp.readyTick.fire) : '-'}, latrine ${w.camp.readyTick.latrine >= 0 ? clockStr(w.camp.readyTick.latrine) : '-'}, wood pile ${w.camp.readyTick.wood >= 0 ? clockStr(w.camp.readyTick.wood) : '-'}; builds: ${Object.entries(w.camp.builds).filter(([, b]) => b.built).map(([k]) => k).join(', ') || 'none'}`);
console.log(`combat: shots ${st.shots} hits ${st.hits} Roukha killed ${st.birdKills} deer ${st.deerKills} downs ${st.downs} rescues ${st.rescues} deaths ${st.deaths} charges ${st.charges} withdraws ${st.withdraws} packs ${st.packsSpawned} Roukha hunts ${st.roukhaHunts}`);
console.log(`eaten ${JSON.stringify(st.eaten)} drinks ${st.drank} leisure hours ${JSON.stringify(Object.fromEntries(Object.entries(st.leisure).map(([k, v]) => [k, Math.round(v * 10) / 10])))}`);
console.log(`boats ${st.boatsDone} shipped ${JSON.stringify(w.ledger.shipped)} income ${Math.round(w.ledger.income)} spending ${Math.round(w.ledger.spending)} (wages ${st.wages})`);
console.log(`MONITORS stuck ${st.mon.stuck} idle ${st.mon.idle} oscillation ${st.mon.oscillation} lone ${st.mon.lone} exceptions ${st.mon.exceptions}`);
for (const n of st.mon.notes.slice(0, 12)) console.log('  ' + n);
console.log(`STATS birds killed ${st.birdKills}, beaks sold ${st.beaksSold}, deaths ${st.deaths}, account ${Math.round(w.ledger.credits)} cr, camp cash ${Math.round(w.ledger.cash)} cr, SCORE (profit) ${Math.round(w.ledger.income - w.ledger.spending)}${w.over ? ' | GAME OVER: ' + w.over : ''}`);
