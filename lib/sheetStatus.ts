// 施工図の状態（提出／チェック中／チェックバック済み／確定）と版のつながり。判定のフォルダごとに記録する

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { jobFolder } from "./jobs";
import { readLedger, staleSheets } from "./ledger";
import { titleKey, type Sheet } from "./sheets";

const fromRoot = (...parts: string[]) =>
  path.join(/* turbopackIgnore: true */ process.cwd(), ...parts);
const UPLOADS = path.join(homedir(), "sekozu-data", "uploads");

export type SheetState = "提出" | "チェック中" | "チェックバック済み" | "確定";
// 記録には担当者の名前も残す。画面には出さないので、ここから先へは日時だけを渡す
export type Confirmation = { by: string; at: string };
export type ConfirmedAt = { at: string };

type StatusFile = {
  pages: Record<string, { checked_back_at?: string; confirmed?: Confirmation }>;
};

export type ShopVersion = {
  version: number;
  job: string;
  // 同じ内容を判定した結果の全部
  jobs: string[];
  page: number | null;
  uploaded_at: string;
  state: SheetState;
  confirmed?: ConfirmedAt;
  // 同じ内容を判定し直した回数
  rejudged: number;
  stale: string[];
  // 朱書きから消した指摘を除いた件数
  red: number;
  blue: number;
};

export type ShopSheet = { key: string; title: string; versions: ShopVersion[] };

export type ConfirmedSheet = {
  title: string;
  job: string;
  page: number;
  at: string;
  base: string;
  sheet: Sheet;
};

const statusPath = (folder: string) => path.join(folder, "sheet_status.json");

function readStatusFile(folder: string): StatusFile {
  const file = statusPath(folder);
  return existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { pages: {} };
}

// 確定したページの番号。書き換えを止めるのに使う
export function confirmedPages(folder: string) {
  const { pages } = readStatusFile(folder);
  return Object.entries(pages)
    .filter(([, value]) => value.confirmed)
    .map(([page, value]) => ({
      page: Number(page),
      at: (value.confirmed as Confirmation).at,
    }));
}

// チェックバック済みにする、または確定する。確定したページは変えられない
export function setSheetState(
  folder: string,
  page: number,
  state: "チェックバック済み" | "確定",
  by: string,
) {
  const result = JSON.parse(
    readFileSync(path.join(folder, "result.json"), "utf8"),
  );
  if (!result.pages.some((item: { number: number }) => item.number === page)) {
    throw new Error("このページの判定はありません");
  }
  const status = readStatusFile(folder);
  const current = status.pages[page] ?? {};
  if (current.confirmed) throw new Error("確定した図面は変更できません");
  const at = new Date().toISOString();
  if (state === "確定") {
    const name = by.trim().slice(0, 40);
    if (!name) throw new Error("担当者の名前を入れてください");
    status.pages[page] = { ...current, confirmed: { by: name, at } };
  } else {
    status.pages[page] = { ...current, checked_back_at: at };
  }
  writeFileSync(statusPath(folder), JSON.stringify(status, null, 1));
}

// 朱書きから外す指摘の変更のうち、確定したページの指摘に触れるものがあれば false
export function decisionsAllowed(
  folder: string,
  before: number[],
  after: number[],
) {
  const locked = new Set(confirmedPages(folder).map((item) => item.page));
  if (locked.size === 0) return true;
  const result = JSON.parse(
    readFileSync(path.join(folder, "result.json"), "utf8"),
  );
  const pageOf = new Map<number, number>(
    result.findings.map((f: { number: number; drawing: { page: number } }) => [
      f.number,
      f.drawing.page,
    ]),
  );
  const changed = [
    ...before.filter((number) => !after.includes(number)),
    ...after.filter((number) => !before.includes(number)),
  ];
  return !changed.some((number) => locked.has(pageOf.get(number) ?? -1));
}

// 版を見分ける値。ページの描画で比べる（同じ図面を別の切り出し方で入れても同じ版になる）
function pageHash(folder: string, page: number | null) {
  const file = path.join(folder, "page_hashes.json");
  if (!existsSync(file)) {
    execFileSync(
      fromRoot(".venv", "bin", "python"),
      [fromRoot("scripts", "check", "drawing_ledger.py"), "page-hashes", folder, "-"],
      { cwd: fromRoot("scripts", "check") },
    );
  }
  const hashes = JSON.parse(readFileSync(file, "utf8"));
  return page === null ? folder : hashes[page];
}

