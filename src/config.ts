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
/**
 * Angle thresholds as the (cos, sin) of the matching turn angle PI - threshold, written out as
 * literals so the comparisons need no trig (whose last bit varies by browser). A unit test keeps
 * them in step with the degree values.
 */
export const POCKET_OPEN_TURN = { c: -0.5591929034707467, s: 0.8290375725550417 }; // 180 - 56

// ---------------------------------------------------------------- reshaping
export const MIN_EDGE = 5 * R;
export const MIN_CLEARANCE = 2 * R;
export const MIN_AREA_FRAC = 0.4;
export const MAX_VERTS = 12;
export const MIN_ANGLE_DEG = 20;
export const MAX_ANGLE_DEG = 340;
export const MIN_ANGLE_TURN = { c: -0.9396926207859083, s: 0.3420201433256689 }; // 180 - 20
export const MAX_ANGLE_TURN = { c: -0.9396926207859083, s: -0.3420201433256689 }; // 180 - 340
/** Stretch budget per turn, in world units of vertex travel. */
export const BUDGET = 600;
/** Reshaping may not bring a ball inside an open hole's suction radius (no free pots). */
/** Max vertex travel per validated reshape sub-step. */
export const RESHAPE_STEP = R / 2;

// ---------------------------------------------------------------- physics
/** Bumped whenever a physics change makes old recordings (shared shots, level solutions) play out
 * differently. */
export const PHYSICS_VERSION = 1;
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

// ---------------------------------------------------------------- English (cue spin)
/** Cloth friction while the cue ball skids (slip = contact velocity), u/s^2. */
export const A_SLIDE = 2500;
/** Below this slip the ball counts as rolling. */
export const SLIP_EPS = 1;
/** Draw/follow strength: banked spin = ey * K_ROLL * launch speed. */
export const K_ROLL = 1.0;
/** Banked draw/follow wears off over roughly this much travel. */
export const SPIN_RANGE = 900;
/** Sideways slip per unit of side English; 3.5 * tan(25deg), so a full curve bends exactly 25deg. */
export const K_C = 1.632;
/** Sidespin (cushion throw) per unit of side English. */
export const K_SIDE = 1.0;
/** Cushion throw per unit of sidespin... */
export const K_THROW = 0.35;
/** ...capped by cushion friction: at most MU_C (1 + e) |vn|. */
export const MU_C = 0.25;
/** Fraction of sidespin left after a cushion. */
export const WZ_RAIL_KEEP = 0.5;
/** Sidespin decay per second. */
export const WZ_DECAY = 0.6;

// ---------------------------------------------------------------- toys & oddball balls
/** Bumpers send balls away this much faster than they arrived (and at least BUMPER_MIN)... */
export const BUMPER_E = 1.25;
export const BUMPER_MIN = 320;
/** ...for their first few kicks each shot, so two bumpers cannot juggle a ball forever. */
export const BUMPER_KICKS = 8;
/** A hit harder than this (closing speed) cracks a glass pane or an egg. */
export const GLASS_HIT = 450;
export const EGG_CRACK = 700;
/** Bomb blast: radius and push at the centre. */
export const BLAST_R = 180;
export const BLAST_V = 900;
/** The chicken runs (on its legs: no rolling friction) from a moving cue ball within this range,
 * this keenly, this fast at most. */
export const CHICKEN_R = 200;
export const CHICKEN_A = 3000;
export const CHICKEN_VMAX = 900;

// ---------------------------------------------------------------- floor toys
/** Felt patches: multipliers on rolling friction and on drag. Sand eats fast balls (drag),
 * mud eats slow ones (rolling friction), ice lets everything glide. */
export const ICE_ROLL = 0.25;
export const ICE_DRAG = 0.25;
export const MUD_ROLL = 3.5;
export const MUD_DRAG = 1;
export const SAND_ROLL = 1.5;
export const SAND_DRAG = 6;
/** Default conveyor belt speed and fan push (u/s^2). */
export const CONVEYOR_SPEED = 260;
export const FAN_PUSH = 420;
/** A belt grips balls this many times harder than felt (friction acts relative to the belt)... */
export const BELT_GRIP = 3;
/** ...and deadens their bounces off rails and toys, so a belt pins a ball instead of juggling it. */
export const BELT_BOUNCE = 0.3;
/** Magnets: inside this fraction of the radius the pull fades to nothing and damps the ball, so
 * a caught ball settles on the magnet instead of orbiting it. */
export const MAGNET_CORE = 0.25;
export const CORE_DAMP = 6;
/** Black hole: pull at the centre, how close a ball's centre must get to be swallowed, how long it
 * stays gone, and how fast it comes back out. */
export const BLACKHOLE_PULL = 1500;
export const BLACKHOLE_CORE = 24;
export const LIMBO_TIME = 0.6;
export const BLACKHOLE_EXIT_V = 300;
/** A ball leaving a portal cannot warp again until it is this far outside the exit disc. */
export const PORTAL_SLACK = 1;
/** Each speed pad kicks at most this many times a shot (a pad aimed at a rail cannot juggle). */
export const BOOST_KICKS = 6;
/** Stuck detector for tables with floor toys: if over one window every moving ball was pushed by a
 * toy and stayed inside a box this small (a belt bouncing a ball off a rail), the shot is over. */
export const STUCK_WINDOW = 1;
export const STUCK_BOX = 3 * R;

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
/** Holding fast-forward runs the sim this many times faster. */
export const FF_SCALE = 3;
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

/** Oddball balls wear their own colours (normal balls and the ghost keep their number's). */
export const VARIANT_COLORS: Partial<
  Record<'normal' | 'bowling' | 'egg' | 'bomb' | 'chicken' | 'ghost' | 'golden', string>
> = {
  bowling: '#2e3150',
  egg: '#fff3dc',
  bomb: '#26283d',
  chicken: '#fffdf5',
  golden: '#ffcc33',
};
