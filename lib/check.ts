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
  // アップロードの判定：朱書きの番号、種類（設計図書／議事録／ナレッジ）、人の確認が必要か
  number?: number;
  source_type?: "design" | "minutes" | "knowledge";
  source_label?: string;
  needs_confirmation?: boolean;
  // ナレッジの指摘の根拠になったチェックリストの項目
  checklist_id?: string | null;
  // 議事録の指摘の根拠になった項目（番号と本文）
  minutes_refs?: { id: string; text: string }[] | null;
  // 朱書きの短い注記と、すべての枠
  comment?: string | null;
  // なぜ問題かの1文
  reason?: string | null;
  regions?: Box[];
  // 根拠カードで並べる値（設計図書または議事録で決まった値）と、根拠の資料
  sheet_value?: string | null;
  design_value?: string | null;
  sources?: { doc: string; page: string; where: string }[];
  // ④で施工図の隣に並べる根拠の資料
  design_refs?: DesignRef[];
  design_refs_more?: number;
  minutes_context?: MinutesBlock[];
  checklist_card?: ChecklistCard | null;
};

export type DesignRef = {
  doc: string;
  page: number;
  where: string;
  image: string;
  width: number;
  height: number;
  // 切り抜きに対する 0〜1 の枠。ページ全体を出すときはない
  box: Box | null;
  // ai：判定が返した位置、text：文面の符号や数値をPDFの文字から探した位置、page：見つからずページ全体
  // known：公開用に作った画像で、枠は画像に描いてある
  located: "ai" | "text" | "page" | "known";
  // 図面枠を塗りつぶせたか。false のものは公開用の表示に出さない
  masked: boolean;
};

export type MinutesBlock = {
  doc: string;
  heading: string;
  lines: {
    id: string;
    text: string;
    hit: boolean;
    // ファイルから作った議事録の出典
    source?: {
      file: string;
      page: number;
      url: string;
      // Word とテキストの、本文の該当箇所と前後の行
      excerpt?: { text: string; hit: boolean }[];
    };
  }[];
};

export type ChecklistCard = {
  checklist: string;
  id: string;
  section: string;
  item: string;
  lines: string[];
  note: string;
  // 元のファイル名とページ
  source?: { file: string; page: string } | null;
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

export const SOURCE_LABELS: Record<Finding["source"], string> = {
  program: "プログラム照合",
  ai: "Claude",
  "program+ai": "プログラム照合＋Claude",
};

// demo-data の画像は public/demo-data（シンボリックリンク）から配信する
export const demoBase = (slug: string) => `/demo-data/${slug}`;
