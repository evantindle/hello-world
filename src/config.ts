/**
 * Every tunable number lives here. World units: the starting table is 1000 x 500.
 * Canvas convention: +x right, +y down. A polygon with positive signed area has its
 * interior on the LEFT of each edge, where left of (dx, dy) is (-dy, dx).
 */

export const GAME_TITLE = 'Bendy Billiards';

// ---------------------------------------------------------------- table & view
export const R = 24; // ball radius
export const TABLE_W = 1000;
export const TABLE_H = 500;
/** Vertices may be dragged this far outside the starting rectangle. */
export const PLAY_MARGIN = 100;
export const PLAY = {
  minX: -PLAY_MARGIN,
  minY: -PLAY_MARGIN,
  maxX: TABLE_W + PLAY_MARGIN,
  maxY: TABLE_H + PLAY_MARGIN,
};
/** World units visible around the starting rectangle (rails + knobs + breathing room). */
export const VIEW_MARGIN = 150;
/** Visual thickness of the wooden rail, drawn outside the collision line. */
export const RAIL_W = 30;

// ---------------------------------------------------------------- pockets
/** Rails stop this far short of an open pocket vertex (the pocket "mouth"). */
export const MOUTH = 2.3 * R;
/** The hole centre sits this far outside the vertex, along the outward bisector. */
export const HOLE_OFFSET = 0.7 * R;
/** A ball whose centre gets this close to the hole centre drops in. */
export const CAPTURE_R = 1.7 * R;
/** Balls inside this radius feel a pull toward the hole (hangers get slurped). */
export const SUCTION_R = 3 * R;
export const SUCTION_A = 1300;
/**
 * Hungry pockets: every shot that pots nothing makes the holes bigger and pull harder
 * (up to level 3). Potting a ball feeds them back to level 0. Scales CAPTURE_R / SUCTION_R.
 */
export const HUNGER_CAPTURE = [1, 1.2, 1.4, 1.65] as const;
export const HUNGER_SUCTION = [1, 1.12, 1.25, 1.4] as const;
export const MAX_HUNGER = 3;
/** The cue ball is harder to swallow: its capture radius (no hunger bonus, no suction). */
export const CUE_CAPTURE_R = 0.75 * CAPTURE_R;
/** Below this interior angle a pocket mouth is narrower than a ball: it closes. */
export const POCKET_OPEN_MIN_DEG = 56;

// ---------------------------------------------------------------- reshaping
export const MIN_EDGE = 5 * R;
export const MIN_CLEARANCE = 2 * R;
export const MIN_AREA_FRAC = 0.4;
export const MAX_VERTS = 12;
export const MIN_ANGLE_DEG = 20;
export const MAX_ANGLE_DEG = 340;
/** Stretch budget per turn, in world units of vertex travel. */
export const BUDGET = 600;
/** Reshaping may not bring a ball inside an open hole's suction radius (no free pots). */
/** Max vertex travel per validated reshape sub-step. */
export const RESHAPE_STEP = R / 2;

// ---------------------------------------------------------------- physics
export const H = 1 / 120; // fixed step
export const MAX_MOVE = R / 2; // max travel per substep (no tunnelling)
export const MAX_SUBSTEPS = 8;
export const SOLVER_ITERS = 3;
export const V_MAX = 3000;
export const V_STOP = 6;
export const A_ROLL = 220; // rolling deceleration, u/s^2
export const K_DRAG = 0.2; // proportional drag, 1/s
/** After the cue ball first smacks an object ball it gets dizzy and skids to a stop this much harder. */
export const CUE_BRAKE = 4;
/** ...and a cue ball that has bounced off this many cushions without hitting anything gets tired. */
export const CUE_TIRED_RAILS = 3;
export const E_BALL = 0.95;
export const E_WALL = 0.9;
export const T_DAMP = 0.97; // tangential damping on rail hits
export const REST_SPEED = 20; // below this closing speed, contacts are inelastic
export const SIM_TIMEOUT = 25; // seconds of sim time before the ref calls it
export const SETTLE_GRACE = 0.2;
export const HIT_EVENT_MIN = 40;

// ---------------------------------------------------------------- shot
export const V_SHOT_MIN = 350;
export const V_SHOT_MAX = 2300;
export const CHARGE_TIME = 1.2;
export const TAP_CANCEL = 0.12;
export const STRIKE_HOLD = 0.07;
export const STRIKE_LUNGE = 0.06;

// ---------------------------------------------------------------- flow
export const SPIN_TIME = 2.4;
export const RESOLVE_DELAY = 0.55;
export const RESPAWN_TIME = 1.25;
export const SLOWMO_SCALE = 0.25;
export const SLOWMO_MAX = 2.2; // real seconds of slow-mo per game at most per approach
export const PAR = 20;

// ---------------------------------------------------------------- rack
export const CUE_START = { x: 250, y: 250 };
export const RACK_APEX = { x: 700, y: 250 };

// ---------------------------------------------------------------- look
export const COLORS = {
  ink: '#1c1233',
  bgA: '#35205f',
  bgB: '#2b1850',
  felt: '#19a67f',
  feltLight: '#2fcf9f',
  feltDark: '#0f7a5e',
  cushion: '#0c6a51',
  feltDot: 'rgba(255,255,255,0.10)',
  wood: '#c86b2c',
  woodLight: '#f09a55',
  woodDark: '#6e3313',
  hole: '#0d0819',
  holeRim: '#4a2a12',
  knob: '#ffd23f',
  knobDark: '#c9900a',
  knobHot: '#ff5d8f',
  nope: '#ff3b3b',
  guide: '#ffffff',
  cue: '#fff8e7',
};

/** Object balls 1..10. 9 and 10 wear stripes. */
export const BALL_COLORS = [
  '#ffc93c', // 1 yellow
  '#3a86ff', // 2 blue
  '#ff4040', // 3 red
  '#8e44ec', // 4 purple
  '#ff8a1f', // 5 orange
  '#10c98f', // 6 green
  '#c2415f', // 7 maroon
  '#2b2d42', // 8 black
  '#ffc93c', // 9 yellow stripe
  '#3a86ff', // 10 blue stripe
];
