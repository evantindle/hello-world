// Periodic three-body orbits (equal masses, G = m = 1).
// Initial conditions: x1 = (-1, 0), x2 = (1, 0), x3 = (0, 0); v1 = v2 = (p1, p2), v3 = -2 (p1, p2).
// Source: M. Šuvakov & V. Dmitrašinović, "Three Classes of Newtonian Three-Body Planar
// Periodic Orbits", Phys. Rev. Lett. 110, 114301 (2013); figure-eight from Chenciner & Montgomery.

export interface PeriodicOrbit {
  id: string;
  name: string;
  p: [number, number];
  T: number;
}

export const PERIODIC_ORBITS: PeriodicOrbit[] = [
  { id: 'figure8', name: 'Figure-Eight', p: [0.3471168881, 0.5327249454], T: 6.3259139829 },
  { id: 'butterfly1', name: 'Butterfly I', p: [0.306892758965492, 0.125506782829762], T: 6.23564136316479 },
  { id: 'butterfly2', name: 'Butterfly II', p: [0.392955223941802, 0.09757940298572], T: 7.00390738764014 },
  { id: 'bumblebee', name: 'Bumblebee', p: [0.184278506469727, 0.587188195800781], T: 63.5345412733264 },
  { id: 'moth1', name: 'Moth I', p: [0.464445237398184, 0.396059973403921], T: 14.8939113169584 },
  { id: 'moth2', name: 'Moth II', p: [0.439165939331987, 0.452967645644678], T: 28.6702783225658 },
  { id: 'butterfly3', name: 'Butterfly III', p: [0.405915588857606, 0.230163127422333], T: 13.8657626785699 },
  { id: 'moth3', name: 'Moth III', p: [0.383443534851074, 0.377363693237305], T: 25.8406180475758 },
  { id: 'goggles', name: 'Goggles', p: [0.083300079922268, 0.12788924367673], T: 10.4668176954385 },
  { id: 'butterfly4', name: 'Butterfly IV', p: [0.350112121391296, 0.079339649922676], T: 79.4758748952101 },
  { id: 'dragonfly', name: 'Dragonfly', p: [0.080584285736084, 0.588836087036133], T: 21.2709751966648 },
  { id: 'yarn', name: 'Yarn', p: [0.559064247131347, 0.349191558837891], T: 55.5017624421301 },
  { id: 'yinyang1a', name: 'Yin-Yang Ia', p: [0.513938054919243, 0.304736003875733], T: 17.3284256165559 },
  { id: 'yinyang1b', name: 'Yin-Yang Ib', p: [0.282698682308198, 0.327208786129952], T: 10.9625630756217 },
  { id: 'yinyang2a', name: 'Yin-Yang IIa', p: [0.416822143554688, 0.330333312988282], T: 55.7898127493819 },
  { id: 'yinyang2b', name: 'Yin-Yang IIb', p: [0.417342877101898, 0.313100116109848], T: 54.2075992141846 },
];

export function orbitById(id: string): PeriodicOrbit {
  const o = PERIODIC_ORBITS.find((p) => p.id === id);
  if (!o) throw new Error(`unknown orbit ${id}`);
  return o;
}
