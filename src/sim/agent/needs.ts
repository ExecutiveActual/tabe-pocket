// Shared AI module: needs and utility. A need is a 0-100 meter (100 = satisfied) that decays per game hour and
// becomes a motive once it drops below "seek", and an emergency below "urgent". Scouts (food, water, rest...) and
// Roukha (hunger) use the same rules, parameterized by species data (SPECIES[x].needs). Pure functions.
export interface NeedRule { decayH: number; seek: number; urgent: number }
export type NeedRules = Record<string, NeedRule>;

/** Decay the listed needs by one tick (tph = ticks per game hour). */
export function decayNeeds(needs: Record<string, number>, keys: readonly string[], rules: NeedRules, tph: number): void {
  for (const k of keys) needs[k] = Math.max(0, needs[k] - rules[k].decayH / tph);
}
/** Utility of satisfying a need at value v: small when nearly full, rising below seek, a big jump below urgent. */
export function urgency(v: number, seek: number, urgentAt: number): number {
  if (v >= seek) return ((100 - v) / 100) * 0.3;
  let u = ((seek - v) / seek) * 2 + 0.3;
  if (v < urgentAt) u += 2;
  return u;
}
export function isUrgent(needs: Record<string, number>, rules: NeedRules, keys: readonly string[]): boolean {
  return keys.some((k) => needs[k] < rules[k].urgent);
}
/** Generic utility choice: highest score wins; ties go to the earlier candidate (deterministic). */
export function chooseBest<T extends { score: number }>(cands: T[]): T | undefined {
  let best: T | undefined;
  for (const c of cands) if (!best || c.score > best.score) best = c;
  return best;
}
