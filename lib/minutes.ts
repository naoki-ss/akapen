// 物件の議事録。物件ごとにリポジトリの外へ保存する

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ROOT = path.join(homedir(), "sekozu-data", "minutes");
const SLUG = /^[\w-]+$/;
const ID = /^[0-9a-f-]{32,36}$/;
// ビルドツールにパスを追跡させない（.venv のシンボリックリンクで止まるため、実行時に組み立てる）
const fromRoot = (...parts: string[]) =>
  path.join(/* turbopackIgnore: true */ process.cwd(), ...parts);
export const MAX_MINUTES_CHARS = 40000;
const MAX_TEXT = 2000;
const MAX_ROWS = 300;

export type Decision = {
  id: string;
  text: string;
  grids: string[];
  floors: string[];
  members: string[];
};

export type Todo = { id: string; text: string };

export type MinutesMethod = "音声" | "貼り付け";

export type Minutes = {
  id: string;
  date: string;
  title: string;
  method: MinutesMethod;
  transcript: string;
  decisions: Decision[];
  todos: Todo[];
};

export type MinutesSummary = Pick<Minutes, "id" | "date" | "title" | "method"> & {
  decisionCount: number;
};

export const validSlug = (slug: string) => SLUG.test(slug);

const file = (slug: string, id: string) => path.join(ROOT, slug, `${id}.json`);

export function listMinutes(slug: string): MinutesSummary[] {
  const folder = path.join(ROOT, slug);
  if (!SLUG.test(slug) || !existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(path.join(folder, name), "utf8")) as Minutes)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((row) => ({
      id: row.id,
      date: row.date,
      title: row.title,
      method: row.method,
      decisionCount: row.decisions.length,
    }));
}

export function readMinutes(slug: string, id: string): Minutes | null {
  if (!SLUG.test(slug) || !ID.test(id) || !existsSync(file(slug, id))) return null;
  return JSON.parse(readFileSync(file(slug, id), "utf8"));
}

const clean = (value: unknown, limit = MAX_TEXT) =>
  String(value ?? "").trim().slice(0, limit);
const cleanList = (value: unknown) =>
  (Array.isArray(value) ? value : []).map((item) => clean(item)).filter(Boolean);

// 画面から来た内容を確かめる。番号は保存のたびに付け直さず、なければ新しく付ける
export function cleanMinutes(raw: Partial<Minutes>): Omit<Minutes, "id"> | null {
  const title = clean(raw.title);
  const date = clean(raw.date, 10);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const decisions = (Array.isArray(raw.decisions) ? raw.decisions : [])
    .slice(0, MAX_ROWS)
    .filter((row) => clean(row.text));
  const todos = (Array.isArray(raw.todos) ? raw.todos : [])
    .slice(0, MAX_ROWS)
    .filter((row) => clean(row.text));
  const used = new Set(decisions.map((row) => row.id).filter(Boolean));
  let next = 1;
  const nextId = (prefix: string, known: Set<string>) => {
    while (known.has(`${prefix}${next}`)) next += 1;
    const id = `${prefix}${next}`;
    known.add(id);
    return id;
  };
  const cleanedDecisions = decisions.map((row) => ({
    id: clean(row.id, 40) || nextId("D", used),
    text: clean(row.text),
    grids: cleanList(row.grids),
    floors: cleanList(row.floors),
    members: cleanList(row.members),
  }));
  next = 1;
  const usedTodos = new Set(todos.map((row) => row.id).filter(Boolean));
  const cleanedTodos = todos.map((row) => ({
    id: clean(row.id, 40) || nextId("T", usedTodos),
    text: clean(row.text),
  }));
  return {
    title,
    date,
    method: raw.method === "音声" ? "音声" : "貼り付け",
    transcript: clean(raw.transcript, MAX_MINUTES_CHARS),
    decisions: cleanedDecisions,
    todos: cleanedTodos,
  };
}

export function saveMinutes(slug: string, id: string | null, body: Omit<Minutes, "id">) {
  const identifier = id ?? randomUUID().replace(/-/g, "");
  mkdirSync(path.join(ROOT, slug), { recursive: true });
  writeFileSync(
    file(slug, identifier),
    JSON.stringify({ id: identifier, ...body }, null, 1),
  );
  return identifier;
}

export function deleteMinutes(slug: string, id: string) {
  rmSync(file(slug, id), { force: true });
}

// 文章をClaudeで決定事項・宿題・対象部位に整理する
export function organizeMinutes(text: string) {
  return new Promise<{ title: string; decisions: Omit<Decision, "id">[]; todos: string[] }>(
    (resolve, reject) => {
      const child = execFile(
        fromRoot(".venv", "bin", "python"),
        [fromRoot("scripts", "check", "minutes_store.py"), "organize"],
        { cwd: fromRoot("scripts", "check"), maxBuffer: 10 * 1024 * 1024, timeout: 180000 },
        (error, stdout) => {
          // 最後の行が結果。その前は呼び出しの記録
          try {
            if (error) throw error;
            resolve(JSON.parse(stdout.trim().split("\n").at(-1) ?? ""));
          } catch {
            reject(new Error("議事録に整理できませんでした"));
          }
        },
      );
      child.stdin?.end(text);
    },
  );
}
