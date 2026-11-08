// Bark table: what scouts say, varied by trait. Grim tone, dark humour, 1940s-50s working-man slang.
// All lines are original. {n} = another scout's name, {x} = a number or thing.
// Picking a line never touches the sim RNG, so editing text can't change outcomes.
import { Trait } from './config';

export type BarkKey =
  | 'site' | 'unpack' | 'wood' | 'noWood' | 'fire' | 'latrine' | 'water' | 'forage' | 'fish' | 'hunt' | 'cook' | 'smoke'
  | 'eat' | 'hungryNoFood' | 'sleep' | 'wake' | 'watch' | 'watchAssign' | 'buddyAsk' | 'buddyYes' | 'noBuddy' | 'explore'
  | 'roukha' | 'charge' | 'reload' | 'jam' | 'melee' | 'downed' | 'rescue' | 'treat' | 'allClear' | 'kill' | 'drag' | 'headOnly'
  | 'sign' | 'call' | 'trail' | 'boat' | 'command' | 'build' | 'sick' | 'accident' | 'death' | 'timber' | 'bare' | 'social'
  | 'socialFail' | 'maint' | 'lowMorale' | 'rum';

type Table = Partial<Record<Trait | 'any', string[]>>;
export const BARKS: Record<BarkKey, Table> = {
  site: { any: ['Camp under that big tree, by the water. Packs there.', 'That tree. Water close, wind behind it. We camp there.'] },
  unpack: { any: ['Pack down. My back thanks you.', 'Dropping my kit by the tree.'], loner: ['Kit down. Somewhere quiet would be nice.'] },
  wood: { any: ["I'll get wood.", 'Going for firewood.', 'Wood run.'], tough: ["Wood. I'll bring back plenty.", 'Axe and me, old friends.'], loner: ["I'll fetch wood. Peace and quiet."] },
  noWood: { any: ['No wood nearby we can reach.', "Nothing worth burning around here. Backing off."] },
  bare: { any: ["This one's bare. Finding another.", 'Picked clean. Next tree.'] },
  fire: { any: ['Getting a fire going.', 'Fire first. Then complaints.'] },
  latrine: { any: ['Digging the latrine. Somebody has to.', 'Latrine duty. Glamorous.'], tough: ['Latrine. Deep and proper.'] },
  water: { any: ['Fetching water.', 'Water run to the stream.'] },
  forage: { any: ['Picking berries. The birds can wait.', 'Going foraging.'] },
  fish: { any: ['Trying my luck with a line.', 'Fish for supper, maybe.'] },
  hunt: { any: ['Going after deer.', 'Hunting. Meat on the hoof out there.'], steadyHand: ['Hunting. One clean shot, no waste.'], jittery: ["Hunting! Something's getting shot today."] },
  cook: { any: ['Cooking. Nobody complain.', 'Supper on the fire.'] },
  smoke: { any: ['Smoking the meat so it keeps.', 'Meat on the racks.'] },
  eat: { any: ['Grub time.', 'Eating. Leave me be.'], sociable: ['Eating. Join me, lads?'] },
  hungryNoFood: { any: ["Stores are empty. I'll find something.", "Belly's empty and so's the larder."] },
  sleep: { any: ['Turning in.', 'Bedroll. Wake me if the world ends.'], cautious: ['Turning in. Rifle within reach.'], nightOwl: ['Bed? It is barely evening.'] },
  wake: { any: ['Morning.', 'Up. Barely.'] },
  watch: { any: ['On watch.', "I've got the watch."], cautious: ['On watch. Eyes open, finger off the trigger.'] },
  watchAssign: { any: ['Your watch, {n}.', '{n}, you have the watch.'] },
  buddyAsk: { any: ['{n}, with me.', '{n}, grab your rifle, you are coming.'], loner: ["{n}, come along. Don't talk much."] },
  buddyYes: { any: ['Right behind you.', 'Coming.'], sociable: ['Coming! Better than digging.'] },
  noBuddy: { any: ["Nobody free to come. I'll find closer work.", "Not going out there alone. Closer job, then."] },
  explore: { any: ['Scouting past the treeline.', "Let's see what's over there."] },
  roukha: { any: ['Roukha!', 'Birds! {x} of them!', 'Roukha, eyes up!'], cautious: ['Roukha. Easy now, everyone together.'], bold: ["Roukha! Let's have 'em!"] },
  charge: { any: ["They're charging!", "Here they come!"] },
  reload: { any: ['Reloading!', 'Loading!'] },
  jam: { any: ['Jammed! Blasted thing!', 'Gun jammed!'] },
  melee: { any: ['Get off me!', 'Bayonet!'] },
  downed: { any: ["I'm hit... I'm down!", "Down! Somebody!"] },
  rescue: { any: ['Got you, {n}. Hold on.', 'Dragging {n} back. Stay with me.'] },
  treat: { any: ['Hold still, {n}. This will sting.', 'Patching {n} up.'] },
  allClear: { any: ['All clear.', "They're gone. For now."] },
  kill: { any: ['Bird down!', 'Got one!'], steadyHand: ['Clean kill.'], jittery: ['Ha! Got him!'] },
  drag: { any: ["Tying the bird on. It's a long drag.", 'Hauling the carcass back whole.'] },
  headOnly: { any: ["No time. Taking the head, the beak's what pays.", 'Head only. Not hanging around out here.'] },
  sign: { any: ['Fresh Roukha sign. Droppings.', 'Tracks. Big ones.', 'Feathers here. Recent.'] },
  call: { any: ['Hear that? Roukha calling.', 'Bird call, off that way.'] },
  trail: { any: ["Blood trail. He won't get far.", 'Following the blood.'] },
  boat: { any: ['Boat!', "Boat's in. Let's get paid."] },
  command: { any: ["{n}'s down. I'm in charge now.", 'I have command. Listen up.'] },
  build: { any: ['Building the {x}.', '{x} going up.'] },
  sick: { any: ['Feeling rotten.', 'Something I ate. Or everything.'] },
  accident: { any: ['Ah! Cut myself.', "Twisted my ankle, blast it."] },
  death: { any: ["{n}'s gone.", 'We lost {n}.'] },
  timber: { any: ['Felling timber for the boat.', 'Timber. That is money, lads.'] },
  social: { any: ['Who wants a hand of cards?'] },
  socialFail: { any: ['Nobody? Fine.', 'Suit yourselves.'], sociable: ["Nobody? You're a dull lot."] },
  maint: { any: ['Cleaning my rifle.', 'Oil and rag time.'], steadyHand: ['Cleaning the rifle. Twice.'] },
  rum: { any: ['Pass the rum.'], drinker: ['Rum. Finally, something sensible.'], teetotal: ["I'll have tea. Somebody has to stay sharp."] },
  lowMorale: { any: ['What are we even doing out here.', 'This island will be the death of us.'] },
};

export function barkLine(key: BarkKey, traits: Trait[], salt: number, vars: { n?: string; x?: string | number }): string {
  const t = BARKS[key];
  const own = traits.find((x) => !!t[x]);
  const arr = (own && ((salt >>> 3) & 1) === 0 ? t[own] : t.any) || t.any || [''];
  let line = arr[Math.abs(salt) % arr.length];
  if (vars.n !== undefined) line = line.split('{n}').join(vars.n);
  if (vars.x !== undefined) line = line.split('{x}').join(String(vars.x));
  return line;
}
