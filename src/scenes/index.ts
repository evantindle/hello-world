import { BLACK_HOLE_SCENES } from './blackholes.ts';
import { CLUSTER_SCENES } from './clusters.ts';
import { GALAXY_SCENES } from './galaxies.ts';
import { THREE_BODY_SCENES } from './threebody.ts';
import type { SceneDef } from './types.ts';

export const SCENES: SceneDef[] = [...THREE_BODY_SCENES, ...CLUSTER_SCENES, ...BLACK_HOLE_SCENES, ...GALAXY_SCENES];

export function sceneById(id: string | null | undefined): SceneDef {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}
