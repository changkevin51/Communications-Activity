import { pick, type Rng } from '../rng';

export const ADJECTIVES = [
  'VELVET', 'AMBER', 'COBALT', 'SILVER', 'QUIET', 'NEON', 'LUNAR', 'SOLAR', 'MISTY', 'COPPER',
  'IVORY', 'CRIMSON', 'ARCTIC', 'DUSTY', 'GOLDEN', 'HOLLOW', 'JADE', 'MOSSY', 'NIMBLE', 'OCHRE',
  'PLUSH', 'RAPID', 'SCARLET', 'SWIFT', 'TIDAL', 'UMBER', 'VIVID', 'WILD', 'ZEPHYR', 'BRIGHT',
  'CEDAR', 'DAWN', 'EMBER', 'FERN', 'GLASS', 'HAZEL', 'INDIGO', 'KITE', 'LINEN', 'MAPLE',
];

export const NOUNS = [
  'MOTH', 'HERON', 'OTTER', 'FALCON', 'LYNX', 'COMET', 'RAVEN', 'MARTEN', 'SPARROW', 'BISON',
  'CRANE', 'GECKO', 'IBIS', 'KOALA', 'LARK', 'MANTA', 'NEWT', 'ORCA', 'PANDA', 'QUAIL',
  'ROBIN', 'SEAL', 'TAPIR', 'VIPER', 'WREN', 'YAK', 'BADGER', 'CORAL', 'DINGO', 'EGRET',
  'FINCH', 'GROUSE', 'HARE', 'JACKAL', 'KESTREL', 'LEMUR', 'MINK', 'OWL', 'PUFFIN', 'STOAT',
];

export function makeCodename(rng: Rng, taken: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const name = `${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)}`;
    if (!taken.has(name)) return name;
  }
  for (let n = 2; ; n++) {
    const name = `${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)} ${n}`;
    if (!taken.has(name)) return name;
  }
}
