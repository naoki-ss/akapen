// 施工図チェックの結果の型。demo-data/sample-x/check-result.json に対応する

export type Severity = "高" | "中" | "低" | "要確認";

export type Evidence = {
  doc: string;
  page: number;
  where: string;
  text: string;
  bbox: [number, number, number, number];
  image: string;
  note?: string;
};

export type Finding = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  content: string;
  drawing: { doc: string; page: number; bbox: Evidence["bbox"] };
  members: { grids: string[]; marks: string[]; floor: string };
  model_refs: string[];
  source: "program" | "ai" | "program+ai";
  key_ids: string[];
  planted: boolean;
  evidence: Evidence[];
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
};

export const SOURCE_LABELS: Record<Finding["source"], string> = {
  program: "プログラム照合",
  ai: "Claude",
  "program+ai": "プログラム照合＋Claude",
};

// demo-data の画像は public/demo-data（シンボリックリンク）から配信する
export const demoImage = (path: string) => `/demo-data/sample-x/${path}`;
