// Numerical sanity checks for the massive-body integrator.
// Run: npm test   (Node >= 22.18 runs TypeScript directly)
import { World } from '../src/physics/world.ts';
import { PERIODIC_ORBITS } from '../src/scenes/orbits.ts';
import { randomChaos } from '../src/scenes/threebody.ts';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
}

function stateDistance(w: World, init: number[][]) {
  let d = 0;
  w.bodies.forEach((b, i) => {
    const s = [...b.x, ...b.v];
    for (let k = 0; k < 6; k++) d = Math.max(d, Math.abs(s[k] - init[i][k]));
  });
  return d;
}

// 1. Periodic orbits return to their initial state after one period.
for (const orbit of PERIODIC_ORBITS) {
  const w = new World({ rtol: 1e-12, atol: 1e-14, collisions: false });
  const [p1, p2] = orbit.p;
  const init = [
    [-1, 0, 0, p1, p2, 0],
    [1, 0, 0, p1, p2, 0],
    [0, 0, 0, -2 * p1, -2 * p2, 0],
  ];
  for (const s of init) w.add({ m: 1, x: [s[0], s[1], s[2]], v: [s[3], s[4], s[5]] });
  const E0 = w.energy();
  // Integrate to just before T, then find the closest return near T.
  w.advance(orbit.T * 0.98);
  let best = Infinity;
  const steps = 400;
  for (let i = 0; i < steps; i++) {
    w.advance((orbit.T * 0.04) / steps);
    best = Math.min(best, stateDistance(w, init));
  }
  const dE = Math.abs((w.energy() - E0) / E0);
  check(`periodic ${orbit.name}`, best < 2e-3 && dE < 1e-6, `return err ${best.toExponential(2)}  dE/E ${dE.toExponential(2)}`);
}

// 2. Burrau's Pythagorean problem: body of mass 3 escapes, 4 and 5 form a binary.
{
  const w = new World({ rtol: 1e-13, atol: 1e-15, collisions: false, ejectFactor: 5 });
  const b3 = w.add({ name: 'm3', m: 3, x: [1, 3, 0], v: [0, 0, 0] });
  w.add({ name: 'm4', m: 4, x: [-2, -1, 0], v: [0, 0, 0] });
  w.add({ name: 'm5', m: 5, x: [1, -1, 0], v: [0, 0, 0] });
  const E0 = w.energy();
  let ejected = '';
  let tEject = 0;
  const t0 = performance.now();
  while (w.t < 100 && !ejected) {
    w.advance(0.05);
    for (const e of w.events) if (e.type === 'eject') { ejected = e.body.name; tEject = e.t; }
    w.events.length = 0;
  }
  const ms = performance.now() - t0;
  const dE = Math.abs((w.energy() - E0) / E0);
  check('pythagorean ejection', ejected === b3.name, `ejected=${ejected} at t=${tEject.toFixed(2)}  dE/E ${dE.toExponential(2)}  steps ${w.integratorStats.steps}  ${ms.toFixed(0)}ms`);
}

// 3. GW damping shrinks a black-hole binary until it merges.
{
  const w = new World({ c: 1.5, gw: 1, collisions: true });
  const m1 = 1, m2 = 0.7, a = 8, M = m1 + m2;
  const v = Math.sqrt(M / a);
  w.add({ kind: 'blackhole', name: 'A', m: m1, x: [(a * m2) / M, 0, 0], v: [0, (v * m2) / M, 0] });
  w.add({ kind: 'blackhole', name: 'B', m: m2, x: [(-a * m1) / M, 0, 0], v: [0, (-v * m1) / M, 0] });
  let merged = -1;
  while (w.t < 5000 && merged < 0) {
    w.advance(1);
    for (const e of w.events) if (e.type === 'merge') merged = e.t;
    w.events.length = 0;
  }
  const c5 = Math.pow(1.5, 5);
  const peters = (5 / 256) * Math.pow(a, 4) * c5 / (m1 * m2 * M);
  check('bbh inspiral merges', merged > 0 && Math.abs(merged - peters) / peters < 0.35, `merged at t=${merged.toFixed(1)} (Peters estimate ${peters.toFixed(1)}), final mass ${w.bodies[0]?.m.toFixed(3)}`);
}

// 4. Determinism: chaotic evolution must not depend on how time is sliced into frames
//    (a 60 fps export and an irregular live preview must tell the same story).
{
  const firstEvent = (dts: number[]) => {
    const w = randomChaos.build({ seed: 7 }).worlds[0];
    let i = 0;
    while (w.t < 120) {
      w.advance(dts[i++ % dts.length]);
      for (const e of w.events) if (e.type === 'merge' || e.type === 'eject') return `${e.type}@${e.t}`;
      w.events.length = 0;
    }
    return 'none';
  };
  const a = firstEvent([1 / 60]);
  const b = firstEvent([1 / 23, 1 / 71, 0.013]);
  check('frame-rate independence', a === b && a !== 'none', `${a} vs ${b}`);
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all physics checks passed');
