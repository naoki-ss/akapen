// 図面台帳。台帳と入れたPDFはリポジトリの外に置く

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ROOT = path.join(homedir(), "sekozu-data", "ledger");
const INCOMING = /^[0-9a-f-]{36}$/;
const SLUG = /^[\w-]+$/;
const script = () => path.join(process.cwd(), "scripts", "check", "drawing_ledger.py");
const python = () => path.join(process.cwd(), ".venv", "bin", "python");
const cwd = () => path.join(process.cwd(), "scripts", "check");

export type LedgerVersion = {
  set: string;
  page: number;
  number: string;
  title: string;
  version: number;
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

export type Ledger = { sets: LedgerSet[]; sheets: LedgerSheet[] };

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
  sheets: { id: string; title: string; versions: number }[];
};

export function readLedger(slug: string): Ledger {
  // 公開用の表示では、公開してよい物件の台帳だけを demo-data から読む
  const file = path.join(ROOT, slug, "ledger.json");
  const demo = path.join(process.cwd(), "demo-data", slug, "ledger.json");
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
