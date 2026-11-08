// Tabe Pocket sim: every tunable number lives here.
// Values marked PLACEHOLDER are invented starting points, not approved by Nicolas.
// Time units: the sim runs at TICK_HZ ticks per second of sim time; one in-game day is DAY_TICKS ticks.
// "Per hour" means per in-game hour (DAY_TICKS / 24 ticks).

export type NeedId = 'food' | 'water' | 'rest' | 'warmth' | 'social' | 'fitness';
export const NEED_IDS: NeedId[] = ['food', 'water', 'rest', 'warmth', 'social', 'fitness'];

export type Item =
  | 'wood' | 'timber' | 'berries' | 'rawMeat' | 'rawFish' | 'meal' | 'ration'
  | 'rawHide' | 'hide' | 'water' | 'ammo' | 'meds' | 'tobacco'
  | 'smoked' | 'rum' | 'leaf' | 'tools' | 'canvas' | 'eggs' | 'herbs'
  | 'carcJ' | 'carcA' | 'carcB' | 'beakJ' | 'beakA' | 'beakB' | 'beakCr' | 'feathers' | 'talons';
export const ITEMS: Item[] = ['wood', 'timber', 'berries', 'rawMeat', 'rawFish', 'meal', 'ration', 'rawHide', 'hide', 'water', 'ammo', 'meds', 'tobacco', 'smoked', 'rum', 'leaf', 'tools', 'canvas', 'eggs', 'herbs', 'carcJ', 'carcA', 'carcB', 'beakJ', 'beakA', 'beakB', 'beakCr', 'feathers', 'talons'];
export const EXPORTS: Item[] = ['leaf', 'herbs', 'eggs', 'beakB', 'beakA', 'beakJ', 'beakCr', 'feathers', 'hide', 'talons', 'timber'];
export const ITEM_LABEL: Partial<Record<Item, string>> = {
  smoked: 'smoked meat', leaf: 'smoking leaf', berries: 'fruit and roots', herbs: 'medicinal herbs', rawMeat: 'raw meat', rawFish: 'raw fish', rawHide: 'raw hide', carcJ: 'juvenile carcass', carcA: 'adult carcass', carcB: 'bull carcass',
  beakJ: 'juvenile beak', beakA: 'adult beak', beakB: 'bull beak', beakCr: 'cracked beak',
};
// Roukha age classes (CONFIRMED: juvenile, adult, big old bull; bigger birds have better beaks). Numbers PLACEHOLDER.
export type AgeClass = 'J' | 'A' | 'B';
/** Food items: points per unit (a full meal = 100 points, the scout's food meter) and whether it spoils (spoil rates in
 *  CFG.SPOIL_H). Only non-spoiling food goes in a scout's pocket. edible: eaten as is (raw meat/fish must be cooked first,
 *  their points count for planning). PLACEHOLDER numbers. */
export const FOOD: Partial<Record<Item, { pts: number; spoils: boolean; edible: boolean; label: string }>> & Record<'meal' | 'smoked' | 'berries' | 'ration' | 'rawMeat' | 'rawFish', { pts: number; spoils: boolean; edible: boolean; label: string }> = {
  meal:    { pts: 40, spoils: true,  edible: true,  label: 'hot meal (portion)' },
  smoked:  { pts: 32, spoils: false, edible: true,  label: 'smoked meat / jerky' },
  ration:  { pts: 35, spoils: false, edible: true,  label: 'tinned ration' },
  berries: { pts: 9,  spoils: true,  edible: true,  label: 'berries (handful)' },
  rawMeat: { pts: 36, spoils: true,  edible: false, label: 'raw meat' },
  rawFish: { pts: 36, spoils: true,  edible: false, label: 'raw fish' },
};
export const AGE: Record<AgeClass, { label: string; hp: number; size: number; yieldMul: number; dmgMul: number; beak: Item; carc: Item; chance: number }> = {
  J: { label: 'juvenile', hp: 60, size: 0.8, yieldMul: 0.6, dmgMul: 0.7, beak: 'beakJ', carc: 'carcJ', chance: 0.3 },
  A: { label: 'adult', hp: 100, size: 1.0, yieldMul: 1.0, dmgMul: 1.0, beak: 'beakA', carc: 'carcA', chance: 0.55 },
  B: { label: 'big old bull', hp: 150, size: 1.3, yieldMul: 1.5, dmgMul: 1.4, beak: 'beakB', carc: 'carcB', chance: 0.15 },
};

export type SkillId = 'shooting' | 'leadership' | 'butchering' | 'tracking' | 'medicine' | 'cooking';
export const SKILL_IDS: SkillId[] = ['shooting', 'leadership', 'butchering', 'tracking', 'medicine', 'cooking'];
// Traits come in opposing pairs (CONFIRMED); a scout never has both halves. Each scout gets 1-3 (seeded).
export type Trait = 'bold' | 'cautious' | 'earlyRiser' | 'nightOwl' | 'loner' | 'sociable' | 'drinker' | 'teetotal' | 'steadyHand' | 'jittery' | 'tough' | 'sickly';
export const TRAIT_PAIRS: [Trait, Trait][] = [['bold', 'cautious'], ['earlyRiser', 'nightOwl'], ['loner', 'sociable'], ['drinker', 'teetotal'], ['steadyHand', 'jittery'], ['tough', 'sickly']];
/** What each trait does. One small, readable effect each (PLACEHOLDER numbers). */
export const TRAIT_FX: Record<Trait, { label: string; aim?: number; cone?: number; wake?: number; social?: number; drink?: number; sick?: number; hp?: number; danger?: number; headshotCare?: boolean }> = {
  bold:       { label: 'Bold', danger: 0.7 },                 // less put off by danger; the only ones who'd hunt at night (stub)
  cautious:   { label: 'Cautious', danger: 1.4 },
  earlyRiser: { label: 'Early riser', wake: -0.8 },
  nightOwl:   { label: 'Night owl', wake: 0.8 },
  loner:      { label: 'Loner', social: 0.5 },               // seeks quiet time alone
  sociable:   { label: 'Sociable', social: 1.35 },
  drinker:    { label: 'Drinker', drink: 1.8 },
  teetotal:   { label: 'Teetotal', drink: 0 },
  steadyHand: { label: 'Steady hand', aim: 1.3, cone: 0.8, headshotCare: true }, // takes his time, prefers body shots when hunting
  jittery:    { label: 'Jittery', aim: 0.65, cone: 1.25 },    // trigger-happy
  tough:      { label: 'Tough', hp: 1.15, sick: 0.5 },
  sickly:     { label: 'Sickly', hp: 0.9, sick: 2.0 },
};

// Day periods used for time-of-day affinity. Hours are in-game clock hours.
export type Period = 'night' | 'dawn' | 'morning' | 'day' | 'evening';

