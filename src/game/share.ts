import { MAX_VERTS, PHYSICS_VERSION } from '../config';
import { checkParts } from './placement';
import { buildGeom, validateTable } from '../geom/table';
import type { ShotQ } from '../physics/launch';
import type { ReplaySource } from './game';
import type { TurnRecord } from './record';
import type { Mode } from './ruleset';
import type { GameState } from './serialize';

/**
 * Shared shots: one recorded stroke packed into a link (`#s=...`). The link carries the board as
 * it was just before the shot (exact float positions), the quantized shot, and a fingerprint of
 * where everything came to rest, so whoever opens it watches exactly the same shot, and can tell
 * if their copy of the game plays it out differently.
 *
 * Format: 'z' + base64url(deflate-raw(JSON)), or 'j' + base64url(JSON) where the browser cannot
 * compress. Links are untrusted input: decoding checks every field before anything uses it.
 */
export interface SharedShot {
  v: 1;
  /** The physics version that recorded it (another version may play it out differently). */
  pv: number;
  mode: Mode;
  name: string | null;
  pre: GameState;
  stroke: number;
  aim: number;
  shot: ShotQ;
  postHash: number;
}

export function sharedFromRecord(rec: TurnRecord, mode: Mode, name: string | null): SharedShot {
  // The toys still in the tray do not matter to a replay.
  const pre = { ...rec.pre, tray: [] };
  return {
    v: 1,
    pv: PHYSICS_VERSION,
    mode,
    name,
    pre,
    stroke: rec.stroke,
    aim: rec.aim,
    shot: rec.shot,
    postHash: rec.postHash,
  };
}

export function replaySourceOf(s: SharedShot): ReplaySource {
  return { pre: s.pre, stroke: s.stroke, aim: s.aim, shot: s.shot, postHash: s.postHash };
}

// ---------------------------------------------------------------- bytes

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(
  bytes: Uint8Array,
  through: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough<Uint8Array>(through);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Links longer than this are not worth trusting (or decompressing). */
const MAX_CODE = 24_000;
const MAX_JSON = 200_000;

export async function encodeShot(s: SharedShot): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(s));
  if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(json);
  return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeShot(code: string): Promise<SharedShot | null> {
  try {
    if (code.length > MAX_CODE || !/^[zj][A-Za-z0-9_-]+$/.test(code)) return null;
    const bytes = fromBase64Url(code.slice(1));
    let raw: Uint8Array;
    if (code[0] === 'j') raw = bytes;
    else if (typeof DecompressionStream === 'undefined') return null;
    else raw = await pipe(bytes, new DecompressionStream('deflate-raw'));
    if (raw.length > MAX_JSON) return null;
    const s: unknown = JSON.parse(new TextDecoder().decode(raw));
    return isSharedShot(s) ? s : null;
  } catch {
    return null;
  }
}

/** The page address with a shot attached. */
export function shareUrl(code: string, loc: { origin: string; pathname: string }): string {
  return `${loc.origin}${loc.pathname}#s=${code}`;
}

/** The shot code in a page address's hash, if there is one. */
export function codeFromHash(hash: string): string | null {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------- checking a link

const MODES: readonly Mode[] = ['free', 'classic', 'toybox', 'viewer'];
const PART_KINDS = [
  'stub',
  'arc',
  'bumper',
  'glass',
  'gate',
  'booster',
  'felt',
  'magnet',
  'blackhole',
  'portal',
  'bullseye',
];
const FELTS = ['ice', 'mud', 'sand', 'conveyor', 'fan'];
const MATS = ['felt', 'steel', 'trampoline', 'dead'];
const TRAITS = ['corked', 'picky', 'chomper', 'gentle'];
const VARIANTS = ['normal', 'bowling', 'egg', 'bomb', 'chicken', 'ghost', 'golden'];

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, lim = 1e5): x is number =>
  typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim;
const int = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const str = (x: unknown, max = 64): x is string => typeof x === 'string' && x.length <= max;

