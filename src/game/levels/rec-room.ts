import type { LevelDef } from './types';

/** The standard six pockets, for levels that start from the plain table. */
const RECT = (): LevelDef['shape'] => [
  { x: 0, y: 0, pocket: true },
  { x: 500, y: 0, pocket: true },
  { x: 1000, y: 0, pocket: true },
  { x: 1000, y: 500, pocket: true },
  { x: 500, y: 500, pocket: true },
  { x: 0, y: 500, pocket: true },
];

/**
 * The Rec Room: twelve tables, each built around one or two mechanics. Every level has a recorded
 * solution (tests/levels/solutions) that CI plays through the real game.
 */
export const REC_ROOM: readonly LevelDef[] = [
  {
    id: 'rr-01',
    n: 1,
    name: 'BEND HERE',
    blurb: "The cue only goes where it goes. So move the pocket to where the ball's going.",
    teaches: 'BENDING',
    shape: RECT(),
    balls: [
      { num: 0, x: 250, y: 250 },
      { num: 1, x: 600, y: 250 },
    ],
    angles: [0],
    shots: 1,
    tokens: 2,
    reach: 280,
    english: false,
    goal: { kind: 'clearAll' },
    stars: { three: { tokens: 1 }, two: { tokens: 2 } },
    hint: 'Grab the top-right knob and pull the pocket down into the ball’s path.',
  },
  {
    id: 'rr-02',
    n: 2,
    name: 'BOLTED DOWN',
    blurb: 'Every corner is bolted to the floor. The rails between them, though... those still bend.',
    teaches: 'BOLTS & NEW BENDS',
    shape: [
      { x: 0, y: 0, pocket: true, bolted: true },
      { x: 500, y: 0, pocket: true },
      { x: 1000, y: 0, pocket: true, bolted: true },
      { x: 1000, y: 500, pocket: true, bolted: true },
      { x: 500, y: 500, pocket: true },
      { x: 0, y: 500, pocket: true, bolted: true },
    ],
    balls: [
      { num: 0, x: 420, y: 250 },
      { num: 2, x: 700, y: 250 },
      { num: 6, x: 180, y: 250 },
    ],
    angles: [0, 180],
    shots: 2,
    tokens: 3,
    reach: 220,
    english: false,
    goal: { kind: 'clearAll' },
    stars: { three: { tokens: 2 }, two: { tokens: 3 } },
    hint: 'Grab the ＋ in the middle of a rail to add a bend, then pull it to angle the rail.',
  },
  {
    id: 'rr-03',
    n: 3,
    name: 'BOING BOING',
    blurb: 'Bouncy rails, three bumpers that hit back, and one job: bank a ball in off two cushions.',
    teaches: 'BUMPERS & BOUNCY RAILS',
    shape: [
      { x: 0, y: 0, pocket: true, mat: 'trampoline' },
      { x: 500, y: 0, pocket: true, mat: 'trampoline' },
      { x: 1000, y: 0, pocket: true },
      { x: 1000, y: 500, pocket: true, mat: 'trampoline' },
      { x: 500, y: 500, pocket: true, mat: 'trampoline' },
      { x: 0, y: 500, pocket: true },
    ],
    balls: [
      { num: 0, x: 160, y: 250 },
      { num: 3, x: 760, y: 250 },
    ],
    parts: [
      { id: 101, kind: 'bumper', x: 420, y: 250, r: 30, locked: true },
      { id: 102, kind: 'bumper', x: 600, y: 140, r: 30, locked: true },
      { id: 103, kind: 'bumper', x: 600, y: 360, r: 30, locked: true },
    ],
    angles: [20, 200],
    shots: 2,
    tokens: 2,
    reach: 200,
    english: false,
    goal: { kind: 'bank', cushions: 2 },
    stars: { three: { score: 1, tokens: 1 }, two: { score: 1 } },
    hint: 'Watch the guide bounce. A small bend near where it lands goes a long way.',
  },
];

export function levelById(id: string): LevelDef | undefined {
  return REC_ROOM.find((l) => l.id === id);
}