/** How a need-satisfying activity is set up. Adding a new leisure or training activity is just a new entry here. */
export interface ActivityDef {
  id: string;
  label: string;           // shown in the scout panel
  bark: string;            // what he says when he starts it
  gain: Partial<Record<NeedId, number>>; // need points restored per in-game hour while doing it
  where: 'fire' | 'water' | 'camp' | 'tent' | 'range'; // where it happens
  minPeople: number;       // 2+ means it needs company (scouts gather for it)
  maxPeople: number;
  hours: number;           // how long one session runs (in-game hours)
  affinity: Record<Period, number>; // time-of-day multiplier (0 = never)
  requires?: { item: Item; alt?: Item; perSession: number; surplusOver?: number }; // consumes stock; surplusOver = only if camp stock above this
  needsFire?: boolean;     // only if the campfire is lit
  morale?: number;         // one-off morale bump when finished
  traitOnly?: Trait;       // only scouts with this trait do it (e.g. loners' quiet time)
  traitMul?: Partial<Record<Trait, number>>; // trait preference multipliers
  drink?: boolean;         // counts as 'a drink' for the meal-plus-drinks morale lift
}

/**
 * v1 scope switches. v1 is the smallest solid slice (see README). Everything set to false is DEFERRED: the design is
 * recorded in the doc and some groundwork exists, but it is switched off, not exercised by the tests, and not part of v1.
 */
export const FEATURES = {
  leisure: false,      // social/fitness needs, cards/chat/sparring, stress, drink and hangovers
  seasons: false,      // four seasons, season license fee, winter/nesting Roukha behaviour (v1: endless spring, daily wages)
  sickness: false,     // fever, infection, food poisoning, chills
  accidents: false,    // minor work accidents
  injuries: false,     // lasting limp / bad arm, invalided home
  trails: false,       // worn trails speed up walking
  deer: false,         // deer hunting and hides
  fishing: false,      // fish traps and nets
  extraForage: false,  // roots, crabs, lizards, herbs, smoking leaf (v1 forages fruit only)
  builds: false,       // camp upgrades (shelter, racks, shed, tower, palisade...)
  timber: false,       // timber felling for export
  smoking: false,      // smoking meat so it keeps
  gear: false,         // gun condition, jams, maintenance, clothing wear
  replacements: false, // hiring new scouts off the boat
  orders: false,       // orders for a later boat and random shop stock (v1: the boat always sells food and ammo on the spot)
  splitMoney: false,   // camp cash vs home account, commander's cash policy, card stakes (v1: one purse)
  debt: false,         // running into debt (v1: bankrupt as soon as the purse stays negative for BANKRUPT_DAYS)
};
export const COMPANY_NAME = 'Tabe Venture Company (PLACEHOLDER name)';
// Co-op squads are told apart by colour AND hat shape (viewer). Pocket starts with one squad; the layer is ready for two.
export const SQUADS = [{ name: 'First squad', color: '#d8b04a', hat: 'brim' }, { name: 'Second squad', color: '#5aa8e0', hat: 'helmet' }];

