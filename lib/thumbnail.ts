// ① のカードの下絵。3Dの画像（SceneThumb）ができるまでと、WebGL が使えないときに建物データから線を引く

import type { BuildingModel } from "./model";

export type Thumbnail = { viewBox: string; columns: string; beams: string };

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const project = (x: number, y: number, z: number): [number, number] => [
  (x - y) * COS,
  (x + y) * SIN - z,
];

export function thumbnailOf(model: BuildingModel): Thumbnail | null {
  const segments = { columns: [] as number[][], beams: [] as number[][] };
  for (const m of model.members) {
    if (m.type === "column") {
      segments.columns.push([...project(m.x, m.y, m.z0), ...project(m.x, m.y, m.z1)]);
    } else if (m.type === "beam") {
      segments.beams.push([
        ...project(m.x0, m.y0, m.z),
        ...project(m.x1, m.y1, m.z1 ?? m.z),
      ]);
    }
  }
  const all = [...segments.columns, ...segments.beams];
  if (all.length === 0) return null;
  const xs = all.flatMap((s) => [s[0], s[2]]);
  const ys = all.flatMap((s) => [s[1], s[3]]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const width = Math.max(...xs) - x0;
  const height = Math.max(...ys) - y0;
  const pad = Math.max(width, height) * 0.06;
  const path = (lines: number[][]) =>
    lines
      .map((s) => `M${s.slice(0, 2).map(Math.round).join(" ")}L${s.slice(2).map(Math.round).join(" ")}`)
      .join("");
  return {
    viewBox: [x0 - pad, y0 - pad, width + 2 * pad, height + 2 * pad]
      .map(Math.round)
      .join(" "),
    columns: path(segments.columns),
    beams: path(segments.beams),
  };
}
