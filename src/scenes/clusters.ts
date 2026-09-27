// Many-body scenes: a star cluster released from rest collapses and rebounds like fireworks.

import { blackbody, hsv } from '../core/color.ts';
import { dist, type V3 } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { World } from '../physics/world.ts';
import type { SceneDef, SceneSetup } from './types.ts';

export const coldCollapse: SceneDef = {
  id: 'collapse',
  title: 'Cold Collapse',
  subtitle: '24 stars released from rest',
  blurb: 'Two dozen stars fall together, collide in a heartbeat, and burst outward like fireworks.',
  category: 'N-Body',
  seeded: true,
  build({ seed }): SceneSetup {
    const rng = new Rng(seed * 97 + 3);
    const w = new World({ collisions: false, closeFactor: 0, ejectFactor: 1e9, rtol: 1e-9, atol: 1e-11 });
    const N = 24;
    const R0 = 3;
    for (let i = 0; i < N; i++) {
      const d = rng.unitVector();
      const r = R0 * Math.cbrt(rng.next());
      const m = 0.5 + 1.5 * Math.pow(rng.next(), 2.5);
      // Heavier stars run hotter; a touch of hue keeps neighbouring trails apart.
      const T = 3200 + 9000 * Math.pow((m - 0.5) / 1.5, 0.7);
      const bb = blackbody(T);
      const tint = hsv(rng.next(), 0.55, 1);
      const color = bb.map((c, k) => c * 0.55 + tint[k] * 0.45) as V3;
      w.add({
        kind: 'star',
        name: `s${i}`,
        m,
        x: [d[0] * r, d[1] * r, d[2] * r * 0.6],
        v: [rng.normal() * 0.14, rng.normal() * 0.14, rng.normal() * 0.14],
        soft: 0.04,
        collide: 0,
        radius: 0.035 * Math.pow(m, 0.4),
        color,
        intensity: 0.7,
        spikes: m > 1.2 ? 0.5 : 0,
        trail: { fade: 1.1, maxAge: 4, width: 0.02, intensity: 1.3, core: 0.45 },
      });
    }
    w.centerOfMassFrame();
    let minR = Infinity;
    let bounced = false;
    let bounceAt = 0;
    let ended = false;
    return {
      worlds: [w],
      duration: 32,
      camera: { elevation: 28, orbitSpeed: 5, wobble: 6, margin: 1.15, holdTime: 1.5, zoomOut: 1.4, zoomIn: 0.6, minRadius: 1.2, maxRadius: 9, fov: 38 },
      director: { baseRate: 0.55, maxScreenSpeed: 0.9, minRate: 0.08, startHold: 2.2, easeIn: 1.2, outro: 7 },
      trailSpacing: 0.01,
      captions: [
        { at: 0.4, text: 'N-body', duration: 5, kind: 'kicker' },
        { at: 0.4, text: 'Cold Collapse', sub: '24 stars · released from rest', duration: 5, kind: 'title' },
        { on: 'bounce', delay: 0.6, text: 'Violent relaxation', sub: 'gravity trades energy between stars in a heartbeat', duration: 5, kind: 'caption' },
      ],
      onFrame: (rt) => {
        // RMS radius about the barycentre tracks the cloud's compression (the outermost star does not).
        const bc0 = w.barycenter();
        let s2 = 0;
        for (const b of w.bodies) s2 += b.m * ((b.x[0] - bc0.x[0]) ** 2 + (b.x[1] - bc0.x[1]) ** 2 + (b.x[2] - bc0.x[2]) ** 2);
        const R = Math.sqrt(s2 / bc0.m);
        if (!bounced) {
          minR = Math.min(minR, R);
          // Maximum compression: the cloud has shrunk a lot and is now expanding again.
          if (minR < R0 * 0.3 && R > minR * 1.3) {
            bounced = true;
            bounceAt = rt.clock;
            rt.markEvent('bounce');
            const c = w.barycenter().x;
            rt.vfx.flash(rt.clock, c, [1, 0.9, 0.8], minR * 0.6, 9, 1.2, 3, 1);
            rt.vfx.flash(rt.clock, c, [0.7, 0.8, 1], minR * 0.4, 2.2, 2.2, 10, 2);
            rt.vfx.shock(rt.clock, c, 14, 700, 2.2);
            rt.camera.addShake(0.5);
            rt.director.slowmo(rt.clock, 0.2, 0.9, 0.1, 1.8);
          }
        } else if (!ended && (R > 5 || rt.clock > bounceAt + 10)) {
          ended = true;
          const bc = w.barycenter();
          let bound = 0;
          for (const b of w.bodies) {
            const r = dist(b.x, bc.x);
            const v = Math.hypot(b.v[0] - bc.v[0], b.v[1] - bc.v[1], b.v[2] - bc.v[2]);
            if (0.5 * v * v - (w.G * bc.m) / Math.max(r, 1e-3) < 0) bound++;
          }
          rt.setup.captions!.push({
            at: rt.clock + 0.2,
            text: `${N - bound} stars escape`,
            sub: `${bound} stay bound in the core`,
            duration: 6,
            kind: 'caption',
          });
          rt.resolve('scatter');
        }
      },
    };
  },
};

export const CLUSTER_SCENES: SceneDef[] = [coldCollapse];