export const CFG = {
  TICK_HZ: 10,                 // sim ticks per sim-second
  DAY_TICKS: 6000,             // PLACEHOLDER one in-game day = 10 real minutes at 1x
  START_HOUR: 7,               // landing time (07:00)
  DAY_START_H: 6, DUSK_H: 18.5, NIGHT_H: 19.5, DAWN_H: 5,  // PLACEHOLDER light periods

  // ---- World ----
  LOG_MAX: 400,                // log entries kept in the world (each has a running number for readers)
  MAP_TILES: 768,              // the fixed island is 768x768 tiles (1.5 km a side), data/maps/tabe_big.txt (info only: the map file decides)
  MAP_CONTENT_SEED: 1947,      // fixed salt for groves/bushes so content is the same every game
  TILE_M: 2,                   // metres per tile
  REVEAL_DAY_M: 30, REVEAL_NIGHT_M: 16, // MINIMUM fog reveal radius; scouts reveal their full sight radius (combat.sightOf)
  LANDING_REVEAL_M: 70,        // what they saw coming in on the boat
  TREE_DENSITY_FOREST: 0.33, TREE_DENSITY_GRASS: 0.015,
  BUSH_DENSITY: 0.012,
  // Content per biome on the fixed map (chance per tile). Sparse on purpose: the island is big. PLACEHOLDER.
  BIOME_CONTENT: {
    1: { tree: 0, forage: { crabs: 0.004 } },                                   // beach: crabs
    2: { tree: 0.015, forage: { fruit: 0.006, herbs: 0.0015, leaf: 0.0015 } },  // grass
    3: { tree: 0.12, forage: { fruit: 0.008, herbs: 0.002 } },                   // jungle
    7: { tree: 0.006, forage: { roots: 0.005, lizards: 0.004, leaf: 0.002 } },  // outback
    8: { tree: 0.05, forage: { crabs: 0.008 } },                                 // mangrove
    9: { tree: 0.01, forage: { roots: 0.002, herbs: 0.002 } },                   // hills
  } as Record<number, { tree: number; forage: Record<string, number> }>,
  // What each forage source gives: item, amount per visit, label for logs
  FORAGE: {
    fruit: { item: 'berries', take: 8, label: 'Picking fruit' },
    roots: { item: 'berries', take: 6, label: 'Digging roots' },
    crabs: { item: 'rawMeat', take: 2, label: 'Catching crabs' },
    lizards: { item: 'rawMeat', take: 2, label: 'Hunting lizards' },
    herbs: { item: 'herbs', take: 3, label: 'Gathering medicinal herbs' },
    leaf: { item: 'leaf', take: 3, label: 'Picking smoking leaf' },
  } as Record<string, { item: Item; take: number; label: string }>,
  HERBS_PER_MED: 3,            // a medic can treat with herbs when the kit is empty
  // Fish traps and nets: set once, then checked. Spots on the shore and streams.
  // Trails: every tile a scout walks onto gains traffic; past thresholds it walks faster. Decays slowly. PLACEHOLDER.
  TRAIL_MAX: 400, TRAIL_DECAY_H: 0.25,
  TRAIL_LEVELS: [{ at: 40, mul: 1.12 }, { at: 150, mul: 1.25 }],
  SPAWN_HIDE_M: 120,           // ...and never inside this distance of any scout (>= the best watch sight, so spawns stay unseen)
  FORAGE_MAX_M: 220,           // day-trip radius for foraging and traps
  FISH_SPOT_DENSITY: 0.01, TRAPS_MAX: 4, SET_TRAP_H: 1.0,
  TREE_WOOD_PER_SIZE: 6,       // PLACEHOLDER firewood (deadwood) units per tree size step
  TREE_WOOD_REGROW_H: 30,      // one deadwood unit regrows per this many hours
  TREE_TIMBER_PER_SIZE: 2,     // trunk timber units when felled
  BUSH_MAX: 6, BUSH_REGROW_H: 5,
  FISH_SPOTS: 8, FISH_MAX: 6, FISH_REGROW_H: 4,
  DEER_HERDS: 4, DEER_PER_HERD: 3, DEER_RESPAWN_H: 20,

  // ---- Scouts ----
  SCOUTS_START: 5,
  // Chain of command: rank first, then Leadership among equal ranks. Designer-set; PLACEHOLDER roster.
  RANKS: ['Hand', 'Hunter', 'Foreman', 'Boss'],  // CONFIRMED order, index = rank value
  START_ROSTER: [ // designer-set; skill numbers are PLACEHOLDER (0-100)
    { rank: 3, skills: { shooting: 45, leadership: 70, butchering: 30, tracking: 35, medicine: 30, cooking: 25 } },
    { rank: 2, skills: { shooting: 40, leadership: 50, butchering: 25, tracking: 30, medicine: 20, cooking: 35 } },
    { rank: 1, skills: { shooting: 60, leadership: 30, butchering: 50, tracking: 55, medicine: 15, cooking: 20 } },
    { rank: 1, skills: { shooting: 55, leadership: 25, butchering: 45, tracking: 45, medicine: 35, cooking: 30 } },
    { rank: 0, skills: { shooting: 30, leadership: 15, butchering: 20, tracking: 20, medicine: 25, cooking: 45 } },
  ] as { rank: number; skills: Record<SkillId, number> }[],
  REPLACEMENT_SKILLS: { shooting: 35, leadership: 20, butchering: 25, tracking: 25, medicine: 20, cooking: 25 } as Record<SkillId, number>,
  SKILL_GAIN_PER_H: 0.6,       // PLACEHOLDER skill points per hour of doing the matching activity (cap 100)
  WAGE_PER_DAY: 3,             // PLACEHOLDER flat wage per scout per day, a running cost on the ledger
  WALK_MS: 1.7,                // metres per sim-second (+10% vs the old slice)
  SCOUT_SPEED_MUL: 1.25,       // PLACEHOLDER v1.1: all scout movement (walk, run, drag) x1.25
  RUN_MS: 2.6,
  DRAG_MS: 0.7,
  CARRY_CAP: 8,                // weight units a scout can carry
  WEIGHT: { wood: 2, timber: 8, berries: 0.5, rawMeat: 1, rawFish: 1, meal: 1, ration: 0.5, rawHide: 2, hide: 2, water: 1, ammo: 0.05, meds: 0.5, tobacco: 0.2, smoked: 0.6, rum: 0.5, leaf: 0.2, tools: 2, canvas: 3, eggs: 0.3, herbs: 0.2, carcJ: 0, carcA: 0, carcB: 0, beakJ: 0.5, beakA: 0.5, beakB: 0.5, beakCr: 0.5, feathers: 0.5, talons: 0.3 } as Record<Item, number>,
  EXPLORE_PUSH_M: 35,          // PLACEHOLDER explorers walk this far past the edge of the known ground
  // ---- Teams (v1.1): outside work is done in pairs or threes; in-camp work goes faster with helpers ----
  // Men needed for each outside job, counting the man who asks. Looting a bird scales with its age class.
  TEAM_SIZE: { chop: 2, fell: 3, forage: 2, fish: 2, fetchWater: 2, hunt: 2, rhunt: 3, explore: 2, lootJ: 2, lootA: 2, lootB: 3, lootDeer: 2 } as Record<string, number>,  // PLACEHOLDER
  TEAM_URGENCY: { loot: 2.7 } as Record<string, number>,   // PLACEHOLDER request urgency by job (others use their goal priority)
  TEAM_SOLO_MAX_M: 80,         // PLACEHOLDER fallback: a low-risk job (wood, water, forage, traps, daytime) may go solo only this close
  TEAM_SOLO_INTEL_M: 120,      // ...and only with no fresh Roukha sign within this of the job
  TEAM_RALLY_MATE_M: 25,       // a leader outside camp re-forms his team on the spot if a mate is this close; else he walks home
  JOIN_SCORE_MUL: 1.0,         // decide(): joining an open team request scores urgency x this
  // Joint work: total output of 1, 2, 3, 4 men on one job (diminishing returns). Quality bonus by number of helpers.
  TEAM_WORK: [1, 1.6, 1.95, 2.15],          // PLACEHOLDER
  TEAM_QUALITY: [0, 0.08, 0.12, 0.14],      // PLACEHOLDER e.g. processing yield and cooking stretch with helpers
  ASSIST_RANGE_M: 7,           // a helper counts when this close to the man doing the job
  ASSIST_SCORE_MUL: 0.75,      // PLACEHOLDER decide(): helping a mate's camp job scores his job priority x this x the marginal gain
  ASSIST_MIN_LEFT_H: 0.12,     // not worth joining a job with less than this left
  ASSIST_MAX: { build: 3, cook: 1, smokeMeat: 1, process: 2, scrape: 1, chop: 1, fell: 2 } as Record<string, number>,  // PLACEHOLDER helpers per job
  LOOT_BIRD_PRI: 2.7,          // PLACEHOLDER recovering a known bird carcass: a HIGH priority team job (rescue 3.6, fuel 3.0 are above it)
  CARCASS_DRAG_TEAM: [0.45, 0.45, 0.72, 0.85],  // PLACEHOLDER drag speed multiplier by number of men on the rope (index = men)
  LONE_LIMIT_M: 60,            // beyond this from camp, nobody should be alone (test bound)
  LONE_GRACE_S: 45,            // ...except briefly (e.g. walking home after his buddy was pulled into a fight)
  BUDDY_KEEP_M: 10,            // follower tries to stay this close
  HP: 100,
  BLEED_OUT_TICKS: 1200,       // PLACEHOLDER downed scout dies after 2 sim-minutes untreated
  RECOVER_H: 8,                // after treatment, hours of light duty
  HEAL_PER_H: 6,

  // ---- Needs (0 = empty/miserable, 100 = fully satisfied) ----
  // v1 core needs are food, water and rest (plus morale). social/fitness only decay with FEATURES.leisure.
  NEED_DECAY_H: { food: 3.2, water: 4.5, rest: 4.4, warmth: 0, social: 3.0, fitness: 1.6 } as Record<NeedId, number>, // PLACEHOLDER
  CAMP_WET_PENALTY: 4, CAMP_MIN_WATER_M: 8, // camp siting: keep the camp footprint on dry ground, a short walk from water
  LEISURE_MAX_SCORE: 3.0,     // leisure never outranks a pressing bodily need (food/water urgency goes higher)
  NEED_SEEK: { food: 55, water: 55, rest: 35, warmth: 55, social: 60, fitness: 65 } as Record<NeedId, number>,  // starts wanting it below this
  NEED_URGENT: 22,             // below this a need interrupts work
  NEED_REPORT_MIN: 20,         // daily report: every scout should end the day above this
  SLEEP_GAIN_H: 12.5,
  WARMTH_COLD_LOSS_H: 6,       // warmth lost per hour at night / in rain away from fire or tent
  WARMTH_FIRE_GAIN_H: 25,      // near a lit fire or in a tent
  FIRE_WARM_M: 7,
  MORALE_BASE: 25,             // morale target = base + weighted needs + camp comfort - grief
  MORALE_RATE_H: 6,            // morale moves this many points per hour toward its target
  MORALE_DEATH: 25, MORALE_DEATH_DECAY_H: 1,
  MORALE_DEATH_CLOSE: 15,      // extra grief for the man who spent the most time with him (relationship proxy)
  TOGETHER_M: 15,              // 'time together' counts hours within this distance
  MORALE_COMFORT: { fire: 6, mess: 4, latrine: 4, meal: 4, shed: 2, tower: 2, palisade: 4 } as Record<string, number>,
  // Morale thoughts: each unmet need drags morale down with a named cause. Morale drifts, it never snaps.
  MORALE_NEED_PENALTY: 16,     // max penalty from one need at 0 (scaled linearly below its 'seek' level)
  MORALE_AMMO_LOW: 8,          // 'Short on ammo' when camp+carried rounds are below AMMO_LOW
  AMMO_LOW: 60,
  MORALE_NO_DOWNTIME_H: 30,    // 'No downtime' if no leisure for this many hours
  MORALE_NO_DOWNTIME: 6,
  MORALE_RECOVER_FAST: 1.5,    // morale rises a bit faster than it falls once needs are met
  // Food is counted in points: the scout's food meter, so a full meal = 100 points. FOOD (top of this file) has each
  // item's points and whether it spoils. Pocket rations (v1.2): before heading out a scout takes non-spoiling food
  // from the stores, up to POCKET_PTS, in POCKET_PREF order, and eats it out there instead of walking back.
  POCKET_PTS: 150,             // PLACEHOLDER food points a scout pockets for a trip (1.5 full meals)
  POCKET_PREF: ['smoked', 'ration'] as Item[],   // PLACEHOLDER what goes in the pocket, first choice first (non-spoiling only)
  SUPPER_FIRST: 0.4,           // sleep score cap while hungry with food in camp and not exhausted (eat, then bed)
  POCKET_RESERVE: 120,         // PLACEHOLDER food points per man always left in the stores (pockets only take the surplus)
  SNACK_TICKS: 30,             // PLACEHOLDER 3 s standing still to eat from the pocket
  EAT_PREF: ['meal', 'smoked', 'berries', 'ration'] as Item[], // rations are the last resort
  // Spoilage per in-game hour (fraction of stock lost). Smoked meat and rations keep. PLACEHOLDER.
  SPOIL_H: { rawHide: 0.004, rawMeat: 0.02, rawFish: 0.03, meal: 0.015, berries: 0.006 } as Partial<Record<Item, number>>,
  SPOIL_SHED_MUL: 0.5,         // a storage shed halves spoilage
  // Illness and accidents outside fights (PLACEHOLDER rates). Medicine skill treats them.
  // ---- Medicine (CONFIRMED shape; numbers PLACEHOLDER) ----
  ILLNESS_PER_DAY: 0.03,       // base chance of chills per day; cold and wet multiply it
  SICKNESS: {
    fever: { label: 'Fever (bad water)', hours: 30, workMul: 0.5, hpPerH: 0.3 },
    infection: { label: 'Infected wound', hours: 40, workMul: 0.4, hpPerH: 0.8 },
    poisoning: { label: 'Food poisoning', hours: 12, workMul: 0.5, hpPerH: 0.2 },
    chills: { label: 'Chills (cold and wet)', hours: 18, workMul: 0.7, hpPerH: 0 },
  } as Record<string, { label: string; hours: number; workMul: number; hpPerH: number }>,
  FEVER_PER_STREAM_DRINK: 0.006, // drinking straight from the stream (the cask is boiled)
  POISON_PER_MEAL: 0.004,        // spoiled meat in the pot; a good cook halves it
  INFECT_PER_H: 0.01,            // a wound under 60% HP that no medic has dressed
  // accidents are minor only (never below ACCIDENT_HP_FLOOR of max HP); expand the table later
  ACCIDENT_PER_WORK_H: 0.004, ACCIDENT_HP_FLOOR: 0.5,
  ACCIDENTS: [
    { id: 'bruise', text: 'bruised his hand', dmg: [3, 8], w: 3 },
    { id: 'cut', text: 'nicked himself with the blade', dmg: [4, 10], w: 2 },
    { id: 'burn', text: 'burned his fingers at the fire', dmg: [2, 6], w: 1 },
  ],
  // healing: slow with rest, faster with a medic (Medicine skill plus supplies)
  HEAL_REST_H: 2.0, HEAL_AWAKE_H: 0.5, HEAL_MEDIC_MUL: 2.5, MEDIC_BOOST_H: 24, TREAT_BELOW_HP: 0.6,
  // lasting injuries from being downed: chance = wound severity * this
  INJURY_PER_WOUND: 0.004,
  INJURIES: {
    limp: { label: 'Limp', speedMul: 0.85, aimMul: 1 },
    badArm: { label: 'Bad arm', speedMul: 1, aimMul: 1.25 },
  } as Record<string, { label: string; speedMul: number; aimMul: number }>,
  INVALID_INJURIES: 2, INVALID_MAXHP: 55,  // a man this broken is sent home on the boat and replaced
  BODY_SHIP_COST: 20,          // the dead go home on the next boat
  // drink: morale up now, hangover tomorrow morning
  HANGOVER_UNTIL_H: 11, HANGOVER_AIM_MUL: 1.3, HANGOVER_MORALE: -3,
  SICK_WORK_MUL: 0.5, SICK_H: 30, TREAT_H: 0.5,
  WATER_PER_UNIT: 30,
  ACT_COMMIT_BONUS: 0.6,       // stickiness so they don't flip between activities
  DECIDE_EVERY: 10,            // ticks between re-evaluating (only for interruptible stuff)
  IDLE_LIMIT_S: 20,            // test bound: no idling longer than this with open goals

  // ---- Leisure, social and training: each is a data entry ----
  ACTIVITIES: [
    { id: 'chat', label: 'Chatting at the fire', bark: 'Coffee and talk, lads.', gain: { social: 40, warmth: 10 }, where: 'fire', minPeople: 2, maxPeople: 6, hours: 0.75,
      affinity: { night: 0, dawn: 1.2, morning: 1.6, day: 0.3, evening: 1.0 } },
    { id: 'cards', label: 'Cards and dice', bark: 'Who wants a hand of cards?', gain: { social: 45 }, where: 'fire', minPeople: 2, maxPeople: 4, hours: 1.25,
      affinity: { night: 0.1, dawn: 0, morning: 0.2, day: 0.7, evening: 1.8 }, morale: 3 },
    { id: 'nap', label: 'Napping in the shade', bark: 'Wake me for supper.', gain: { rest: 30 }, where: 'camp', minPeople: 1, maxPeople: 5, hours: 0.75,
      affinity: { night: 0, dawn: 0, morning: 0, day: 1.0, evening: 0 } },
    { id: 'letters', label: 'Writing a letter home', bark: "Writing home. Not that it'll get there.", gain: { social: 25 }, where: 'fire', minPeople: 1, maxPeople: 5, hours: 0.6,
      affinity: { night: 0, dawn: 0, morning: 0.2, day: 0.9, evening: 0.7 }, morale: 2 },
    { id: 'whittle', label: 'Whittling', bark: 'Carving a little bird. Ironic.', gain: { social: 20 }, where: 'fire', minPeople: 1, maxPeople: 5, hours: 0.75,
      affinity: { night: 0, dawn: 0, morning: 0.2, day: 0.9, evening: 0.8 }, morale: 1, traitMul: { steadyHand: 1.3 } },
    { id: 'solitude', label: 'Quiet time alone', bark: 'Going for a bit of quiet.', gain: { social: 40, rest: 8 }, where: 'range', minPeople: 1, maxPeople: 1, hours: 0.75,
      affinity: { night: 0, dawn: 0.6, morning: 0.5, day: 1.0, evening: 1.0 }, traitOnly: 'loner', morale: 2 },
    { id: 'smoke', label: 'Smoking a pipe', bark: 'Time for a smoke.', gain: { social: 25 }, where: 'fire', minPeople: 1, maxPeople: 6, hours: 0.5,
      affinity: { night: 0, dawn: 0.6, morning: 0.8, day: 0.5, evening: 1.3 }, requires: { item: 'tobacco', alt: 'leaf', perSession: 1 }, morale: 2, drink: true },
    { id: 'rum', label: 'A tot of rum', bark: 'Pass the rum.', gain: { social: 35, warmth: 15 }, where: 'fire', minPeople: 2, maxPeople: 6, hours: 0.6,
      affinity: { night: 0.2, dawn: 0, morning: 0, day: 0, evening: 1.5 }, requires: { item: 'rum', perSession: 1 }, morale: 3, drink: true },
    { id: 'workout', label: 'Working out', bark: 'Push-ups, then a run.', gain: { fitness: 45 }, where: 'camp', minPeople: 1, maxPeople: 5, hours: 0.75,
      affinity: { night: 0, dawn: 0.6, morning: 1.2, day: 0.5, evening: 0.9 } },
    { id: 'spar', label: 'Sparring', bark: 'Fancy a wrestle?', gain: { fitness: 40, social: 35 }, where: 'camp', minPeople: 2, maxPeople: 2, hours: 0.75,
      affinity: { night: 0, dawn: 0.3, morning: 0.8, day: 0.5, evening: 1.3 }, morale: 2 },
    { id: 'marks', label: 'Marksmanship practice', bark: 'Plenty of rounds. Range practice.', gain: { fitness: 20 }, where: 'range', minPeople: 1, maxPeople: 3, hours: 0.75,
      affinity: { night: 0, dawn: 0, morning: 1.0, day: 1.0, evening: 0.4 }, requires: { item: 'ammo', perSession: 10, surplusOver: 150 } },
  ] as ActivityDef[],
  // ---- Daily rhythm (CONFIRMED shape, PLACEHOLDER numbers) ----
  WAKE_H: 6.3,                 // default wake time
  MEALS: [{ from: 6.3, to: 9.0 }, { from: 17.5, to: 20.5 }], // two meals a day, at the fire
  MEAL_TIME_MUL: 2.2, OFF_MEAL_MUL: 0.5,  // eating outside meal times only when properly hungry
  COOK_BEST_ONLY: true,        // the best Cook cooks, unless he is unavailable
  NIGHT_HUNT_BOLD_ONLY: true,  // stub: night hunts are rare and only for bold hunters (not active yet)
  // Stress: sustained danger with no rest is the biggest morale drain.
  STRESS_DANGER_H: 30, STRESS_TIRED_H: 4, STRESS_RELIEF_SLEEP_H: 8, STRESS_RELIEF_LEISURE_H: 12, STRESS_DECAY_H: 1.5,
  STRESS_MORALE_MAX: 30,
  // Biggest lift: a good meal plus drinks (rum or tobacco) within a few hours of each other.
  MEAL_AND_DRINK_LIFT: 12, MEAL_AND_DRINK_WINDOW_H: 6,
  SOCIAL_WAIT_H: 0.6,          // a host waits this long for company before giving up
  SKILL_PER_PRACTICE: 2,       // marksmanship skill points per session (0-100)

  // ---- Camp plan (sergeant) ----
  PLAN_EVERY: 20,              // ticks between plan refreshes
  WOOD_TARGET: 30,             // PLACEHOLDER firewood stockpile goal (a night's burn plus cooking, with margin)
  WATER_TARGET: 20,            // camp cask units
  FOOD_DAYS_TARGET: 2,         // days of food per scout kept in stock (meals+berries+raw)
  FOOD_PER_DAY: 80,            // food points one scout eats per day (for planning)
  // Camp starts as bedrolls around a fire (CONFIRMED). Upgrades: the Boss proposes, the player approves
  // (auto-approved in the zero-input sim; see approveBuild hook). Costs/effects PLACEHOLDER.
  BUILDINGS: [
    { id: 'shelter', label: 'Fire shelter', wood: 4, hours: 0.8, dx: 0, dy: -3, effect: 'Lean-to over the fire: rain cannot put it out' },
    { id: 'barrel', label: 'Rain barrel', wood: 3, hours: 0.6, dx: 3, dy: -2, effect: 'Collects rain water into the cask' },
    { id: 'racks', label: 'Drying racks', wood: 5, hours: 1.0, dx: -5, dy: 3, effect: 'Smoke/dry meat faster; dries hides and feathers' },
    { id: 'butcher', label: 'Butchering station', wood: 6, hours: 1.2, dx: -6, dy: -3, effect: 'Faster processing, better yield' },
    { id: 'shed', label: 'Storage shed', wood: 10, hours: 2.0, dx: 5, dy: 5, effect: 'Halves spoilage' },
    { id: 'mess', label: 'Mess tent', wood: 10, hours: 2.0, dx: 0, dy: 7, effect: 'Meals lift morale more; leisure cosier' },
    { id: 'tower', label: 'Watchtower', wood: 14, hours: 3.0, dx: 9, dy: 0, effect: 'Watch sees much farther at night' },
    { id: 'palisade', label: 'Palisade wall', wood: 30, hours: 6.0, dx: 0, dy: 0, effect: 'Packs need better odds to charge the camp' },
  ],
  BUILD_SURPLUS_WOOD: 6,       // Boss proposes a build only when firewood stock stays above target + this
  RAIN_BARREL_H: 3,            // water units per hour of rain
  SMOKE_H: 1.0, SMOKE_BATCH: 4, SMOKE_RACK_MUL: 2,
  FIRE_BUILD_WOOD: 3, FIRE_MAX_FUEL: 10, FIRE_BURN_H: 0.6,  // fuel units burned per hour
  FIRE_REFUEL_BELOW: 5,
  LATRINE_DOWNWIND_M: 18,
  BUILD_H: { fire: 0.5, latrine: 1.5 } as Record<string, number>,
  LEAF_CHANCE: 0.35,           // foraging sometimes turns up smokable wild leaf (local substitute for tobacco)
  CHOP_H: 0.5, FELL_H: 1.5, FORAGE_H: 0.5, FISH_H: 1.2, BUTCHER_H: 0.8, COOK_H: 0.5, SCRAPE_H: 1.0, FILL_H: 0.15,
  COOK_BATCH: 4,               // raw items cooked per session
  DEER_MEAT: 8,
  WORK_AFFINITY: { night: 0, dawn: 0.5, morning: 1.0, day: 1.1, evening: 0.6 } as Record<Period, number>,
  EXPLORE_MAX_M: 160,          // explore frontier within this radius of camp
  WATCH_SHIFT_H: 2.5,

  // ---- Profit and boat ----
  BOAT_EVERY_DAYS: [3, 4],     // decided: every 3-4 in-game days
  BOAT_ARRIVE_H: 9, BOAT_STAY_H: 4, BOAT_WAIT_H: 1, // PLACEHOLDER: stays a few hours, then leaves
  // The trader is just a shop: random stock each visit (seeded) at a markup, plus orders for a later boat.
  SHOP_POOL: { ration: [10, 40, 0.8], ammo: [50, 200, 0.7], meds: [1, 6, 0.5], tobacco: [5, 20, 0.6], rum: [3, 10, 0.6] } as Record<string, [number, number, number]>, // [min, max, chance in stock]
  SHOP_MARKUP: 1.25,
  // Money (CONFIRMED): the home account pays for hiring and orders; camp cash pays on-the-spot boat buys, wages and
  // the license office. Wages are paid each season (cash first, then home). The commander decides how much of each
  // sale stays at camp: enough for the coming season's wages, fees and supplies, the rest goes home.
  // The company may run into debt down to DEBT_LIMIT; past it for BANKRUPT_DAYS straight, the company is bankrupt.
  // Co-op: one purse per camp (shared camp = one purse; separate camps = separate purses).
  CASH_POLICY: { seasonsOfWages: 1, feeBirds: 20, supplies: 150 }, // PLACEHOLDER: what the commander keeps at camp
  START_CASH_SHARE: 0.25,      // share of the starting money that lands at camp as cash
  DEBT_LIMIT: 1000, BANKRUPT_DAYS: 10, // PLACEHOLDER (with FEATURES.debt)
  BANKRUPT_DAYS_NO_DEBT: 3,    // v1: game over when the purse stays below zero this many mornings
  CARDS_STAKE: [1, 5],         // cards are played for stakes: cash moves between the players' purses
  SEASON_LICENSE_FEE: 60,      // PLACEHOLDER: charged by the license office at the start of each season (plus the per-bird fee)
  BOAT_STORM_DELAY_DAYS: 1,
  // Weather (CONFIRMED effects, PLACEHOLDER numbers). Four seasons, SEASON_DAYS each.
  // Four seasons of ~30 days make a 120-day year (CONFIRMED). The landing happens at the start of spring.
  SEASONS: ['Spring', 'Summer', 'Autumn', 'Winter'],
  SEASON_DAYS: 30,
  WEATHER_CHANCE: [ { rain: 0.25, storm: 0.04, fog: 0.12 }, { rain: 0.10, storm: 0.06, fog: 0.05 }, { rain: 0.22, storm: 0.10, fog: 0.10 }, { rain: 0.18, storm: 0.05, fog: 0.18 } ],
  // Roukha by season (CONFIRMED shape: spring nesting; winter fewer but hungrier and bolder, and only starving
  // winter packs raid camp for meat). Numbers PLACEHOLDER.
  SEASON_ROUKHA: [
    { nesting: true, birds: 1.0, oddsMod: 0, raidStores: false },   // Spring
    { nesting: false, birds: 1.0, oddsMod: 0, raidStores: false },  // Summer
    { nesting: false, birds: 0.9, oddsMod: 0, raidStores: false },  // Autumn
    { nesting: false, birds: 0.6, oddsMod: -0.4, raidStores: true }, // Winter
  ],
  RAIN_DOUSE_H: 0.25,          // chance per hour of rain that an unsheltered fire goes out (storm x2)
  FOG_SIGHT_MUL: 0.45, RAIN_SIGHT_MUL: 0.8, STORM_SIGHT_MUL: 0.6,
  WET_COLD_SICK_MUL: 2.0,      // sickness chance when wet and cold    // the boat is an independent trader; storms delay it (PLACEHOLDER)
  // Export prices. Roukha loot order is CONFIRMED (beak > feathers > hide > talons > meat); the numbers are PLACEHOLDER.
  // 'hide' covers both deer and Roukha hides for now.
  PRICE: { leaf: 3, herbs: 4, eggs: 35, beakB: 110, beakA: 60, beakJ: 30, beakCr: 20, feathers: 25, hide: 18, talons: 10, timber: 6 } as Partial<Record<Item, number>>,
  ROUKHA_PARTS: { feathers: 2, hide: 1, talons: 2, rawMeat: 10 } as Partial<Record<Item, number>>, // adult carcass, scaled by age yieldMul; plus its beak
  LICENSE_FEE: 8,              // PLACEHOLDER fee per Roukha killed, paid to the license office at the boat
  // Roukha hunting (CONFIRMED: found by sign and by calls, Tracking helps; wounded birds leave a blood trail)
  SIGN_EVERY_H: 0.5, SIGN_LIFE_H: 14, SIGN_NOTICE_M: 10,
  CALL_CHANCE_H: 0.5, CALL_HEAR_M: 160, CALL_ERROR_M: 20,
  INTEL_LIFE_H: 4,
  HUNT_MAX_H: 3.5, HUNT_PARTY: 2, HUNT_SHOOT_M: 50, HUNT_MAX_ODDS: 1.2, // won't hunt a group that could charge them
  VITAL_CHANCE: 0.14, VITAL_MUL: 2.6, HEADSHOT_CHANCE: 0.06, HEADSHOT_CAREFUL: 0.03, // PLACEHOLDER (v1.2: lower, fights last several shots) // one good shot can drop a bird
  TRAIL_BLEED_HP_H: 10,        // a badly wounded bird keeps bleeding and may die along its trail
  // Carry mode after a Roukha kill (the hunt leader decides):
  //  DRAG: the carcass is tied to a scout's back. Slow, can't shoot well. Processed at camp into all parts.
  //  HEAD: cut off the head and take only the beak. Fast and light, less value.
  CARCASS_DRAG_MUL: 0.45,      // PLACEHOLDER walk speed multiplier while dragging a carcass
  CARCASS_AIM_MUL: 2.0,        // PLACEHOLDER aim time multiplier while dragging (drops it to fight if pressed)
  HEAD_CUT_H: 0.15, PROCESS_H: 1.5, PROCESS_SCENT: 2,  // processing at camp takes time and makes scent
  HEAD_ONLY_DIST_M: 110,       // farther than this from camp: head only
  HEAD_ONLY_DUSK_H: 17.5,      // after this hour: head only
  HEAD_ONLY_DANGER_M: 80,      // other live Roukha within this: head only
  CARCASS_ROT_H: 36,           // unclaimed carcasses disappear
  COST: { ration: 4, ammo: 0.4, meds: 8, tobacco: 2, rum: 3, scout: 80 } as Record<string, number>, // PLACEHOLDER
  // Starting money by difficulty (CONFIRMED there is a difficulty setting; numbers PLACEHOLDER)
  DIFFICULTY: { easy: 1500, normal: 900, hard: 500 } as Record<string, number>, // PLACEHOLDER starting money (covers about a season of wages on normal)
  DEFAULT_DIFFICULTY: 'normal',
  // The boat drops them on the beach with crates (CONFIRMED contents; amounts PLACEHOLDER):
  // food for a few days, ammo, axes and shovels, tent canvas, rum and tobacco, a medical kit.
  START_CRATES: { ration: 15, ammo: 150, meds: 5, tobacco: 10, rum: 5, tools: 4, canvas: 3 } as Partial<Record<Item, number>>,
  CARGO_CAP: 40,
  // Requisitions: only the commander deals with the boat. He sells exports and orders for the NEXT boat (PROPOSED).
  REQ_TARGET: { ration: 20, ammo: 300, meds: 4, tobacco: 12, rum: 6 } as Partial<Record<Item, number>>, // stock he aims to hold
  REQ_RESERVE_CREDITS: 20,     // he keeps this much cash in hand if he can
  GUN_COST: 45, GEAR_COST: 10, // PLACEHOLDER new rifle / clothing-and-gear kit
  GEAR_WEAR_H: 0.35,           // gear condition lost per working hour (0-100)
  GEAR_ORDER_BELOW: 45,        // he orders a kit for a scout whose gear is worse than this
  GUN_JAM_BELOW: 0,            // (hook) gun condition effects come later

  // ---- Combat ----
  SCOUT_SIGHT_DAY_M: 75, SCOUT_SIGHT_NIGHT_M: 22, FIRE_LIGHT_M: 16, WATCH_SIGHT_MUL: 1.5, TOWER_SIGHT_MUL: 2.5,  // sight must exceed effective range or scouts only shoot up close
  SHOUT_M: 70,
  RAID_CALM_H: 10,             // PLACEHOLDER hours with no new raid after a raid pack pulls back (v1: at most ~2 raids a day)
  ALERT_M: 60, STAND_TO_SCORE: 5, LIFE_GOAL_MUL: 2, STASH_SCORE: 3.6, // camp alert radius; standing to beats sleep; rescue/treat priority multiplier
  EFFECTIVE_M: 60, MAX_RANGE_M: 85,  // PLACEHOLDER rifle ranges
  // Guns: mixed eras (CONFIRMED); loadout by role. Stats PLACEHOLDER, all invented, no real-world models.
  GUNS: {
    rifle:   { label: 'Long hunting rifle', mag: 5, reload: 30, eff: 70, max: 95, dmg: [40, 70], cone: 1.0, aim: 1.0, bolt: 1.0 },  // bolt action
    carbine: { label: 'Lever carbine', mag: 8, reload: 40, eff: 50, max: 75, dmg: [32, 58], cone: 1.25, aim: 0.8, bolt: 0.6 }, // lever: faster than a bolt
    pistol:  { label: 'Service pistol', mag: 7, reload: 25, eff: 22, max: 35, dmg: [24, 44], cone: 1.6, aim: 0.6, bolt: 0.4 },  // self-loading
  } as Record<string, { label: string; mag: number; reload: number; eff: number; max: number; dmg: number[]; cone: number; aim: number; bolt: number }>,
  LOADOUT_BY_RANK: [['carbine'], ['rifle'], ['carbine', 'pistol'], ['rifle', 'pistol']] as string[][], // Hand, Hunter, Foreman, Boss
  GUN_WEAR_PER_SHOT: 0.6, JAM_BELOW: 55, JAM_CLEAR_TICKS: 25, MAINT_H: 0.5, MAINT_BELOW: 60,
  MELEE_M: 1.8, MELEE_DMG: [12, 22], MELEE_EVERY: 9,  // rifle butt and bayonet
  BIRD_ATTACKS: ['beak stab', 'talon kick'],
  // Downed: survives until helped, but wounds worsen; Medicine stabilizes. PLACEHOLDER.
  DOWN_WOUND: [10, 45],        // PLACEHOLDER v1.2: how bad it is when a scout goes down (wound severity range, 100 = dead)...
  OVERKILL_WOUND: 1.5,         // PLACEHOLDER ...plus this per hp the blow went past zero
  MORTAL_WOUND: 65,            // PLACEHOLDER above this severity treatment can fail (chance grows to 100%; medicine skill and meds help)
  WOUND_WORSEN_H: 12,          // severity points per hour while downed and untreated (100 = dead)
  WOUND_MAXHP_LOSS: 0.2,       // fraction of severity that becomes permanent max-HP loss
  OTHER_THREATS: [] as string[], // stub: rival companies, bandits (Tabe has no natives) and other wildlife come later
  MAG: 5, RELOAD_TICKS: 30, CARRY_AMMO: 30,
  // Firing sequence (v1.2): crouch (CROUCH_TICKS) -> present (PRESENT_TICKS) -> aim -> shot -> bolt (BOLT_TICKS x gun.bolt) -> aim again
  PRESENT_TICKS: 5,            // PLACEHOLDER 0.5 s to bring the rifle up
  AIM_MAX_TICKS: 20, AIM_MIN_TICKS: 10,  // PLACEHOLDER aim time: 2 s at shooting skill 0, 1 s at skill 100 (then traits, gun.aim, wounds)
  SNAP_M: 15, SNAP_MUL: 0.6,   // PLACEHOLDER a bird inside this range gets a snap shot (less aim)
  MOVING_CONE: 1.5,            // PLACEHOLDER cone multiplier on a charging or fleeing bird
  SWITCH_KEEP: 0.3,            // share of aim kept when swinging onto a different bird
  BOLT_TICKS: 10,              // PLACEHOLDER ~1 s to work the bolt between shots
  CONE_SETTLE_TICKS: 20,       // PLACEHOLDER cone keeps tightening for 2 s of aim: aiming longer is more accurate
  CONE_START: 0.16, CONE_MIN: 0.05,  // PLACEHOLDER half-width of the aim cone as a fraction of distance (misses happen)
  CROUCH_TICKS: 4, CROUCH_CONE: 0.75,
  BULLET_MS: 260, BULLET_DMG: [34, 56],
  DANGER_M: 70,                // known bird closer than this puts scouts on alert
  COMBAT_EXIT_PAD_M: 15, COMBAT_CLEAR_HOLD: 50, // combat hysteresis (no flip-flopping at the edge of sight)
  ALL_CLEAR_S: 12,

  // ---- Wildlife ----
  DEER_HP: 60, DEER_WALK_MS: 0.6, DEER_RUN_MS: 4.5, DEER_FLEE_M: 22,
  HUNT_SHOT_M: 40,

  // ---- Roukha ----
  BIRD_HP: 100, BIRD_WALK_MS: 1.6, BIRD_RUN_MS: 6.0,  /* PLACEHOLDER v1.2: was 4.2, charges reach the line now */ BIRD_SIGHT_M: 100,
  PECK_DMG: 14, PECK_EVERY: 10, PECK_M: 1.4,  // PLACEHOLDER v1.2: every 1.0 s (was 0.8)
  PACK_SATED_DOWNS: 2,         // PLACEHOLDER a hunting pack that has put this many scouts down breaks off and goes home (no wipe-outs in one fight)
  MAX_ON_ONE: 2,               // PLACEHOLDER most birds that can be on one scout at once
  ODDS_RADIUS_M: 40,           // scouts this close to the prey count against the pack
  ODDS_W: { ready: 1, busy: 0.4, downed: 0.1 },  // decided weights (old slice)
  CHARGE_ODDS: 2.0, CHARGE_ODDS_NIGHT: 1.6,       // bolder at night (PLACEHOLDER)
  STALK_M_DAY: 60, STALK_M_NIGHT: 34, STALK_H: 0.8, BIRD_SIGHT_NIGHT_M: 60,
  BIRD_TOUGH: 1.4,             // PLACEHOLDER v1.2: damage to birds is divided by this (headshots excepted): fights take more shots
  BIRD_FLEE_HP: 35,            // a wounded bird below this runs for its nest alone, bleeding...
  BIRD_PRESS_ON: 0.4,          // PLACEHOLDER ...but in a charge with 2+ packmates still charging it only breaks below BIRD_FLEE_HP x this
  ROUT_ODDS: 1.0,              // after losses, odds below this keep shaking a charging pack (FEAR.badOdds every half second)
  FLINCH_TICKS: 4, FLINCH_M: 3, // gunfire: a bullet passing within FLINCH_M makes a bird hesitate briefly (small suppression)
  ROOKERY_GUARD_M: 45,         // the old far rookeries (map data) are kept as scenery and explorers still give them a wide berth
  EGGS_PER_ROOKERY: 6,         // in spring. Collecting eggs needs a player order (not in the zero-input sim)
  PACK_GRACE_H: 36,            // PLACEHOLDER no raids in the first 36 hours
  SCENT: { fire: 1, latrine: 1, food: 0.02, wounded: 2 },   // camp scent makes a hunt call more urgent
  // ---- Roukha v1.2: nests, hunting packs, fear. Species rules (home range, needs, mustering) are in SPECIES.roukha. ----
  NEST_BIRDS: [7, 9],          // PLACEHOLDER birds at each nest at the start (nest sites: data/maps/tabe_big.meta.json "nests")
  NEST_MAX: 10,                // PLACEHOLDER a nest refills (hatchlings, newcomers) up to this...
  NEST_REGROW_H: 14,           // PLACEHOLDER ...one bird per this many hours, never while a scout is watching
  HUNT_PACK: [4, 7],           // PLACEHOLDER size of a hunting pack the caller asks for (capped by birds at home; minimum SPECIES.roukha.team.minTeam)
  HUNT_HOURS: [15, 2],         // PLACEHOLDER birds set out to hunt between these hours (any time when starving)
  HUNT_NIGHT_URG: 0.6,         // PLACEHOLDER a hunt call is more urgent after dark (more birds drop what they're doing)
  HUNT_SCENT_URG: 0.4,         // PLACEHOLDER ...and when the camp smells of smoke, latrine and meat (cap)
  HUNT_COOL_H: 16,             // PLACEHOLDER a nest that sent out a pack calls no new hunt for this long
  HUNT_TRIP_H: 9,              // PLACEHOLDER a hunting pack that finds no opening heads home after this long
  HUNT_FED: 45,                // PLACEHOLDER hunger points a pack gets back from a hunt trip (they catch something on the way)
  HUNT_SHARE: 0.5,             // PLACEHOLDER ...and the birds that stayed home get this share of it (scraps brought back); half again after a retreat
  FEED_GAIN_H: 2.0,            // PLACEHOLDER hunger points per hour while feeding at home: picking around the nest keeps them going, but hungry birds go hunting
  MAX_HUNTS_OUT: 1,            // PLACEHOLDER hunting packs out at once, island-wide
  BIRD_TROT_MS: 2.8,           // a hunting pack's travelling pace
  NEST_GUARD_M: 45,            // scouts this close to a nest are charged at worse odds (NEST_ODDS_MOD)...
  NEST_ODDS_MOD: -0.6,         // PLACEHOLDER
  NEST_AVOID_PAD_M: 30,        // PLACEHOLDER explorers keep this far beyond a known nest's home range (SPECIES.roukha.home.safeR)
  // Fear (pack morale, 0-100ish). Shock from losses and wounds fades over time; gunfire adds a little (capped);
  // being far from the nest adds up to 'far'. A pack with shock > 0 and fear >= breakAt retreats to its nest.
  // Not cowards: gunCap + far stays below breakAt, so gunfire alone never breaks them. A loss counts less in a pack bigger
  // than lossRef; a bite that lands takes 'bite' off, putting a scout down takes 'downed' off (winning steadies them).
  FEAR: { loss: 18, lossRef: 5, bite: 3, downed: 20, bull: 30, wound: 5, gunfire: 1.2, gunCap: 22, far: 15, decayH: 25, gunDecayH: 40, badOdds: 1, breakAt: 75 },  // PLACEHOLDER
  CHARGE_MAX_S: 40,
  CHARGE_REACH_M: 120,         // a charging pack gives up when no standing scout is within this of it
};
export type Config = typeof CFG;

