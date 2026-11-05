// ナレッジ。環境で共通で、物件に紐づけない。入れたファイルと項目はリポジトリの外に置く

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const IMPORTS = path.join(homedir(), "sekozu-data", "knowledge-imports");
const ID = /^[0-9a-f-]{36}$/;
const ITEM_ID = /^[\w\-ぁ-んァ-ヶ一-龠々・（）()、／ー]+$/;
// ビルドツールにパスを追跡させない（.venv のシンボリックリンクで止まるため、実行時に組み立てる）
const fromRoot = (...parts: string[]) =>
  path.join(/* turbopackIgnore: true */ process.cwd(), ...parts);
const PYTHON = () => fromRoot(".venv", "bin", "python");
const IMPORT_SCRIPT = () => fromRoot("scripts", "check", "knowledge_import.py");
const STORE_SCRIPT = () => fromRoot("scripts", "check", "knowledge_store.py");
const scriptsDir = () => fromRoot("scripts", "check");

export const MAX_KNOWLEDGE_BYTES = 20 * 1024 * 1024;
export const KNOWLEDGE_TYPES = [".xlsx", ".xlsm", ".csv", ".pdf", ".docx", ".txt", ".md"];
const MAX_ITEMS = 3000;
const MAX_TEXT = 2000;

export type KnowledgeItem = {
  section: string;
  item: string;
  checks: string[];
  criteria: string[];
  drawing_types: string[];
  note: string;
  drawing_checkable: boolean;
  source_page: string;
};

export type KnowledgeRow = {
  id: string;
  section: string;
  item: string;
  checks: string[];
  criteria: string[];
  note: string;
  drawing_checkable: boolean;
  drawing_types: string[];
  source: { file: string; page: string };
  added_at: string;
};

export type ImportEstimate = {
  chars: number;
  image_pages: number;
  batches: number;
  usd: number;
  usd_high: number;
};

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

function runStore(args: string[], input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      PYTHON(),
      [STORE_SCRIPT(), ...args],
      { cwd: scriptsDir(), maxBuffer: 50 * 1024 * 1024 },
      (error, stdout) =>
        error ? reject(new Error("ナレッジの処理に失敗しました")) : resolve(stdout),
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

export const listKnowledge = async () =>
  JSON.parse(await runStore(["list"])) as KnowledgeRow[];

export const addKnowledge = (sourceFile: string, items: KnowledgeItem[]) =>
  runStore(["add", sourceFile], JSON.stringify(items));

export const validItemId = (id: string) => ITEM_ID.test(id);

export const editKnowledge = (id: string, item: KnowledgeItem) =>
  runStore(["edit", id], JSON.stringify(item));

export const deleteKnowledge = (id: string) => runStore(["delete", id]);

export function importFolder(id: string) {
  if (!ID.test(id)) return null;
  const folder = path.join(IMPORTS, id);
  return existsSync(folder) ? folder : null;
}

// ファイルを受け取り、文字を取り出して費用の見込みを返す。ここではAIを呼ばない
export async function prepareImport(data: Buffer, originalName: string) {
  const id = randomUUID();
  const folder = path.join(IMPORTS, id);
  mkdirSync(folder, { recursive: true });
  const extension = path.extname(originalName).toLowerCase();
  writeFileSync(path.join(folder, `source${extension}`), data);
  writeFileSync(
    path.join(folder, "meta.json"),
    JSON.stringify({ original_name: path.basename(originalName) }),
  );
  return new Promise<{ id: string; estimate: ImportEstimate }>((resolve, reject) => {
    execFile(
      PYTHON(),
      [IMPORT_SCRIPT(), "prepare", folder],
      { cwd: scriptsDir() },
      (error, stdout, stderr) => {
        if (!error) return resolve({ id, estimate: JSON.parse(stdout) });
        const text = String(stderr).trim();
        reject(
          new Error(
            text && !text.includes("Traceback")
              ? text
              : "ファイルを読み込めませんでした",
          ),
        );
      },
    );
  });
}

// AIでの整理を始める。費用が掛かるのはここから
export function startImport(folder: string) {
  const file = path.join(folder, "status.json");
  const status = readJson(file);
  // 二度押しで二重に費用を掛けない
  if (status.state !== "ready") return false;
  const log = openSync(path.join(folder, "run.log"), "a");
  const child = spawn(PYTHON(), ["-u", IMPORT_SCRIPT(), "run", folder], {
    cwd: scriptsDir(),
    detached: true,
    stdio: ["ignore", log, log],
  });
  writeFileSync(
    file,
    JSON.stringify({
      ...status,
      state: "running",
      pid: child.pid,
      started_at: new Date().toISOString(),
    }),
  );
  child.unref();
  return true;
}

// 整理を止める。登録はされないので、費用はそこまでの分だけ
export function stopImport(folder: string) {
  const file = path.join(folder, "status.json");
  const status = readJson(file);
  if (status.state !== "running") return;
  try {
    process.kill(status.pid);
  } catch {
    // すでに終わっている
  }
  writeFileSync(file, JSON.stringify({ ...status, state: "stopped" }));
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function importStatus(folder: string) {
  const status = readJson(path.join(folder, "status.json"));
  const stopped = status.state === "running" && !alive(status.pid);
  const draft = path.join(folder, "draft.json");
  return {
    state: stopped ? "error" : status.state,
    estimate: status.estimate as ImportEstimate,
    draft:
      status.state === "done" && existsSync(draft) ? readJson(draft) : null,
  };
}

export const importSourceName = (folder: string) =>
  String(readJson(path.join(folder, "meta.json")).original_name);

const clean = (value: unknown) => String(value ?? "").trim().slice(0, MAX_TEXT);
const cleanList = (value: unknown) =>
  (Array.isArray(value) ? value : []).map(clean).filter(Boolean);

// 画面から来た項目を確かめる。チェック項目、確認すること、対象の図面の種類は必須
export function cleanItems(value: unknown): KnowledgeItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) {
    return null;
  }
  const items = value.map((raw: Partial<KnowledgeItem>) => ({
    section: clean(raw.section),
    item: clean(raw.item),
    checks: cleanList(raw.checks),
    criteria: cleanList(raw.criteria),
    drawing_types: cleanList(raw.drawing_types),
    note: clean(raw.note),
    drawing_checkable: raw.drawing_checkable !== false,
    source_page: clean(raw.source_page),
  }));
  return items.every(
    (item) => item.item && item.checks.length && item.drawing_types.length,
  )
    ? items
    : null;
}
