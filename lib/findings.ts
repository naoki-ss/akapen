// 指摘の見せ方。一覧・朱書き・根拠・3D で同じ番号と色を使う

import type { Finding } from "./check";
import { memberKey, type BuildingModel, type Member } from "./model";
import type { Box } from "./sheets";

export const INK_RED = "#C62D23";
export const INK_BLUE = "#1D5BB8";

export const isBlue = (finding: Finding) =>
  finding.source_type === "knowledge";

export const colorName = (finding: Finding) =>
  isBlue(finding) ? "blue" : "red";

export const inkOf = (finding: Finding) =>
  isBlue(finding) ? INK_BLUE : INK_RED;

// デモ用に固定した結果には番号がないので、並び順の番号を付ける
export const numbered = (findings: Finding[]) =>
  findings.map((finding, index) => ({
    ...finding,
    number: finding.number ?? index + 1,
  }));

export const regionsOf = (finding: Finding): Box[] =>
  finding.regions?.length ? finding.regions : [finding.drawing.bbox];

export const noteOf = (finding: Finding) =>
  (finding.comment || finding.title).replace(/^\[[^\]]+\]\s*/, "");

export function sourceLabel(finding: Finding) {
  if (finding.source_type === "minutes") return "議事録";
  if (finding.source_type === "knowledge") return "チェックリスト";
  return "設計図書";
}

// 本文から、末尾に足した根拠の文と定型の依頼を除く
const bodyOf = (finding: Finding) =>
  finding.content.replace(/（根拠：[\s\S]*$/, "").trim();

// 理由の一文。本文の最初の文を使う
export function reasonOf(finding: Finding) {
  const body = bodyOf(finding);
  const first = body.split(/(?<=。)/)[0]?.trim();
  return first || body;
}

export const detailOf = bodyOf;

function floorMembers(finding: Finding, model: BuildingModel) {
  const { floor } = finding.members;
  return floor ? model.members.filter((m) => m.floor === floor) : model.members;
}

const gridNames = (grid: string) => grid.split(/[/\-・、\s]+/).filter(Boolean);

// 指摘に対応する部材のキー。model_refs が今のモデルにないときは、符号と通り芯＋階で引く
export function memberKeysOf(finding: Finding, model: BuildingModel) {
  const known = new Set(model.members.map(memberKey));
  const direct = finding.model_refs.filter((ref) => known.has(ref));
  if (direct.length > 0) return direct;
  const candidates = floorMembers(finding, model);
  const marks = new Set(finding.members.marks);
  const grids = new Set(finding.members.grids.flatMap(gridNames));
  const touches = (m: Member) =>
    grids.size === 0 || gridNames(m.grid).some((name) => grids.has(name));
  const byMark = candidates.filter((m) => marks.has(m.mark) && touches(m));
  if (byMark.length > 0) return byMark.map(memberKey);
  if (grids.size === 0) return [];
  // 通り芯だけのときは、挙がった通りすべてに掛かる部材に絞る
  const byGrid = candidates.filter((m) =>
    gridNames(m.grid).every((name) => grids.has(name)),
  );
  return byGrid.map(memberKey);
}
