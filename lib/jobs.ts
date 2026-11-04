// アップロードした施工図の判定ジョブ（サーバー側）。
// 図面と結果はリポジトリの外（~/sekozu-data/uploads/）にだけ置く

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const UPLOADS = path.join(homedir(), "sekozu-data", "uploads");
const PROJECTS = path.join(homedir(), "sekozu-data", "projects.json");
// ビルドツールにパスを追跡させない（.venv のシンボリックリンクで止まるため、実行時に組み立てる）
const fromRoot = (...parts: string[]) => [process.cwd(), ...parts].join(path.sep);
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 返してよいファイルだけを通す（図面の場所や生の応答は返さない）
const PUBLIC_FILE = /^(result\.json|(masked\/)?(marked\.pdf|pages\/p\d+(-(base|design|minutes|knowledge))?\.png|findings\/\d+\.png))$/;

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// API の費用が掛かるので、公開先のサーバーでは明示的に許可したときだけ動かす
export const uploadEnabled = () =>
  process.env.NODE_ENV === "development" ||
  process.env.SEKOZU_ENABLE_UPLOAD === "1";

export function jobFolder(id: string) {
  if (!JOB_ID.test(id)) return null;
  const folder = path.join(UPLOADS, id);
  return existsSync(folder) ? folder : null;
}

export function publicFile(folder: string, relative: string) {
  return PUBLIC_FILE.test(relative) ? path.join(folder, relative) : null;
}

export function isRegistered(slug: string) {
  if (!existsSync(PROJECTS)) return false;
  const projects = JSON.parse(readFileSync(PROJECTS, "utf8")) as object;
  return Object.keys(projects).includes(slug);
}

export function startJob(pdf: Buffer, project: string, originalName: string) {
  const id = randomUUID();
  const folder = path.join(UPLOADS, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "input.pdf"), pdf);
  writeFileSync(
    path.join(folder, "job.json"),
    JSON.stringify({ project, original_name: originalName }),
  );
  const log = openSync(path.join(folder, "run.log"), "a");
  const child = spawn(
    fromRoot(".venv", "bin", "python"),
    ["-u", fromRoot("scripts", "check", "check_upload.py"), folder],
    { cwd: fromRoot("scripts", "check"), detached: true, stdio: ["ignore", log, log] },
  );
  writeFileSync(
    path.join(folder, "status.json"),
    JSON.stringify({
      state: "running",
      stage: "準備中",
      message: "準備中です",
      pid: child.pid,
      pages_total: 0,
      pages_done: 0,
      active_pages: [],
      usd: 0,
      seconds: 0,
    }),
  );
  child.unref();
  return id;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function readStatus(folder: string) {
  const status = JSON.parse(readFileSync(path.join(folder, "status.json"), "utf8"));
  // 処理が落ちていたら、いつまでも「実行中」と見せない
  if (status.state === "running" && !alive(status.pid)) {
    return { ...status, state: "error", stage: "エラー", message: "チェックが途中で止まりました" };
  }
  // 状態が変わらない間も、経過時間は進める
  if (status.state === "running" && status.started_at) {
    return { ...status, seconds: (Date.now() - Date.parse(status.started_at)) / 1000 };
  }
  return status;
}
