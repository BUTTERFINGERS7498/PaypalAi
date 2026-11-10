// Request sets for the on-server semantic engine, shared by tests/engine.test.ts and scripts/engine-bench.ts.
// Each entry: [request, acceptable SKUs].

/** The original hand-written set. The concept map was tuned on it, so a perfect score here is not proof. */
export const CASES: [string, string[]][] = [
  ['restock the pantry basics', ['GRO-PANTRY-42', 'GRO-PANTRY-51']], ['breakfast stuff', ['GRO-OAT-01', 'GRO-MILK-01', 'GRO-COFFEE-01']],
  ['something for pasta night', ['GRO-PASTA-01']], ['I need to clean the house', ['HOU-CLEAN-01']], ['cheap headphones', ['ELE-HEAD-01']],
  ['coffee', ['GRO-COFFEE-01']], ['a gaming system', ['ELE-GAME-01']], ['fresh fruit', ['GRO-APPLE-01']],
  ['dinner staples like rice or beans', ['GRO-RICE-01', 'GRO-BEAN-01']], ['a milk alternative', ['GRO-MILK-01']],
  ['wireless earbuds for music', ['ELE-HEAD-01']], ['make espresso at home', ['ELE-ESP-01', 'GRO-COFFEE-01']],
  ['healthy grain for porridge', ['GRO-OAT-01']], ['a nice cooking oil gift', ['GRO-OIL-01']],
  ['something warm to drink in the morning', ['GRO-COFFEE-01']], ['tools to scrub the kitchen', ['HOU-CLEAN-01']],
  ['black beans', ['GRO-BEAN-01']], ['games console', ['ELE-GAME-01']],
];

/** Written AFTER the concept map was tuned, to measure it honestly. 14/15 at the time of writing
 *  (the request for canned beans goes to coffee beans: the model links the word beans to coffee). */
export const HELD_OUT: [string, string[]][] = [
  ['oatmeal for the kids', ['GRO-OAT-01']], ['a hot beverage for the office', ['GRO-COFFEE-01']], ['music on my commute', ['ELE-HEAD-01']],
  ['mop the floors', ['HOU-CLEAN-01']], ['dairy-free milk', ['GRO-MILK-01']], ['noodles for dinner', ['GRO-PASTA-01']],
  ['an apple a day', ['GRO-APPLE-01']], ['a bag of rice', ['GRO-RICE-01']], ['canned beans', ['GRO-BEAN-01']],
  ['video games for the weekend', ['ELE-GAME-01']], ['a coffee maker', ['ELE-ESP-01']], ['olive oil', ['GRO-OIL-01']],
  ['caffeine fix', ['GRO-COFFEE-01']], ['stock the cupboard', ['GRO-PANTRY-42', 'GRO-PANTRY-51']], ['earphones', ['ELE-HEAD-01']],
];

/** Things the catalog does not sell: the right answer is no_match. */
export const NEGATIVES = ['buy a pair of running shoes', 'get some tea bags', 'I want a new laptop', 'order a bicycle', 'a garden hose', 'buy a winter jacket'];
