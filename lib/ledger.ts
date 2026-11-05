// 図面台帳。台帳と入れたPDFはリポジトリの外に置く

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ROOT = path.join(homedir(), "sekozu-data", "ledger");
const INCOMING = /^[0-9a-f-]{36}$/;
const SLUG = /^[\w-]+$/;
const fromRoot = (...parts: string[]) =>
  path.join(/* turbopackIgnore: true */ process.cwd(), ...parts);
const script = () => fromRoot("scripts", "check", "drawing_ledger.py");
const python = () => fromRoot(".venv", "bin", "python");
const cwd = () => fromRoot("scripts", "check");

export type VersionChanges = {
  rows: { mark: string; before: string; after: string }[];
  marks: { mark: string; before: number; after: number }[];
};

export type LedgerVersion = {
  set: string;
  page: number;
  number: string;
  title: string;
  version: number;
  // 1つ前の版からの変化。図面の文字を比べた結果
  changes?: VersionChanges | null;
};

export type LedgerSheet = { id: string; title: string; versions: LedgerVersion[] };

export type LedgerSet = {
  id: string;
  label: string;
  date: string;
  pages: number;
  full: boolean;
  added_at: string;
};

export type Ledger = {
  sets: LedgerSet[];
  sheets: LedgerSheet[];
  // 台帳を作ったときの設定の設計図書の版。記録のない判定はこの版で照合したものとして扱う
  baseline?: string[];
  // 照合で使うページ
  checked?: string[];
};

export type ProposedPage = {
  page: number;
  title: string;
  number: string;
  how: string;
  sheet: string | null;
  candidate?: string | null;
  note: string;
};

export type Proposal = {
  pages: ProposedPage[];
  unread: number;
  ai_usd: number;
  model_usd: number;
  sheets: { id: string; title: string; versions: number }[];
};

export function readLedger(slug: string): Ledger {
  // 公開用の表示では、公開してよい物件の台帳だけを demo-data から読む
  const file = path.join(ROOT, slug, "ledger.json");
  const demo = fromRoot("demo-data", slug, "ledger.json");
  const found = [file, demo].find((item) => existsSync(item));
  return found
    ? JSON.parse(readFileSync(found, "utf8"))
    : { sets: [], sheets: [] };
}

function run(args: string[], input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      python(),
      [script(), ...args],
      { cwd: cwd(), maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const text = String(stderr).trim();
        // sys.exit の文だけを画面に出す。それ以外は図面の場所などが混ざるので出さない
        reject(
          new Error(
            text && !text.includes("Traceback")
              ? text
              : "図面台帳の処理に失敗しました",
          ),
        );
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

export const validIds = (slug: string, incoming?: string) =>
  SLUG.test(slug) && (incoming === undefined || INCOMING.test(incoming));

export async function receiveSet(slug: string, pdf: Buffer) {
  const id = randomUUID();
  const folder = path.join(ROOT, slug, "incoming");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, `${id}.pdf`), pdf);
  return { id, proposal: await proposeSet(slug, id) };
}

export const proposeSet = async (slug: string, id: string) =>
  JSON.parse(await run(["propose", slug, id])) as Proposal;

export const readTitles = (slug: string, id: string) =>
  run(["read-titles", slug, id]);

export const commitSet = (slug: string, id: string, payload: unknown) =>
  run(["commit", slug, id], JSON.stringify(payload));

// 照合したあとに新しくなった設計図書のページの図名。空なら再チェックは要らない
export function staleSheets(ledger: Ledger, jobSets?: string[]) {
  const used = jobSets?.length ? jobSets : ledger.baseline;
  if (!used?.length) return [];
  const known = new Set(ledger.checked ?? []);
  return ledger.sheets
    .filter(
      (sheet) =>
        known.has(sheet.id) &&
        !used.includes(sheet.versions[sheet.versions.length - 1].set),
    )
    .map((sheet) => sheet.title);
}

export type ModelStatus = {
  state: "running" | "done" | "stopped" | "error";
  message: string;
  done?: number;
  total?: number;
  seconds?: number;
};

export type ModelChanges = { added: string[]; removed: string[]; changed: string[] };

// 設計図書が新しくなったら、建物データと3Dを作り直す。読み取り済みのページは読み直さない
export function startModelUpdate(slug: string) {
  const folder = path.join(ROOT, slug);
  mkdirSync(folder, { recursive: true });
  const log = openSync(path.join(folder, "model-update.log"), "a");
  const child = spawn(python(), ["-u", fromRoot("scripts", "check", "update_model.py"), slug], {
    cwd: cwd(),
    detached: true,
    stdio: ["ignore", log, log],
  });
  writeFileSync(
    path.join(folder, "model-status.json"),
    JSON.stringify({ state: "running", message: "準備中です", pid: child.pid }),
  );
  child.unref();
}

export function stopModelUpdate(slug: string) {
  writeFileSync(path.join(ROOT, slug, "model-stop.flag"), "");
}

export function modelStatus(slug: string): {
  status: ModelStatus | null;
  changes: ModelChanges | null;
} {
  const read = (name: string) => {
    const file = path.join(ROOT, slug, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  };
  const status = read("model-status.json");
  if (status?.state === "running") {
    try {
      process.kill(status.pid, 0);
    } catch {
      status.state = "error";
      status.message = "建物データの更新が途中で止まりました。今の3Dはそのままです";
    }
  }
  return { status, changes: read("model-changes.json") };
}

// 新しい版から作り直した建物データ。なければ null
export function updatedModel(slug: string) {
  const file = path.join(ROOT, slug, "model.json");
  return SLUG.test(slug) && existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : null;
}