type Row = {
  job: string;
  page: number | null;
  title: string;
  hash: string;
  uploaded_at: string;
  state: SheetState;
  confirmed?: ConfirmedAt;
  stale: string[];
  red: number;
  blue: number;
};

function jobRows(project: string): Row[] {
  if (!existsSync(UPLOADS)) return [];
  const ledger = readLedger(project);
  const rows: Row[] = [];
  for (const id of readdirSync(UPLOADS)) {
    const folder = jobFolder(id);
    if (!folder || !existsSync(path.join(folder, "job.json"))) continue;
    const meta = JSON.parse(readFileSync(path.join(folder, "job.json"), "utf8"));
    if (meta.project !== project) continue;
    const base = {
      job: id,
      uploaded_at: statSync(path.join(folder, "input.pdf")).mtime.toISOString(),
    };
    const resultFile = path.join(folder, "result.json");
    if (!existsSync(resultFile)) {
      const { state } = JSON.parse(
        readFileSync(path.join(folder, "status.json"), "utf8"),
      );
      if (state === "error") continue;
      rows.push({
        ...base,
        hash: pageHash(folder, null),
        page: null,
        title: "判定の前の施工図",
        state: state === "selecting" ? "提出" : "チェック中",
        stale: [],
        red: 0,
        blue: 0,
      });
      continue;
    }
    const result = JSON.parse(readFileSync(resultFile, "utf8"));
    const { pages } = readStatusFile(folder);
    const decisions = path.join(folder, "decisions.json");
    const excluded = new Set<number>(
      existsSync(decisions) ? JSON.parse(readFileSync(decisions, "utf8")).excluded : [],
    );
    for (const page of result.pages as { number: number; title?: string }[]) {
      const status = pages[page.number] ?? {};
      const kept = (
        result.findings as { number: number; source_type: string; drawing: { page: number } }[]
      ).filter((f) => f.drawing.page === page.number && !excluded.has(f.number));
      const blue = kept.filter((f) => f.source_type === "knowledge").length;
      rows.push({
        red: kept.length - blue,
        blue,
        ...base,
        hash: pageHash(folder, page.number),
        page: page.number,
        title: page.title ?? `p.${page.number}`,
        state: status.confirmed
          ? "確定"
          : status.checked_back_at
            ? "チェックバック済み"
            : "チェック中",
        confirmed: status.confirmed ? { at: status.confirmed.at } : undefined,
        stale: staleSheets(ledger, meta.design_sets),
      });
    }
  }
  return rows;
}

// 施工図の一覧。図名ごとに、ページの内容の違いを版として束ねる。同じ内容の判定し直しは同じ版
export function shopSheets(project: string): ShopSheet[] {
  const groups = new Map<string, Row[]>();
  for (const row of jobRows(project)) {
    const key = titleKey(row.title);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    rows.sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
    const order = [...new Set(rows.map((row) => row.hash))];
    const versions = order.map((hash, index) => {
      const same = rows.filter((row) => row.hash === hash);
      // 確定したものがあればそれを、なければ最後の判定をその版の代表にする
      const chosen =
        same.find((row) => row.confirmed) ?? same[same.length - 1];
      return {
        version: index + 1,
        job: chosen.job,
        jobs: same.map((row) => row.job),
        page: chosen.page,
        uploaded_at: chosen.uploaded_at,
        state: chosen.state,
        confirmed: chosen.confirmed,
        rejudged: same.length - 1,
        stale: chosen.stale,
        red: chosen.red,
        blue: chosen.blue,
      };
    });
    return { key, title: rows[rows.length - 1].title, versions };
  });
}

// 確定版。図名ごとに新しいものを1つ。3Dの部材から開くときに優先する
export function confirmedSheets(project: string): ConfirmedSheet[] {
  const done: ConfirmedSheet[] = [];
  for (const sheet of shopSheets(project)) {
    const version = [...sheet.versions].reverse().find((item) => item.confirmed);
    if (!version?.confirmed || version.page === null) continue;
    const folder = jobFolder(version.job);
    if (!folder) continue;
    const result = JSON.parse(
      readFileSync(path.join(folder, "result.json"), "utf8"),
    );
    const found = (result.sheets as Sheet[]).find(
      (item) => item.page === version.page,
    );
    if (!found) continue;
    done.push({
      title: sheet.title,
      job: version.job,
      page: version.page,
      at: version.confirmed.at,
      base: `/api/check/${version.job}/files${result.masked ? "/masked" : ""}`,
      sheet: { ...found, title: sheet.title },
    });
  }
  return done;
}
