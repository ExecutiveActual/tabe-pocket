// Long soak with a report:  npx tsx scripts/soak_report.ts [firstSeed] [seeds] [days]
// One line per seed, then a summary: survival and deaths, kills/day, Roukha packs (sizes, musters, retreats),
// fights (shots per kill, fight length), pocket meals, scout teams (solo trips, waits, deadlocks), monitors.
import { createWorld, runDays } from '../src/sim/world';
import { TPH } from '../src/sim/core';
const first = Number(process.argv[2] || 200), count = Number(process.argv[3] || 30), days = Number(process.argv[4] || 20);
const z = (): Record<string, number> => ({});
const tot: Record<string, number> = { deaths: 0, kills: 0, days: 0, shots: 0, hits: 0, req: 0, dep: 0, full: 0, smaller: 0, solo: 0, cancel: 0, wait: 0, waitN: 0, maxWait: 0, out: 0, soloOut: 0, dead: 0, now: 0, promise: 0, first: 0, assists: 0,
  lone: 0, stuck: 0, idle: 0, osc: 0, exc: 0, wiped: 0, profit: 0, drag: 0, dragAlone: 0, fog: 0, dshot: 0, musters: 0, hunts: 0, mcancel: 0, mdead: 0, rnow: 0, rprom: 0, rfirst: 0, retreats: 0, scatters: 0, returns: 0, flees: 0, defends: 0,
  fights: 0, fightT: 0, charges: 0, pocket: 0, pocketPts: 0, downs: 0, survived: 0, allAlive: 0 };
const sizes = z(); const deathHist = z();
const t0 = Date.now();
for (let seed = first; seed < first + count; seed++) {
  const w = createWorld(seed); runDays(w, days);
  const T = w.stats.team, m = w.stats.mon, Rk = w.stats.roukha, S = w.stats;
  const deaths = S.deaths; const profit = Math.round(w.ledger.income - w.ledger.spending);
  const add = (k: string, v: number): void => { tot[k] += v; };
  add('deaths', deaths); add('kills', S.birdKills); add('days', days); add('shots', S.shots); add('hits', S.hits); add('downs', S.downs); add('charges', S.charges);
  add('req', T.requests); add('dep', T.departed); add('full', T.full); add('smaller', T.smaller); add('solo', T.solo); add('cancel', T.cancelled);
  add('wait', T.waitTicks); add('waitN', T.departed + T.cancelled); tot.maxWait = Math.max(tot.maxWait, T.maxWait); add('out', T.outsideTicks); add('soloOut', T.soloOutsideTicks); add('dead', T.deadlocks);
  add('now', T.now); add('promise', T.promise); add('first', T.helpFirst); add('assists', T.assists); add('lone', m.lone); add('stuck', m.stuck); add('idle', m.idle); add('osc', m.oscillation); add('exc', m.exceptions);
  add('wiped', w.over ? 1 : 0); add('survived', w.over ? 0 : 1); add('allAlive', deaths === 0 && !w.over ? 1 : 0); add('profit', profit); add('drag', T.dragTicks); add('dragAlone', T.dragAloneTicks); add('fog', m.fogShots || 0); add('dshot', m.dragShots || 0);
  add('musters', Rk.musters); add('hunts', Rk.hunts); add('mcancel', Rk.musterCancel); add('mdead', Rk.deadlocks); add('rnow', Rk.now); add('rprom', Rk.promise); add('rfirst', Rk.helpFirst);
  add('retreats', Rk.retreats); add('scatters', Rk.scatters); add('returns', Rk.returns); add('flees', Rk.flees); add('defends', Rk.defends); add('fights', Rk.fights); add('fightT', Rk.fightTicks); add('pocket', S.pocketMeals); add('pocketPts', S.pocketPts);
  for (const k in Rk.packSizes) sizes[k] = (sizes[k] || 0) + Rk.packSizes[k];
  deathHist[deaths] = (deathHist[deaths] || 0) + 1;
  console.log(`${seed} alive ${w.scouts.filter((s) => s.status !== 'dead').length}/${w.scouts.length} deaths ${deaths} downs ${S.downs} over ${w.over || '-'} profit ${profit} kills ${S.birdKills} shots ${S.shots} | hunts ${Rk.hunts}/${Rk.musters} sizes ${JSON.stringify(Rk.packSizes)} retreats ${Rk.retreats} returns ${Rk.returns} defends ${Rk.defends} flees ${Rk.flees} | pocket ${S.pocketMeals} | teams ${T.departed} solo ${T.solo} deadlock ${T.deadlocks}/${Rk.deadlocks} | stuck ${m.stuck} osc ${m.oscillation} exc ${m.exceptions}`);
}
const h = (ticks: number): string => (ticks / TPH()).toFixed(2) + ' h';
const pct = (a: number, b: number): string => (100 * a / Math.max(1, b)).toFixed(1) + '%';
console.log(`\nSUMMARY ${count} seeds x ${days} days (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
console.log(`survival: ${tot.survived}/${count} camps alive at the end (${tot.allAlive} with nobody dead); games over ${tot.wiped}; deaths ${tot.deaths} (${(tot.deaths / count).toFixed(2)}/run), deaths per run ${JSON.stringify(deathHist)}; downs ${tot.downs}`);
console.log(`kills/day ${(tot.kills / tot.days).toFixed(2)}; shots ${tot.shots}, hits ${pct(tot.hits, tot.shots)}, shots per kill ${(tot.shots / Math.max(1, tot.kills)).toFixed(1)}; avg profit ${Math.round(tot.profit / count)}`);
console.log(`Roukha hunts: ${tot.hunts} set out from ${tot.musters} musters (${tot.mcancel} called off, ${tot.mdead} deadlocks); answers now ${tot.rnow}, gimme-a-sec ${tot.rprom}, help-me-first ${tot.rfirst}`);
const nP = Object.values(sizes).reduce((a, b) => a + b, 0); const avgP = Object.entries(sizes).reduce((a, [k, v]) => a + Number(k) * v, 0) / Math.max(1, nP);
console.log(`pack sizes ${JSON.stringify(sizes)} (avg ${avgP.toFixed(1)}); charges ${tot.charges}; nest defences ${tot.defends} (${tot.scatters} broke off); hunting packs retreated (fear) ${tot.retreats}; walked home ${tot.returns}; wounded birds fled ${tot.flees}`);
console.log(`fights ${tot.fights}, avg fight length ${(tot.fightT / Math.max(1, tot.fights) / 10).toFixed(1)} s sim (${h(tot.fightT / Math.max(1, tot.fights))} game time)`);
console.log(`pocket meals ${tot.pocket} (${(tot.pocket / tot.days).toFixed(2)}/day, ${Math.round(tot.pocketPts)} pts eaten out there)`);
console.log(`scout teams: ${tot.dep} departures (full ${tot.full}, smaller ${tot.smaller}, solo ${tot.solo} = ${pct(tot.solo, tot.dep)}), cancelled ${tot.cancel}; answers now ${tot.now}, gimme-a-sec ${tot.promise}, help-first ${tot.first}; assists ${tot.assists}`);
console.log(`avg wait ${h(tot.wait / Math.max(1, tot.waitN))}, max ${h(tot.maxWait)}, deadlocks ${tot.dead}; time outside alone ${pct(tot.soloOut, tot.out)} (lone trips ${tot.lone}); birds dragged alone ${pct(tot.dragAlone, tot.drag)}`);
console.log(`shots into fog ${tot.fog}, shots with a rope in hand ${tot.dshot}; monitors: stuck ${tot.stuck} idle ${tot.idle} osc ${tot.osc} exceptions ${tot.exc}`);
