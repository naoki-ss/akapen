// アップロードした施工図の判定ジョブ（サーバー側）。
// 図面と結果はリポジトリの外（~/sekozu-data/uploads/）にだけ置く

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { readLedger, staleSheets } from "./ledger";

const UPLOADS = path.join(homedir(), "sekozu-data", "uploads");
const PROJECTS = path.join(homedir(), "sekozu-data", "projects.json");
// ビルドツールにパスを追跡させない（.venv のシンボリックリンクで止まるため、実行時に組み立てる）
const fromRoot = (...parts: string[]) =>
  [process.cwd(), ...parts].join(path.sep);
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 返してよいファイルだけを通す（図面の場所や生の応答は返さない）
const PUBLIC_FILE =
  /^(result\.json|thumbs\/p\d+\.png|(masked\/)?(marked\.pdf|pages\/p\d+(-(base|design|minutes|knowledge))?\.png|findings\/\d+\.png|design\/[\w-]+\.png))$/;

// 別のサイトから勝手に判定（API の費用）を走らせられないようにする
export function crossSite(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(
    origin && new URL(origin).host !== request.headers.get("host"),
  );
}

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

export type JobSummary = {
  id: string;
  // デモで見せる結果の名前と並び順（job.json の label と pin。手で書く）
  label?: string;
  pin?: number;
  uploaded_at: string;
  pages: { number: number; title?: string | null }[];
  counts: { design: number; minutes: number; knowledge: number };
  // 図面ごとの、朱書きから外した指摘を除いた赤と青の数
  open: { title: string; red: number; blue: number }[];
  masked: boolean;
  stopped: boolean;
  // 照合したあとに新しくなった設計図書のページの図名
  stale: string[];
};

// 物件の過去の結果。元のファイル名は社名が入ることがあるので返さない
export function listJobs(project: string): JobSummary[] {
  if (!existsSync(UPLOADS)) return [];
  const jobs: JobSummary[] = [];
  const ledger = readLedger(project);
  for (const id of readdirSync(UPLOADS)) {
    const folder = jobFolder(id);
    if (!folder || !existsSync(path.join(folder, "result.json"))) continue;
    const meta = JSON.parse(
      readFileSync(path.join(folder, "job.json"), "utf8"),
    );
    if (meta.project !== project) continue;
    const result = JSON.parse(
      readFileSync(path.join(folder, "result.json"), "utf8"),
    );
    const findings = result.findings as {
      source_type: keyof JobSummary["counts"];
    }[];
    const counts = { design: 0, minutes: 0, knowledge: 0 };
    for (const finding of findings) counts[finding.source_type] += 1;
    const excluded = new Set(readDecisions(folder));
    const open = (
      result.pages as { number: number; title?: string }[]
    ).map((page) => {
      const kept = (
        findings as unknown as {
          number?: number;
          source_type: string;
          drawing: { page: number };
        }[]
      ).filter(
        (finding) =>
          finding.drawing.page === page.number &&
          !excluded.has(finding.number ?? -1),
      );
      const blue = kept.filter((f) => f.source_type === "knowledge").length;
      return {
        title: page.title ?? `p.${page.number}`,
        red: kept.length - blue,
        blue,
      };
    });
    jobs.push({
      id,
      label: meta.label,
      pin: meta.pin,
      // input.pdf は入れたときに書いたまま。朱書きを作り直しても変わらない
      uploaded_at: statSync(path.join(folder, "input.pdf")).mtime.toISOString(),
      pages: result.pages.map((page: { number: number; title?: string }) => ({
        number: page.number,
        title: page.title,
      })),
      counts,
      open,
      masked: Boolean(result.masked),
      stopped: Boolean(result.stopped_pages?.length),
      stale: staleSheets(ledger, meta.design_sets),
    });
  }
  const rank = (job: JobSummary) => job.pin ?? Number.MAX_SAFE_INTEGER;
  return jobs.sort(
    (a, b) => rank(a) - rank(b) || b.uploaded_at.localeCompare(a.uploaded_at),
  );
}

// 判定の結果の、再チェックが必要な設計図書のページ
export function jobStale(project: string, id: string) {
  const folder = jobFolder(id);
  if (!folder) return [];
  const meta = JSON.parse(readFileSync(path.join(folder, "job.json"), "utf8"));
  return staleSheets(readLedger(project), meta.design_sets);
}

