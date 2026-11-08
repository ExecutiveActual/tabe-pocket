# What the Roukha are trying to do

Roukha run on the same AI modules as the scouts (`src/sim/agent/`), with their own numbers (`SPECIES.roukha` in `config.ts`).

**Home is the nest.** A few nests sit about 330 m from the landing (`data/maps/tabe_big.meta.json` "nests"; placed by `scripts/placenests.ts`, hand-editable). Each has a flock of 7-9 birds with a big old bull, and refills slowly when no scout is watching. Within about 70 m of the nest a bird feels at home; the farther out, the more uneasy it gets.

**Life at home.** A bird roosts at night and spends the day feeding, loafing in small knots and tending the nest. Feeding keeps it going, but sooner or later the flock gets hungry for a real hunt.

**Calling a hunt.** In the afternoon or evening (any time when starving) the hungriest bird calls the flock together, asking for 4-7 birds. It is the same help request the scouts use:
- **come now:** a loafing bird drops what it's doing;
- **gimme a sec:** a feeding bird finishes first;
- **help me first:** a bird tending the nest gets a hand, then they go;
- **no:** asked again later.

They gather at the nest and set out together. Fewer than 4 able birds never go: a small flock stays home where it feels safe. Birds never hunt alone.

**The hunt.** The pack travels unseen toward the scouts, picks the target with the best odds and stalks. It charges when the odds are good enough (better at night, worse near its own nest), and heads home if no opening comes or it is spotted and outnumbered. A pack that has put two men down has had blood enough and goes home.

**Fear and running away.** Each pack has a fear level: losses (a lot more if the bull dies), wounds and being far from home push it up; gunfire adds a little, but never enough on its own to break them. Landed bites and a downed man steady them. When a pack that has taken real damage gets too scared, it retreats to its nest. A badly wounded bird on its own runs for its nest, bleeding a trail scouts can follow; in the middle of a charge, with packmates around it, it presses on until it is nearly done.

**At the nest.** Scouts who walk into a nest are charged at worse odds than anywhere else. If there are too many guns, the birds slip back to the nest instead. Explorers give known nests a wide berth.
