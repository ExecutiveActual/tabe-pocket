// Long soak with a team report:  npx tsx scripts/soak_report.ts [firstSeed] [seeds] [days]
// Prints one line per seed and a summary: deaths, kills/day, solo departures, time outside spent alone,
// average team wait, deadlocks, plus the stuck/idle/oscillation/exception monitors.
import { createWorld, runDays } from '../src/sim/world';
import { TPH } from '../src/sim/core';
const first = Number(process.argv[2] || 200), count = Number(process.argv[3] || 30), days = Number(process.argv[4] || 20);
const tot = { deaths: 0, kills: 0, days: 0, req: 0, dep: 0, full: 0, smaller: 0, solo: 0, cancel: 0, wait: 0, waitN: 0, maxWait: 0, out: 0, soloOut: 0, dead: 0, now: 0, promise: 0, first: 0, assists: 0, lone: 0, stuck: 0, idle: 0, osc: 0, exc: 0, wiped: 0, profit: 0, drag: 0, dragAlone: 0, fog: 0, dshot: 0 };
const t0 = Date.now();
for (let seed = first; seed < first + count; seed++) {
  const w = createWorld(seed); runDays(w, days);
  const T = w.stats.team, m = w.stats.mon;
  const deaths = w.stats.deaths; const profit = Math.round(w.ledger.income - w.ledger.spending);
  tot.deaths += deaths; tot.kills += w.stats.birdKills; tot.days += days; tot.req += T.requests; tot.dep += T.departed; tot.full += T.full; tot.smaller += T.smaller; tot.solo += T.solo; tot.cancel += T.cancelled;
  tot.wait += T.waitTicks; tot.waitN += T.departed + T.cancelled; tot.maxWait = Math.max(tot.maxWait, T.maxWait); tot.out += T.outsideTicks; tot.soloOut += T.soloOutsideTicks; tot.dead += T.deadlocks;
  tot.now += T.now; tot.promise += T.promise; tot.first += T.helpFirst; tot.assists += T.assists; tot.lone += m.lone; tot.stuck += m.stuck; tot.idle += m.idle; tot.osc += m.oscillation; tot.exc += m.exceptions; tot.wiped += w.over ? 1 : 0; tot.profit += profit; tot.drag += T.dragTicks; tot.fog += m.fogShots || 0; tot.dshot += m.dragShots || 0; tot.dragAlone += T.dragAloneTicks;
  console.log(`${seed} alive ${w.scouts.filter((s) => s.status !== 'dead').length} deaths ${deaths} over ${w.over || '-'} profit ${profit} kills ${w.stats.birdKills} beaks ${w.stats.beaksSold} | teams ${T.departed}/${T.requests} full ${T.full} smaller ${T.smaller} solo ${T.solo} cancel ${T.cancelled} now ${T.now} sec ${T.promise} first ${T.helpFirst} assists ${T.assists} | soloOut ${(100 * T.soloOutsideTicks / Math.max(1, T.outsideTicks)).toFixed(1)}% deadlock ${T.deadlocks} | lone ${m.lone} stuck ${m.stuck} idle ${m.idle} osc ${m.oscillation} exc ${m.exceptions}`);
}
const h = (ticks: number): string => (ticks / TPH()).toFixed(2) + ' h';
console.log(`\nSUMMARY ${count} seeds x ${days} days (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
console.log(`deaths ${tot.deaths} (${(tot.deaths / count).toFixed(2)}/run), games over ${tot.wiped}, kills/day ${(tot.kills / tot.days).toFixed(2)}, avg profit ${Math.round(tot.profit / count)}`);
console.log(`team requests ${tot.req}, departed ${tot.dep} (full ${tot.full}, smaller ${tot.smaller}, solo ${tot.solo} = ${(100 * tot.solo / Math.max(1, tot.dep)).toFixed(1)}% of departures), cancelled ${tot.cancel}`);
console.log(`answers: came now ${tot.now}, gimme-a-sec ${tot.promise}, help-me-first ${tot.first}; camp assists ${tot.assists}`);
console.log(`avg wait ${h(tot.wait / Math.max(1, tot.waitN))} (= ${(tot.wait / Math.max(1, tot.waitN) / 10).toFixed(0)} s at 1x), max wait ${h(tot.maxWait)}, deadlocks ${tot.dead}`);
console.log(`time outside the perimeter spent alone: ${(100 * tot.soloOut / Math.max(1, tot.out)).toFixed(1)}%  (lone-monitor trips ${tot.lone})`);
console.log(`birds dragged alone: ${(100 * tot.dragAlone / Math.max(1, tot.drag)).toFixed(1)}% of drag time (${tot.drag} drag ticks)`);
console.log(`shots into fog ${tot.fog}, shots fired while still holding a rope ${tot.dshot}`);
console.log(`monitors: stuck ${tot.stuck} idle ${tot.idle} osc ${tot.osc} exceptions ${tot.exc}`);