export function readDecisions(folder: string): number[] {
  const file = path.join(folder, "decisions.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).excluded : [];
}

// 朱書きから外した指摘の番号を残す
export function saveDecisions(folder: string, excluded: number[]) {
  writeFileSync(path.join(folder, "decisions.json"), JSON.stringify({ excluded }));
}

// 朱書きPDFのパス。外した指摘があれば、その分を除いて作り直す（AIは呼ばない）
export async function exportMarked(folder: string, isPublic: boolean) {
  const script = fromRoot("scripts", "check", "export_marked.py");
  const { stdout } = await runFile(
    PYTHON(),
    [script, folder, ...(isPublic ? ["--public"] : [])],
    { cwd: fromRoot("scripts", "check"), maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

export function publicFile(folder: string, relative: string) {
  return PUBLIC_FILE.test(relative) ? path.join(folder, relative) : null;
}

export function isRegistered(slug: string) {
  if (!existsSync(PROJECTS)) return false;
  const projects = JSON.parse(readFileSync(PROJECTS, "utf8")) as object;
  return Object.keys(projects).includes(slug);
}

const runFile = promisify(execFile);
const PYTHON = () => fromRoot(".venv", "bin", "python");

export type PageThumb = { number: number; width: number; height: number };

// PDFを受け取り、ページの小さな画像を作る。ここではAIを呼ばない（図面も社外に送らない）
export async function prepareJob(
  pdf: Buffer,
  project: string,
  originalName: string,
) {
  const id = randomUUID();
  const folder = path.join(UPLOADS, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "input.pdf"), pdf);
  writeFileSync(
    path.join(folder, "job.json"),
    JSON.stringify({ project, original_name: originalName }),
  );
  writeFileSync(
    path.join(folder, "status.json"),
    JSON.stringify({
      state: "selecting",
      message: "判定するページを選んでいます",
    }),
  );
  try {
    const { stdout } = await runFile(
      PYTHON(),
      [fromRoot("scripts", "check", "prepare_job.py"), folder],
      { cwd: fromRoot("scripts", "check") },
    );
    return { id, pages: JSON.parse(stdout).pages as PageThumb[] };
  } catch (error) {
    // sys.exit の文だけを画面に出す。それ以外は図面の場所などが混ざるので出さない
    const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
    const known = stderr && !stderr.includes("Traceback");
    throw new Error(known ? stderr : "PDFを読み込めませんでした");
  }
}

// 選んだページの判定を始める。AIの費用が掛かるのはここから
export function startJob(folder: string, pages: number[]) {
  const status = JSON.parse(
    readFileSync(path.join(folder, "status.json"), "utf8"),
  );
  // 二度押しで二重に費用を掛けない
  if (status.state !== "selecting") return false;
  const meta = JSON.parse(readFileSync(path.join(folder, "job.json"), "utf8"));
  writeFileSync(
    path.join(folder, "job.json"),
    JSON.stringify({ ...meta, pages }),
  );
  writeFileSync(
    path.join(folder, "status.json"),
    JSON.stringify({ state: "starting" }),
  );
  const log = openSync(path.join(folder, "run.log"), "a");
  const child = spawn(
    PYTHON(),
    ["-u", fromRoot("scripts", "check", "check_upload.py"), folder],
    {
      cwd: fromRoot("scripts", "check"),
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  writeFileSync(
    path.join(folder, "status.json"),
    JSON.stringify({
      state: "running",
      stage: "準備中",
      message: "準備中です",
      pid: child.pid,
      pages_total: pages.length,
      pages_done: 0,
      active_pages: [],
      usd: 0,
      seconds: 0,
    }),
  );
  child.unref();
  return true;
}

// 判定を止める。処理は1秒ごとにこのファイルを見て、終わったページの結果だけを残して終わる
export function requestStop(folder: string) {
  writeFileSync(path.join(folder, "stop.flag"), "");
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
  const status = JSON.parse(
    readFileSync(path.join(folder, "status.json"), "utf8"),
  );
  // 処理が落ちていたら、いつまでも「実行中」と見せない
  if (status.state === "running" && !alive(status.pid)) {
    return {
      ...status,
      state: "error",
      stage: "エラー",
      message: "チェックが途中で止まりました",
    };
  }
  // 状態が変わらない間も、経過時間は進める
  if (status.state === "running" && status.started_at) {
    return {
      ...status,
      seconds: (Date.now() - Date.parse(status.started_at)) / 1000,
    };
  }
  return status;
}
