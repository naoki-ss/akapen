// 施工図チェックの結果の型。demo-data/*/check-result.json に対応する

import type { Box } from "./sheets";

export type Severity = "高" | "中" | "低" | "要確認";

export type Evidence = {
  doc: string;
  page: number;
  where: string;
  text: string;
  bbox: Box;
  image: string;
  note?: string;
};

// 同じ箇所の人の朱書き（物件B）
export type HumanView = {
  image: string;
  note: string;
};

export type Finding = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  content: string;
  // sheet は sheets.json のページ。施工図以外の図面が対象のときはない
  drawing: { doc: string; page: number; bbox: Box; sheet?: string };
  members: { grids: string[]; marks: string[]; floor: string };
  model_refs: string[];
  source: "program" | "ai" | "program+ai";
  key_ids: string[];
  planted: boolean;
  evidence: Evidence[];
  human_view?: HumanView;
  // アップロードの判定：朱書きの番号、種類（設計図書／議事録／ナレッジ）、人の確認が必要か
  number?: number;
  source_type?: "design" | "minutes" | "knowledge";
  source_label?: string;
  needs_confirmation?: boolean;
  // ナレッジの指摘の根拠になったチェックリストの項目
  checklist_id?: string | null;
  // 議事録の指摘の根拠になった項目（番号と本文）
  minutes_refs?: { id: string; text: string }[] | null;
};

export type OrderChange = {
  no: number;
  grid: string;
  mark: string;
  before: number;
  after: number;
};

export type CheckResult = {
  mode: string;
  findings: Finding[];
  changes: OrderChange[];
};

export type EvalReport = {
  detected: { id: string; title: string }[];
  missed: { id: string; title: string; needs_confirmation: boolean }[];
  required_total: number;
  traps: { id: string; title: string; passed: boolean }[];
  false_positives: { id: string; title: string }[];
};

// 同じ条件で繰り返した判定の集計
export type RunStats = {
  runs: number;
  detected: Record<string, number>;
  false_positives: number;
  traps_passed: boolean;
};

export type HumanItem = {
  id: string;
  drawing: string;
  note: string;
  summary: string;
  key_id: string | null;
  image?: string;
  // 物件B：同じ箇所に当たるAIの指摘と、同じ箇所の朱書き前の図面
  finding_ids?: string[];
  ai_image?: string;
  sheet?: string;
  bbox?: Box;
};

export const SOURCE_LABELS: Record<Finding["source"], string> = {
  program: "プログラム照合",
  ai: "Claude",
  "program+ai": "プログラム照合＋Claude",
};

// demo-data の画像は public/demo-data（シンボリックリンク）から配信する
export const demoBase = (slug: string) => `/demo-data/${slug}`;
