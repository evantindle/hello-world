import { it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Game } from '../src/game/game';
import { FREE_RULES, V1_RULES } from '../src/game/ruleset';
import { perform, planGuide, planOracle, type Plan } from './agents';

/**
 * Balance runs: whole games played by headless agents.
 *   npm run balance                      (24 seeds, every agent)
 *   N=48 AGENTS=oracle,oracle+eng npm run balance
 */
type Agent = 'none' | 'random' | 'guide' | 'oracle' | 'oracle+eng';

function play(seed: number, agent: Agent) {
  const english = agent === 'oracle+eng';
  const g = new Game({ seed, rules: english ? FREE_RULES : V1_RULES });
  const rng = createRng(seed * 7 + 1);
  g.start();
  let guard = 0;
  let simT = 0;
  while (g.phase !== 'over' && guard++ < 400000) {
    g.update(1 / 60);
    if (g.phase === 'sim') simT += 1 / 60;
    if (g.phase !== 'plan' || g.charging) continue;
    let plan: Plan = { moves: [], power: rng.range(0.2, 1), ex: 0, ey: 0 };
    if (agent === 'random') {
      for (let k = 0; k < 3; k++) {
        const v = g.table.verts[rng.int(g.table.verts.length)]!;
        plan.moves.push([v.id, v.x + rng.range(-150, 150), v.y + rng.range(-150, 150)]);
      }
    } else if (agent === 'guide') plan = planGuide(g, rng, 12);
    else if (agent === 'oracle' || agent === 'oracle+eng') plan = planOracle(g, rng, 16, english);
    perform(g, plan);
  }
  return { score: g.score, pen: g.penalties, avgSim: simT / Math.max(1, g.shots) };
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `mean ${mean.toFixed(1)} med ${s[Math.floor(s.length / 2)]} [${s[0]}-${s[s.length - 1]}]`;
};

it('balance', () => {
  const n = Number(process.env['N'] ?? 24);
  const agents = (process.env['AGENTS'] ?? 'random,guide,oracle,oracle+eng').split(',') as Agent[];
  for (const agent of agents) {
    const t0 = performance.now();
    const rs = Array.from({ length: n }, (_, i) => play(i + 1, agent));
    const shots = rs.reduce((a, r) => a + r.score - r.pen, 0);
    const pens = rs.reduce((a, r) => a + r.pen, 0);
    console.log(
      agent.padEnd(10),
      'score',
      stats(rs.map((r) => r.score)),
      '| scratch%',
      ((100 * pens) / shots).toFixed(0),
      '| sim s/shot',
      (rs.reduce((a, r) => a + r.avgSim, 0) / rs.length).toFixed(2),
      `| ${((performance.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
});