/** Every number in a value (however deeply nested) is finite and sane, and it is not too big. */
function saneTree(x: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof x === 'number') return num(x, 1e10);
  if (typeof x === 'string') return x.length <= 64;
  if (typeof x === 'boolean' || x === null) return true;
  if (Array.isArray(x)) return x.length <= 64 && x.every((v) => saneTree(v, depth + 1));
  if (isObj(x)) {
    const keys = Object.keys(x);
    return keys.length <= 40 && keys.every((k) => saneTree(x[k], depth + 1));
  }
  return false;
}

function isPart(p: unknown): boolean {
  if (!isObj(p) || !int(p['id'], 0, 1e6) || !num(p['x']) || !num(p['y'])) return false;
  if (!str(p['kind']) || !PART_KINDS.includes(p['kind'])) return false;
  if (p['kind'] === 'felt' && !(str(p['felt']) && FELTS.includes(p['felt']))) return false;
  if (p['kind'] === 'blackhole' && !(Array.isArray(p['exits']) && p['exits'].length <= 8)) return false;
  return true;
}

function isBall(b: unknown): boolean {
  return (
    isObj(b) &&
    int(b['id'], 0, 1e6) &&
    int(b['num'], 0, 99) &&
    (b['kind'] === 'cue' || b['kind'] === 'object') &&
    num(b['x']) &&
    num(b['y']) &&
    num(b['vx']) &&
    num(b['vy']) &&
    typeof b['active'] === 'boolean' &&
    str(b['variant']) &&
    VARIANTS.includes(b['variant']) &&
    num(b['invMass']) &&
    (b['invMass'] as number) > 0 &&
    (b['gone'] === null || b['gone'] === 'pocketed' || b['gone'] === 'broken' || b['gone'] === 'exploded')
  );
}

function isSharedShot(s: unknown): s is SharedShot {
  if (!isObj(s) || s['v'] !== 1 || !num(s['pv']) || !str(s['mode']) || !MODES.includes(s['mode'] as Mode))
    return false;
  if (!(s['name'] === null || str(s['name'], 40))) return false;
  if (!int(s['stroke'], 1, 1e6) || !num(s['aim'], 10) || !int(s['postHash'], 0, 0xffffffff)) return false;
  const shot = s['shot'];
  if (!isObj(shot) || !num(shot['dx']) || !num(shot['dy']) || !int(shot['p'], 0, 1000)) return false;
  if (!int(shot['ex'], -100, 100) || !int(shot['ey'], -100, 100)) return false;
  const pre = s['pre'];
  if (!isObj(pre) || !saneTree(pre) || !int(pre['seed'], 0, 0xffffffff) || !int(pre['shots'], 0, 1e6))
    return false;
  if (!num(pre['penalties']) || !int(pre['hunger'], 0, 3)) return false;
  const table = pre['table'];
  if (!isObj(table) || !Array.isArray(table['verts']) || !Array.isArray(table['parts'])) return false;
  if (!int(table['nextId'], 0, 1e6)) return false;
  const verts = table['verts'] as unknown[];
  if (verts.length < 3 || verts.length > MAX_VERTS) return false;
  for (const v of verts) {
    if (
      !isObj(v) ||
      !int(v['id'], 0, 1e6) ||
      !num(v['x']) ||
      !num(v['y']) ||
      typeof v['pocket'] !== 'boolean'
    )
      return false;
    if (v['mat'] !== undefined && !(str(v['mat']) && MATS.includes(v['mat']))) return false;
    if (
      v['trait'] !== undefined &&
      !(isObj(v['trait']) && str(v['trait']['kind']) && TRAITS.includes(v['trait']['kind']))
    )
      return false;
  }
  const parts = table['parts'] as unknown[];
  if (parts.length > 40 || !parts.every(isPart)) return false;
  const balls = pre['balls'];
  if (!Array.isArray(balls) || balls.length < 1 || balls.length > 16 || !balls.every(isBall)) return false;
  if ((balls[0] as Record<string, unknown>)['kind'] !== 'cue') return false;
  if (new Set(balls.map((b) => (b as Record<string, unknown>)['id'])).size !== balls.length) return false;
  // The board must be one the game itself could have made.
  const t = table as unknown as GameState['table'];
  try {
    const geom = buildGeom(t, pre['hunger'] as number);
    return validateTable(t, geom).ok && checkParts(t, geom).ok;
  } catch {
    return false;
  }
}
