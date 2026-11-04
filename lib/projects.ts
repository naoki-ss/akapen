// 画面から登録した物件（サーバー側）。図面と建物データはリポジトリの外（~/sekozu-data/projects/）にだけ置く

import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const ROOT = path.join(homedir(), "sekozu-data", "projects");
const PROJECTS = path.join(homedir(), "sekozu-data", "projects.json");
const SLUG = /^p-[0-9a-f]{12}$/;
const fromRoot = (...parts: string[]) =>
  [process.cwd(), ...parts].join(path.sep);
const PYTHON = () => fromRoot(".venv", "bin", "python");
const SCRIPT = () => fromRoot("scripts", "check", "register_job.py");
const runFile = promisify(execFile);

type Stored = Record<
  string,
  { registered?: boolean; name?: string; masks?: number[][] }
>;

const readProjects = (): Stored =>
  existsSync(PROJECTS) ? JSON.parse(readFileSync(PROJECTS, "utf8")) : {};

export function projectFolder(slug: string) {
  if (!SLUG.test(slug)) return null;
  const folder = path.join(ROOT, slug);
  return existsSync(folder) ? folder : null;
}

const readJson = (file: string) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;

export function buildingSummary(folder: string) {
  const data = readJson(path.join(folder, "building.json"));
  if (!data) return null;
  return {
    model_status: data.model_status as string,
    grids: `${data.grids.x.length}×${data.grids.y.length}`,
    levels: data.levels.length as number,
    columns: data.columns.length as number,
    beams: data.beams.length as number,
    checks: data.checks as { kind: string; result: string; message: string }[],
  };
}

// 登録が終わった物件。3Dを作れなかった物件は model が null
export function listProjects() {
  return Object.entries(readProjects())
    .filter(([slug, entry]) => entry.registered && projectFolder(slug))
    .map(([slug, entry]) => {
      const folder = path.join(ROOT, slug);
      return {
        slug,
        name: entry.name as string,
        model: readJson(path.join(folder, "model.json")),
        summary: buildingSummary(folder),
      };
    });
}

// 塗りつぶす欄を借りられる物件（同じ図面枠のとき）。範囲の値は画面に返さない
export const maskChoices = () =>
  Object.entries(readProjects())
    .filter(([, entry]) => entry.masks)
    .map(([slug, entry]) => ({ slug, name: entry.name ?? slug }));

export type ProjectInput = {
  name: string;
  structure: string;
  masksFrom: string;
  design: File;
  revised: File | null;
  minutes: File[];
  architectural: File | null;
};

async function save(folder: string, name: string, file: File) {
  const target = path.join(folder, "inputs", name);
  writeFileSync(target, Buffer.from(await file.arrayBuffer()));
  return target;
}

// 図面を受け取り、ページの種類を文字で判定する。ここではAIを呼ばない
export async function createProject(input: ProjectInput) {
  const slug = `p-${randomBytes(6).toString("hex")}`;
  const folder = path.join(ROOT, slug);
  mkdirSync(path.join(folder, "inputs"), { recursive: true });
  const minutes: string[] = [];
  for (const [index, file] of input.minutes.entries()) {
    // 元のファイル名は使わない（拡張子だけ残す）
    const extension = path.extname(file.name).toLowerCase();
    minutes.push(await save(folder, `minutes-${index + 1}${extension}`, file));
  }
  const meta = {
    name: input.name,
    structure: input.structure,
    masks: readProjects()[input.masksFrom]?.masks ?? null,
    inputs: {
      design: await save(folder, "design.pdf", input.design),
      revised: input.revised
        ? await save(folder, "revised.pdf", input.revised)
        : null,
      minutes,
      architectural: input.architectural
        ? await save(folder, "architectural.pdf", input.architectural)
        : null,
    },
  };
  writeFileSync(path.join(folder, "meta.json"), JSON.stringify(meta));
  writeFileSync(
    path.join(folder, "status.json"),
    JSON.stringify({ state: "preparing" }),
  );
  try {
    const { stdout } = await runFile(PYTHON(), [SCRIPT(), "prepare", folder], {
      cwd: fromRoot("scripts", "check"),
      maxBuffer: 10 * 1024 * 1024,
    });
    writeFileSync(
      path.join(folder, "status.json"),
      JSON.stringify({ state: "ready" }),
    );
    return { slug, ...JSON.parse(stdout) };
  } catch {
    throw new Error("PDFを読み込めませんでした");
  }
}

// 読み取りを始める。AIの費用が掛かるのはここから
export function startProject(folder: string) {
  const status = readJson(path.join(folder, "status.json"));
  // 二度押しで二重に費用を掛けない。止めたあとは、読み終えたページを使い回して続きから読む
  if (!["ready", "stopped"].includes(status.state)) return false;
  rmSync(path.join(folder, "stop.flag"), { force: true });
  writeFileSync(
    path.join(folder, "status.json"),
    JSON.stringify({ state: "starting" }),
  );
  const log = openSync(path.join(folder, "run.log"), "a");
  const child = spawn(PYTHON(), ["-u", SCRIPT(), "run", folder], {
    cwd: fromRoot("scripts", "check"),
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  writeFileSync(
    path.join(folder, "status.json"),
    JSON.stringify({
      state: "running",
      stage: "読み取り",
      message: "準備中です",
      pid: child.pid,
      pages_total: 0,
      pages_done: 0,
    }),
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

export function projectStatus(folder: string) {
  const status = readJson(path.join(folder, "status.json"));
  if (status.state === "running" && !alive(status.pid)) {
    return {
      ...status,
      state: "error",
      message: "登録が途中で止まりました",
    };
  }
  return status.state === "done"
    ? { ...status, summary: buildingSummary(folder) }
    : status;
}

export function requestProjectStop(folder: string) {
  writeFileSync(path.join(folder, "stop.flag"), "");
}
