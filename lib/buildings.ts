// 物件の一覧（サーバー側）。デモの2物件と、画面から登録した物件をまとめて扱う

import type { CheckResult } from "./check";
import { listJobs, uploadEnabled } from "./jobs";
import type { BuildingModel } from "./model";
import { listProjects, projectInfo } from "./projects";
import { thumbnailOf, type Thumbnail } from "./thumbnail";
import type { SheetIndex } from "./sheets";
import resultA from "@/demo-data/sample-x/check-result.json";
import modelA from "@/demo-data/sample-x/model.json";
import sheetsA from "@/demo-data/sample-x/sheets.json";
import resultB from "@/demo-data/sample-b/check-result.json";
import modelB from "@/demo-data/sample-b/model.json";
import sheetsB from "@/demo-data/sample-b/sheets.json";

export type ProjectSummary = {
  model_status: string;
  grids: string;
  levels: number;
  columns: number;
  beams: number;
  checks: { kind: string; result: string; message: string }[];
};

export type Building = {
  slug: string;
  model: BuildingModel;
  // デモ用に固定したチェック結果
  check?: CheckResult;
  sheets?: SheetIndex;
  // 画面から登録した物件の検算の結果
  summary?: ProjectSummary | null;
};

const DEMOS: Building[] = [
  {
    slug: "sample-x",
    model: modelA as BuildingModel,
    sheets: sheetsA as unknown as SheetIndex,
    check: resultA as CheckResult,
  },
  {
    slug: "sample-b",
    model: modelB as unknown as BuildingModel,
    sheets: sheetsB as unknown as SheetIndex,
    check: resultB as unknown as CheckResult,
  },
];

// 3Dを作れなかった物件。施工図チェックだけを使う
const emptyModel = (name: string): BuildingModel => ({
  name,
  source: "",
  grid_x: {},
  grid_y: {},
  levels: {},
  floors: ["1F"],
  members: [],
});

export function listBuildings(): Building[] {
  const registered = uploadEnabled() ? listProjects() : [];
  return [
    ...DEMOS,
    ...registered.map((project) => ({
      slug: project.slug,
      model: project.model
        ? { ...project.model, name: project.name }
        : emptyModel(project.name),
      summary: project.summary,
    })),
  ];
}

// 登録の情報にある建設地と向きを、3Dで使えるようにモデルに足す
export function getBuilding(slug: string) {
  const building = listBuildings().find((item) => item.slug === slug);
  if (!building) return null;
  const info = uploadEnabled() ? projectInfo(slug) : null;
  if (building.model.site || !info?.site) return building;
  return {
    ...building,
    model: {
      ...building.model,
      site: {
        lat: info.site.lat,
        lon: info.site.lon,
        north_deg: info.north_deg ?? 0,
      },
    },
  };
}

export type ProjectCard = {
  slug: string;
  name: string;
  use: string | null;
  structure: string | null;
  floors: number;
  updatedAt: string | null;
  red: number;
  blue: number;
  thumbnail: Thumbnail | null;
};

// ① の1枚分。未対応の数は、図面ごとの最新の結果だけで数える（同じ図面を何度もチェックしても増えない）
export function cardOf({ slug, model, check, sheets }: Building): ProjectCard {
  const enabled = uploadEnabled();
  const jobs = enabled ? listJobs(slug) : [];
  const info = enabled ? projectInfo(slug) : null;
  const latest = new Map<string, { at: string; red: number; blue: number }>();
  const put = (title: string, at: string, red: number, blue: number) => {
    const known = latest.get(title);
    if (!known || at >= known.at) latest.set(title, { at, red, blue });
  };
  // 固定の結果は、同じ図面の判定があればそちらを優先する（日時を空にして一番古い扱い）
  for (const sheet of sheets?.sheets ?? []) {
    const here = (check?.findings ?? []).filter(
      (f) => f.drawing.sheet === sheet.id,
    );
    if (here.length === 0) continue;
    const blue = here.filter((f) => f.source_type === "knowledge").length;
    put(sheet.title, "", here.length - blue, blue);
  }
  for (const job of jobs) {
    for (const page of job.open) {
      put(page.title, job.uploaded_at, page.red, page.blue);
    }
  }
  const counted = [...latest.values()];
  const dates = jobs.map((job) => job.uploaded_at).sort();
  return {
    slug,
    name: model.name,
    use: info?.use ?? null,
    structure:
      info?.structure ?? model.name.match(/(?:RC|SRC|S|W)造/)?.[0] ?? null,
    floors: (model.floors ?? Object.keys(model.levels)).filter((floor) =>
      /^\d+F$/.test(floor),
    ).length,
    updatedAt: dates.at(-1) ?? null,
    red: counted.reduce((sum, row) => sum + row.red, 0),
    blue: counted.reduce((sum, row) => sum + row.blue, 0),
    thumbnail: thumbnailOf(model),
  };
}
