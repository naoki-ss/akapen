// 人が書き足した朱書きと、AI の指摘の文面の直し。施工図の版（判定の結果）ごとに markup.json に残す
// 担当者の名前は持たない

import type { Finding } from "./check";
import type { Box } from "./sheets";

export const SHAPES = ["arrow", "ellipse", "rect", "cloud", "text"] as const;
export type Shape = (typeof SHAPES)[number];
export type Ink = "red" | "blue";

export type ManualMark = {
  id: string;
  number: number;
  // sheets.json のページの id と、PDF のページ番号
  sheet: string;
  page: number;
  shape: Shape;
  color: Ink;
  // 0〜1。矢印は [始点x, 始点y, 終点x, 終点y]（向きを持つ）、ほかは左上と右下
  box: Box;
  title: string;
  comment: string;
  at: string;
};

export type Markup = {
  items: ManualMark[];
  // AI の指摘の番号 → 直した題名と文
  edits: Record<string, { title: string; comment: string }>;
};

export const EMPTY_MARKUP: Markup = { items: [], edits: {} };

export const MAX_TITLE = 40;
export const MAX_COMMENT = 200;

export const SHAPE_LABELS: Record<Shape, string> = {
  arrow: "矢印",
  ellipse: "丸",
  rect: "四角",
  cloud: "雲マーク",
  text: "テキスト",
};

const clamp01 = (v: unknown) => Math.min(1, Math.max(0, Number(v)));

// 送られてきた中身を確かめて形をそろえる。合わなければ null
export function cleanMarkup(raw: unknown): Markup | null {
  if (!raw || typeof raw !== "object") return null;
  const { items, edits } = raw as { items?: unknown; edits?: unknown };
  if (!Array.isArray(items) || (edits !== undefined && (typeof edits !== "object" || edits === null))) return null;
  const clean: ManualMark[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const m = item as Record<string, unknown>;
    if (
      typeof m.id !== "string" ||
      !/^m-[a-z0-9-]{1,40}$/.test(m.id) ||
      !Number.isInteger(m.number) ||
      typeof m.sheet !== "string" ||
      !Number.isInteger(m.page) ||
      !SHAPES.includes(m.shape as Shape) ||
      (m.color !== "red" && m.color !== "blue") ||
      !Array.isArray(m.box) ||
      m.box.length !== 4 ||
      !m.box.every((v) => Number.isFinite(Number(v)))
    ) {
      return null;
    }
    clean.push({
      id: m.id,
      number: m.number as number,
      sheet: m.sheet.slice(0, 40),
      page: m.page as number,
      shape: m.shape as Shape,
      color: m.color,
      box: (m.box as unknown[]).map((v) => Math.round(clamp01(v) * 10000) / 10000) as Box,
      title: String(m.title ?? "").slice(0, MAX_TITLE),
      comment: String(m.comment ?? "").slice(0, MAX_COMMENT),
      at: String(m.at ?? "").slice(0, 40),
    });
  }
  const cleanEdits: Markup["edits"] = {};
  for (const [key, value] of Object.entries((edits ?? {}) as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    cleanEdits[key] = {
      title: String(v.title ?? "").slice(0, MAX_TITLE * 2),
      comment: String(v.comment ?? "").slice(0, MAX_COMMENT),
    };
  }
  return { items: clean, edits: cleanEdits };
}

// 形の外枠（矢印は始点と終点を囲む）
export const boundsOf = ([x0, y0, x1, y1]: Box): Box => [
  Math.min(x0, x1),
  Math.min(y0, y1),
  Math.max(x0, x1),
  Math.max(y0, y1),
];

// 書き足した朱書きを、一覧・図面・比較で AI の指摘と同じに扱える形にする
export function manualFinding(mark: ManualMark): Finding & { number: number } {
  return {
    id: mark.id,
    number: mark.number,
    severity: "要確認",
    category: "手書き",
    title: mark.title || mark.comment.slice(0, 20) || "（題名なし）",
    content: mark.comment,
    comment: mark.comment || mark.title,
    reason: mark.comment || null,
    drawing: { doc: "施工図", page: mark.page, bbox: boundsOf(mark.box), sheet: mark.sheet },
    regions: [boundsOf(mark.box)],
    members: { grids: [], marks: [], floor: "" },
    model_refs: [],
    source: "program",
    key_ids: [],
    planted: false,
    evidence: [],
    manual: { shape: mark.shape, color: mark.color, box: mark.box },
  };
}

// AI の指摘に直した文面を当てる
export function applyEdit<T extends Finding & { number: number }>(finding: T, markup: Markup): T {
  const edit = markup.edits[String(finding.number)];
  if (!edit) return finding;
  return { ...finding, title: edit.title || finding.title, comment: edit.comment, reason: edit.comment || finding.reason, edited: true };
}
