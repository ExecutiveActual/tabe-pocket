// Shared AI module: home comfort. Every creature feels safe near its home (a camp, a nest) and less safe away
// from it. Species data (SPECIES[x].home) sets the radii; callers use the answers to decide how big a group must
// be before going out, how bold to be, and how quickly fear builds. Pure functions: no world access, no RNG.
export interface HomeRules {
  safeR: number;   // inside this (metres from home) a creature feels fully at home: comfort 1
  edgeR: number;   // comfort falls off linearly to 0 at this distance
  awayGroup: number; // smallest group that goes beyond safeR (scouts: a buddy pair; Roukha: a hunting pack)
}
/** 1 at home, falling to 0 at the edge of the home range. */
export function comfort(r: HomeRules, d: number): number {
  if (d <= r.safeR) return 1;
  if (d >= r.edgeR) return 0;
  return 1 - (d - r.safeR) / (r.edgeR - r.safeR);
}
/** Outside the home perimeter: work or travel here is done as a group. */
export function outside(r: HomeRules, d: number): boolean { return d > r.safeR; }
/** Smallest group that should be at distance d from home. */
export function groupNeededAt(r: HomeRules, d: number): number { return outside(r, d) ? r.awayGroup : 1; }
/** Unease (0..1) at distance d: 1 - comfort. Fear and boldness scale with it. */
export function unease(r: HomeRules, d: number): number { return 1 - comfort(r, d); }