// ---------- Species data for the shared AI modules (src/sim/agent) ----------
// Every creature runs the same needs/utility, home-comfort and help-request modules; this table is what makes a
// scout a scout and a Roukha a Roukha. Add a species by adding an entry (and an adapter where it acts).
const needRules = (ids: NeedId[]): Record<string, { decayH: number; seek: number; urgent: number }> => {
  const o: Record<string, { decayH: number; seek: number; urgent: number }> = {};
  for (const k of ids) o[k] = { decayH: CFG.NEED_DECAY_H[k], seek: CFG.NEED_SEEK[k], urgent: CFG.NEED_URGENT };
  return o;
};
export const SPECIES = {
  scout: {
    // home = the camp. Beyond safeR (the camp perimeter) work is done as a team (TEAM_SIZE says how many).
    home: { safeR: 40, edgeR: 400, awayGroup: 2 },   // PLACEHOLDER safeR is the old FAR_M
    team: {
      dropMargin: 0.3,    // PLACEHOLDER a man drops what he's doing if its value + this <= the request's urgency
      promiseMaxH: 0.35,  // PLACEHOLDER "gimme a sec": he promises to come if his job is done within this many hours
      waitH: 0.8,         // PLACEHOLDER with nobody coming after this long the leader falls back (smaller team, or cancel)
      waitMaxH: 1.6,      // PLACEHOLDER ...and even with promises outstanding, after this long
      reaskH: 0.2,        // a man who said no is asked again after this long
      linkM: 6,           // the team leaves once everyone is within this of the leader
      minTeam: 2,         // a smaller team may go if it is at least a pair (solo only on low-risk jobs, see team.ts)
    },
    needs: needRules(['food', 'water', 'rest', 'warmth', 'social', 'fitness']),
  },
  roukha: {
    // home = the nest. Inside safeR birds loaf and feed in ones, twos and threes; nobody goes beyond it in a
    // group smaller than awayGroup. Comfort falls to 0 at edgeR, and fear builds faster the farther from home.
    home: { safeR: 70, edgeR: 300, awayGroup: 4 },   // PLACEHOLDER
    team: {
      dropMargin: 0.3,    // PLACEHOLDER
      promiseMaxH: 0.5,   // PLACEHOLDER "gimme a sec" (finishing a feed)
      waitH: 1.0,         // PLACEHOLDER mustering gives up after this long with no promises...
      waitMaxH: 2.0,      // PLACEHOLDER ...or this long at most
      reaskH: 0.3,
      linkM: 12,          // the pack leaves once all are within this of the leader
      minTeam: 4,         // PLACEHOLDER a hunting pack is 4 at the very least: fewer and they stay home
    },
    needs: { hunger: { decayH: 1.2, seek: 60, urgent: 25 } } as Record<string, { decayH: number; seek: number; urgent: number }>,  // PLACEHOLDER
  },
};
export type SpeciesId = keyof typeof SPECIES;

// All scouts are men from mixed backgrounds (CONFIRMED). Original invented names.
export const NAMES = ['Jonas', 'Pell', 'Rook', 'Abel', 'Corin', 'Kofi', 'Mateo', 'Ilya', 'Ravi', 'Tomas', 'Hale', 'Tobin', 'Marek', 'Ivo', 'Wendel', 'Silas', 'Brann', 'Odo', 'Fenn', 'Lucan', 'Garrit', 'Emil', 'Tamsin', 'Ansel', 'Dorn'];
export const TRAITS: Trait[] = TRAIT_PAIRS.flat();
export const TRAITS_PER_SCOUT: [number, number] = [1, 2];  // v1: 1-2 traits (design allows up to 3)

