import type { PartPreset, TrayItem } from './placement';

/**
 * The standard toy box: one preset per kind of toy, as it comes out of the tray. Directions are
 * table directions (multiples of 5 degrees, x1000).
 */
export const TOY_PRESETS: readonly PartPreset[] = [
  { kind: 'stub', dir: { x: 1000, y: 0 }, len: 140 },
  { kind: 'arc', r: 110, from: { x: 1000, y: 0 }, to: { x: 0, y: 1000 } },
  { kind: 'bumper', r: 28 },
  { kind: 'glass', dir: { x: 1000, y: 0 }, len: 130, hp: 2 },
  { kind: 'gate', dir: { x: 1000, y: 0 }, len: 110 },
  { kind: 'booster', dir: { x: 1000, y: 0 }, len: 120, wid: 70, kick: 650 },
  { kind: 'felt', felt: 'ice', dir: { x: 1000, y: 0 }, w: 220, h: 140 },
  { kind: 'felt', felt: 'mud', dir: { x: 1000, y: 0 }, w: 180, h: 120 },
  { kind: 'felt', felt: 'sand', dir: { x: 1000, y: 0 }, w: 200, h: 130 },
  { kind: 'felt', felt: 'conveyor', dir: { x: 1000, y: 0 }, w: 260, h: 80 },
  { kind: 'felt', felt: 'fan', dir: { x: 1000, y: 0 }, w: 240, h: 110 },
  { kind: 'magnet', polarity: 1, r: 140, strength: 1100 },
  { kind: 'magnet', polarity: -1, r: 120, strength: 1000 },
  { kind: 'blackhole', r: 100, exits: [] },
  { kind: 'portal', link: -1, r: 38 },
];

/** A tray with `count` of every toy. */
export function fullTray(count = 1): TrayItem[] {
  return TOY_PRESETS.map((preset) => ({ preset: structuredClone(preset), count }));
}
