// 物件の一覧（サーバー側）。デモの本社屋と、画面から登録した物件をまとめて扱う

import { readFileSync } from "node:fs";
import path from "node:path";
import type { CheckResult, Finding } from "./check";
import { isBlue, numbered } from "./findings";
import { jobFolder, listJobs, readDecisions, uploadEnabled } from "./jobs";
import type { BuildingModel } from "./model";
import { listProjects, projectInfo } from "./projects";
import { thumbnailOf, type Thumbnail } from "./thumbnail";
import type { SheetIndex } from "./sheets";
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
  const site =
    building.model.site ??
    (info?.site
      ? { lat: info.site.lat, lon: info.site.lon, north_deg: info.north_deg ?? 0 }
      : undefined);
  return {
    ...building,
    model: { ...building.model, site, structure: info?.structure },
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

// 図面ごとの最新の結果。同じ図面を何度もチェックしても、一番新しい結果だけを使う（朱書きから消した指摘は除く）。
// 固定の結果は、同じ図面の判定があればそちらを優先する。③の一覧と①の件数は、どちらもここから数える
export type DrawingResult = {
  title: string;
  job: string;
  findings: (Finding & { number: number })[];
  // 照合したあとに新しくなった設計図書のページ
  stale: string[];
};

export function drawingResults({ slug, check, sheets }: Building): DrawingResult[] {
  const latest = new Map<string, DrawingResult & { at: string }>();
  const fixed = numbered(check?.findings ?? []);
  for (const sheet of sheets?.sheets ?? []) {
    const here = fixed.filter((f) => f.drawing.sheet === sheet.id);
    if (here.length > 0) {
      latest.set(sheet.title, { title: sheet.title, job: "saved", findings: here, stale: [], at: "" });
    }
  }
  if (uploadEnabled()) {
    for (const job of listJobs(slug)) {
      const folder = jobFolder(job.id);
      if (!folder) continue;
      const result = JSON.parse(readFileSync(path.join(folder, "result.json"), "utf8"));
      const excluded = new Set(readDecisions(folder));
      for (const page of job.pages) {
        const title = page.title ?? `p.${page.number}`;
        const known = latest.get(title);
        if (known && known.at > job.uploaded_at) continue;
        const findings = numbered(result.findings as Finding[]).filter(
          (f) => f.drawing.page === page.number && !excluded.has(f.number),
        );
        latest.set(title, { title, job: job.id, findings, stale: job.stale, at: job.uploaded_at });
      }
    }
  }
  return [...latest.values()].map((item) => ({
    title: item.title,
    job: item.job,
    findings: item.findings,
    stale: item.stale,
  }));
}

// ① の1枚分
export function cardOf(building: Building): ProjectCard {
  const { slug, model } = building;
  const enabled = uploadEnabled();
  const jobs = enabled ? listJobs(slug) : [];
  const info = enabled ? projectInfo(slug) : null;
  const all = drawingResults(building).flatMap((item) => item.findings);
  const blue = all.filter(isBlue).length;
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
    red: all.length - blue,
    blue,
    thumbnail: thumbnailOf(model),
  };
}
