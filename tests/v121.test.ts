// v1.2.1 stability fixes: immediate game over, bounded save state, follower pocket rations, flip-flops, extension seams.
import { describe, it, expect } from 'vitest';
import { createWorld, step, runTicks, save, load, hashWorld, issueCommand, COMMAND_HANDLERS } from '../src/sim/world';
import { CFG } from '../src/sim/config';
import { killScout } from '../src/sim/combat';
import { GOAL_SOURCES, JOB_MAKERS } from '../src/sim/ai';

const D = CFG.DAY_TICKS;

describe('game over', () => {
  it('a wiped-out company ends on the tick the last man dies, not at the next 06:00', () => {
    const w = createWorld(31); runTicks(w, Math.round(D * 1.3));   // mid-afternoon, day 2
    for (const s of w.scouts) if (s.status !== 'dead') killScout(w, s, 'test');
    const t = w.tick; step(w);
    expect(w.over).toBe('wiped');
    expect(w.tick).toBe(t + 1);
    step(w); expect(w.tick).toBe(t + 1);   // the world stops
  });
  it('a short-handed camp runs on with no exceptions or frozen men', () => {
    const w = createWorld(32); runTicks(w, Math.round(D * 1.2));
    for (const s of w.scouts.slice(0, 3)) killScout(w, s, 'test');
    for (let i = 0; i < 3 * D && !w.over; i++) step(w);
    expect(w.stats.mon.exceptions).toBe(0);
    expect(w.stats.mon.stuck).toBe(0);
  });
});

describe('bounded save state', () => {
  it('monitor notes are capped and expired goal cooldowns are pruned', () => {
    const w = createWorld(33);
    for (let i = 0; i < 1000; i++) w.stats.mon.notes.push('test note ' + i);
    w.scouts[0].cool['goal:test'] = 1; w.scouts[0].cool['test:keep'] = 1;
    runTicks(w, 700);   // passes an hour boundary
    expect(w.stats.mon.notes.length).toBeLessThanOrEqual(CFG.MON_NOTES_MAX);
    expect(w.scouts[0].cool['goal:test']).toBeUndefined();
    expect(w.scouts[0].cool['test:keep']).toBe(1);   // only 'goal:' keys are pruned (others are counters or other timers)
    const b = load(save(w)); runTicks(w, 500); runTicks(b, 500);
    expect(hashWorld(b)).toBe(hashWorld(w));
  });
});

describe('pocket rations', () => {
  it('men who go out as a leader\'s buddy pack trip food too', () => {
    let followerPacked = 0;
    for (const seed of [200, 201, 202]) {
      const w = createWorld(seed);
      for (let i = 0; i < 4 * D && !w.over; i++) {
        step(w);
        for (const s of w.scouts) if (s.act && s.act.kind === 'buddy' && Object.values(s.pocket).some((n) => (n || 0) > 0)) followerPacked++;
      }
    }
    expect(followerPacked).toBeGreaterThan(0);
  });
});

describe('flip-flops', () => {
  it('the oscillation monitor stays quiet over a few camp-days', () => {
    let osc = 0;
    for (const seed of [200, 203, 207]) { const w = createWorld(seed); runTicks(w, 6 * D); osc += w.stats.mon.oscillation; }
    expect(osc).toBeLessThanOrEqual(2);
  });
});

describe('extension seams (empty in v1.2.x)', () => {
  it('nothing is registered, so behaviour is the built-in one', () => {
    expect(GOAL_SOURCES.length).toBe(0);
    expect(Object.keys(JOB_MAKERS).length).toBe(0);
    expect(Object.keys(COMMAND_HANDLERS).length).toBe(0);
  });
  it('a registered goal source, job maker and command handler are used, deterministically', () => {
    const run = (): string => {
      const w = createWorld(34); let handled = 0;
      COMMAND_HANDLERS.ping = () => { handled++; };
      GOAL_SOURCES.push((_w, add) => add('order:test', 'testOrder', 0.01, 1, 'Test order'));
      JOB_MAKERS.testOrder = () => null;
      try {
        issueCommand(w, 'p1', 'ping', { x: 1, y: 2 }); runTicks(w, 400);
        expect(handled).toBe(1);
        expect(w.plan.goals.some((g) => g.id === 'order:test')).toBe(true);
        return hashWorld(w);
      } finally { delete COMMAND_HANDLERS.ping; GOAL_SOURCES.length = 0; delete JOB_MAKERS.testOrder; }
    };
    expect(run()).toBe(run());
  });
});
