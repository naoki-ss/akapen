// 画面からのナレッジの追加。入れたファイルと項目はリポジトリの外に置く

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const IMPORTS = path.join(homedir(), "sekozu-data", "knowledge-imports");
const ADDED = path.join(homedir(), "sekozu-data", "knowledge", "added");
const MANUAL = path.join(ADDED, "manual.json");
const ID = /^[0-9a-f-]{36}$/;
const root = (...parts: string[]) => path.join(process.cwd(), ...parts);
const PYTHON = () => root(".venv", "bin", "python");
const SCRIPT = () => root("scripts", "check", "knowledge_import.py");
const runFile = promisify(execFile);

export const MAX_KNOWLEDGE_BYTES = 20 * 1024 * 1024;
export const KNOWLEDGE_TYPES = [".xlsx", ".xlsm", ".csv", ".pdf", ".txt", ".md"];
const MAX_ITEMS = 3000;
const MAX_TEXT = 2000;

export type KnowledgeItem = {
  section: string;
  item: string;
  checks: string[];
  criteria: string[];
  drawing_types: string[];
  note: string;
};

export type ImportEstimate = {
  chars: number;
  image_pages: number;
  batches: number;
  usd: number;
  usd_high: number;
};

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

function writeJsonSafely(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 1));
  renameSync(temporary, file);
}

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
  try {
    const { stdout } = await runFile(PYTHON(), [SCRIPT(), "prepare", folder], {
      cwd: root("scripts", "check"),
    });
    return { id, estimate: JSON.parse(stdout) as ImportEstimate };
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
    const known = stderr && !stderr.includes("Traceback");
    throw new Error(known ? stderr : "ファイルを読み込めませんでした");
  }
}

// AIでの整理を始める。費用が掛かるのはここから
export function startImport(folder: string) {
  const file = path.join(folder, "status.json");
  const status = readJson(file);
  // 二度押しで二重に費用を掛けない
  if (status.state !== "ready") return false;
  const log = openSync(path.join(folder, "run.log"), "a");
  const child = spawn(PYTHON(), ["-u", SCRIPT(), "run", folder], {
    cwd: root("scripts", "check"),
    detached: true,
    stdio: ["ignore", log, log],
  });
  writeFileSync(
    file,
    JSON.stringify({ ...status, state: "running", pid: child.pid }),
  );
  child.unref();
  return true;
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
  }));
  return items.every(
    (item) => item.item && item.checks.length && item.drawing_types.length,
  )
    ? items
    : null;
}

const numbered = (items: KnowledgeItem[], start = 1) =>
  items.map((item, index) => ({ no: start + index, ...item }));

// 確認画面で直した項目を登録する。これで判定に使われる
export function registerImport(id: string, name: string, items: KnowledgeItem[]) {
  writeJsonSafely(path.join(ADDED, `${id}.json`), {
    name: clean(name) || "追加したナレッジ",
    source: "file",
    added_at: new Date().toISOString(),
    items: numbered(items),
  });
}

// 1項目ずつの追加。1つのファイルに足していく
export function addManualItem(item: KnowledgeItem) {
  const known = existsSync(MANUAL) ? readJson(MANUAL).items : [];
  writeJsonSafely(MANUAL, {
    name: "1項目ずつ追加した項目",
    source: "form",
    added_at: new Date().toISOString(),
    items: [...known, ...numbered([item], known.length + 1)],
  });
}
