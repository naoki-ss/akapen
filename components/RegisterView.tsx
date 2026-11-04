"use client";

import { useEffect, useState } from "react";
import type { ProjectSummary } from "@/lib/buildings";
import { PREFECTURES } from "@/lib/prefectures";
import Hint from "./Hint";
import styles from "./App.module.css";
import reg from "./screens/register.module.css";

type PageRow = {
  source: string;
  page: number;
  kind: string | null;
  title: string | null;
  read: boolean;
  replaced_by: { source: string; page: number } | null;
};

type Estimate = {
  read: number;
  new: number;
  reused: number;
  unknown: number;
  usd: number;
  seconds: number;
};

type Status = {
  state: "running" | "done" | "stopped" | "error";
  message: string;
  stage?: string;
  pages_total?: number;
  pages_done?: number;
  summary?: ProjectSummary | null;
};

type Kind = "構造図" | "差替図面" | "意匠図" | "議事録";
type Entry = { file: File; kind: Kind };

const KINDS: Kind[] = ["構造図", "差替図面", "意匠図", "議事録"];
const DIRECTIONS = [
  ["北", 0],
  ["北東", 45],
  ["東", 90],
  ["南東", 135],
  ["南", 180],
  ["南西", 225],
  ["西", 270],
  ["北西", 315],
] as const;
const STORAGE_KEY = "sekozu-register";
const POLL_MS = 2000;
const SOURCE_OF: Partial<Record<Kind, string>> = { 構造図: "D1", 差替図面: "D2" };

const minutesText = (seconds: number) =>
  seconds < 60 ? "1分以内" : `約${Math.ceil(seconds / 60)}分`;

// ファイル名から種類の見当を付ける。違っていれば画面で直せる
function guessKind(file: File, chosen: Entry[]): Kind {
  const name = file.name.toLowerCase();
  if (/\.(md|txt)$/.test(name) || /議事|minutes/.test(name)) return "議事録";
  if (/差替|差し替|shusho|revised/.test(name)) return "差替図面";
  if (/意匠|ishou|arch/.test(name)) return "意匠図";
  return chosen.some((entry) => entry.kind === "構造図") ? "差替図面" : "構造図";
}

// 要確認と参考の一覧。登録の直後と、物件を開いたあとの両方で使う
export function ChecksList({ summary }: { summary: ProjectSummary }) {
  const need = summary.checks.filter((c) => c.result === "要確認");
  const notes = summary.checks.filter((c) => c.result !== "要確認");
  return (
    <div className={styles.checks}>
      <h3>要確認 {need.length} 件</h3>
      {need.length === 0 ? (
        <p className={styles.fine}>検算で合わないところはありませんでした。</p>
      ) : (
        <ul>
          {need.map((check, index) => (
            <li key={index}>
              <b>{check.kind}</b> {check.message}
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <details>
          <summary>参考 {notes.length} 件</summary>
          <ul>
            {notes.map((check, index) => (
              <li key={index}>
                <b>{check.kind}</b> {check.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ② 基本情報と設計図書を入れ、目安を確かめて3Dをつくる
export default function RegisterView({
  maskChoices,
  watch,
  onDone,
  onCancel,
}: {
  maskChoices: { slug: string; name: string }[];
  // 一覧から開いたときの、読み取り中の物件
  watch?: string | null;
  onDone: (slug: string) => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [info, setInfo] = useState({
    name: "",
    use: "",
    structure: "S造",
    site: "",
    north: "0",
    masks: "",
  });
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [watching, setWatching] = useState(false);

  // 読み込み直しても、走っている登録を見失わない
  useEffect(() => {
    const saved = watch ?? window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザに保存した値は描画の後でしか読めない
      setSlug(saved);
      setWatching(true);
    }
  }, [watch]);

  useEffect(() => {
    if (!slug || !watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const response = await fetch(`/api/projects/${slug}`);
      if (stopped) return;
      if (!response.ok) {
        window.localStorage.removeItem(STORAGE_KEY);
        setSlug(null);
        setWatching(false);
        return;
      }
      const next = (await response.json()) as Status;
      setStatus(next);
      if (next.state === "running") {
        timer = setTimeout(tick, POLL_MS);
      } else {
        setStopping(false);
        setWatching(false);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [slug, watching]);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    // FileList は入力を空にすると一緒に空になるので、先に配列へ移す
    const added = Array.from(files);
    setEntries((current) => {
      const next = [...current];
      for (const file of added) next.push({ file, kind: guessKind(file, next) });
      return next;
    });
    setPages(null);
    setEstimate(null);
  };

  const countOf = (kind: Kind) =>
    entries.filter((entry) => entry.kind === kind).length;

  // 図面を送り、読むページと目安を受け取る。ここではAIを呼ばない
  const prepare = async () => {
    if (!info.name.trim()) {
      setError("名前を入れてください");
      return;
    }
    if (countOf("構造図") !== 1) {
      setError("構造図のPDFを1つ選んでください");
      return;
    }
    if (countOf("差替図面") > 1 || countOf("意匠図") > 1) {
      setError("差替図面と意匠図は1つずつにしてください");
      return;
    }
    setSending(true);
    setError(null);
    const form = new FormData();
    form.set("name", info.name.trim());
    form.set("use", info.use);
    form.set("structure", info.structure);
    form.set("site", info.site);
    form.set("north_deg", info.north);
    form.set("masks_from", info.masks);
    for (const { file, kind } of entries) {
      if (kind === "構造図") form.set("design", file);
      if (kind === "差替図面") form.set("revised", file);
      if (kind === "意匠図") form.set("architectural", file);
      if (kind === "議事録") form.append("minutes", file);
    }
    const response = await fetch("/api/projects", { method: "POST", body: form });
    const body = await response.json();
    setSending(false);
    if (!response.ok) {
      setError(body.error);
      return;
    }
    setSlug(body.slug);
    setPages(body.pages);
    setEstimate(body.estimate);
  };

  const start = async () => {
    if (!slug) return;
    setSending(true);
    const response = await fetch(`/api/projects/${slug}/start`, { method: "POST" });
    setSending(false);
    if (!response.ok) {
      setError((await response.json()).error);
      return;
    }
    setStatus({ state: "running", message: "準備中です" });
    setWatching(true);
    window.localStorage.setItem(STORAGE_KEY, slug);
  };

  const stop = async () => {
    if (!slug) return;
    setStopping(true);
    await fetch(`/api/projects/${slug}/stop`, { method: "POST" });
  };

  const reset = () => {
    setSlug(null);
    setPages(null);
    setEstimate(null);
    setStatus(null);
    setError(null);
  };

  const locked = Boolean(pages) || Boolean(status);
  const running = status?.state === "running";
  const done = status?.state === "done";
  const summary = status?.summary ?? null;
  const hasModel = summary?.model_status === "作成済み";

  // ファイルごとの読み取りの状態
  const fileState = (kind: Kind) => {
    if (done) return kind === "構造図" || kind === "差替図面" ? "読み取り済み" : "保存済み";
    if (running) return kind === "構造図" || kind === "差替図面" ? "読み取り中" : "保存済み";
    if (!pages) return "未読み込み";
    const source = SOURCE_OF[kind];
    if (!source) return kind === "議事録" ? "施工図チェックに使います" : "保存します（3Dには今は使いません）";
    const rows = pages.filter((page) => page.source === source);
    return `全 ${rows.length} ページ・読む ${rows.filter((row) => row.read).length} ページ`;
  };

  // 3段階のどこまで進んだか。読み取りの間は1、終わったら3
  const stageIndex = done
    ? 3
    : running
      ? status?.stage === "読み取り" || !status?.stage
        ? 0
        : 1
      : -1;
  const steps = [
    {
      title: "図面を読む",
      text: "必要なページだけをClaudeで読みます",
    },
    {
      title: "建物データにする",
      text: "図面の文字と突き合わせ、合わないところは「要確認」にします",
    },
    {
      title: "3Dを組み立てる",
      text: "建物データからプログラムで組み立てます",
    },
  ];
  const percent =
    running && status?.pages_total
      ? Math.round(((status.pages_done ?? 0) / status.pages_total) * 100)
      : 0;

  return (
    <div className={reg.layout}>
      <div className={reg.main}>
        <h1>新しい現場をつくる</h1>
        <Hint id="new" text="名前を入れて図面のPDFを置くと、読むページと目安が出ます。" />
        <section className={reg.section}>
          <fieldset disabled={locked} className={reg.fields}>
            <label>
              <span>名前</span>
              <input
                type="text"
                maxLength={60}
                value={info.name}
                onChange={(e) => setInfo({ ...info, name: e.target.value })}
              />
            </label>
            <label>
              <span>構造</span>
              <select
                value={info.structure}
                onChange={(e) => setInfo({ ...info, structure: e.target.value })}
              >
                <option>S造</option>
                <option>RC造</option>
              </select>
            </label>
            <details className={reg.more}>
              <summary>くわしい設定（用途、建設地、建物の向き、名前の塗りつぶし）</summary>
              <div className={reg.moreFields}>
            <label>
              <span>用途</span>
              <input
                type="text"
                maxLength={40}
                placeholder="事務所、共同住宅など"
                value={info.use}
                onChange={(e) => setInfo({ ...info, use: e.target.value })}
              />
            </label>
            <label>
              <span>建設地（日当たりの計算に使います）</span>
              <select
                value={info.site}
                onChange={(e) => setInfo({ ...info, site: e.target.value })}
              >
                <option value="">選ばない</option>
                {PREFECTURES.map((prefecture) => (
                  <option key={prefecture.label}>{prefecture.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>建物の向き（図面の上が向く方位）</span>
              <select
                value={info.north}
                onChange={(e) => setInfo({ ...info, north: e.target.value })}
              >
                {DIRECTIONS.map(([label, degree]) => (
                  <option key={degree} value={degree}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={reg.wide}>
              <span>名前の欄の塗りつぶし</span>
              <select
                value={info.masks}
                onChange={(e) => setInfo({ ...info, masks: e.target.value })}
              >
                <option value="">登録しない（公開用の図面を作りません）</option>
                {maskChoices.map((choice) => (
                  <option key={choice.slug} value={choice.slug}>
                    {choice.name} と同じ図面枠
                  </option>
                ))}
              </select>
            </label>
              </div>
            </details>
          </fieldset>
        </section>

        <section className={reg.section}>
          <h2>設計図書のPDF</h2>
          {!locked && (
            <label
              className={reg.drop}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              PDFをここに置く、またはクリックして選ぶ（議事録は md、txt も可）
              <input
                type="file"
                hidden
                multiple
                aria-label="設計図書のPDF"
                accept="application/pdf,.pdf,.md,.txt"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {entries.length > 0 && (
            <ul className={reg.files}>
              {entries.map((entry, index) => (
                <li key={`${entry.file.name}-${index}`}>
                  <span className={reg.fileName}>{entry.file.name}</span>
                  <select
                    aria-label={`${entry.file.name} の種類`}
                    disabled={locked}
                    value={entry.kind}
                    onChange={(e) =>
                      setEntries(
                        entries.map((item, i) =>
                          i === index
                            ? { ...item, kind: e.target.value as Kind }
                            : item,
                        ),
                      )
                    }
                  >
                    {KINDS.map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                  <small>{fileState(entry.kind)}</small>
                  {!locked && (
                    <button
                      aria-label={`${entry.file.name} を外す`}
                      onClick={() =>
                        setEntries(entries.filter((_, i) => i !== index))
                      }
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className={styles.error}>{error}</p>}
        {status?.state === "error" && (
          <p className={styles.error}>{status.message}</p>
        )}
        {status?.state === "stopped" && <p>{status.message}</p>}

        <div className={reg.actions}>
          {!locked && (
            <>
              <button
                className={styles.primary}
                disabled={sending}
                onClick={prepare}
              >
                {sending ? "図面を読み込んでいます…" : "図面を読み込む"}
              </button>
              <button className={styles.secondary} onClick={onCancel}>
                やめる
              </button>
              <small>ここではAIを呼びません。次に読むページと目安を確かめます。</small>
            </>
          )}
          {pages && estimate && !status && (
            <>
              <button
                className={styles.primary}
                disabled={sending}
                onClick={start}
              >
                この内容で3Dをつくる
              </button>
              <button className={styles.secondary} onClick={reset}>
                戻る
              </button>
            </>
          )}
          {running && (
            <button
              className={styles.secondary}
              disabled={stopping}
              onClick={stop}
            >
              {stopping ? "止めています…" : "登録を止める"}
            </button>
          )}
          {status?.state === "stopped" && pages && (
            <button className={styles.primary} onClick={start}>
              続きから読む
            </button>
          )}
          {(status?.state === "stopped" || status?.state === "error") && (
            <button className={styles.secondary} onClick={reset}>
              最初に戻る
            </button>
          )}
          {done && slug && (
            <button className={styles.primary} onClick={() => onDone(slug)}>
              {hasModel ? "3Dを開く" : "現場を開く"}
            </button>
          )}
        </div>
      </div>

      <aside className={reg.side}>
        <h2>3Dができるまで</h2>
        <ol className={reg.steps}>
          {steps.map((step, index) => (
            <li
              key={step.title}
              data-state={
                stageIndex > index
                  ? "done"
                  : stageIndex === index
                    ? "active"
                    : "todo"
              }
            >
              <i className="mono">{stageIndex > index ? "✓" : index + 1}</i>
              <span>
                <b>{step.title}</b>
                <small>{step.text}</small>
              </span>
            </li>
          ))}
        </ol>
        {running && (
          <div className={reg.running} role="status">
            <b>{status?.message}</b>
            <div className={styles.bar}>
              <div style={{ width: `${percent}%` }} />
            </div>
            <small>画面を閉じても登録は止まりません。止めても、読み終えたページは次に使い回します。</small>
          </div>
        )}
        {pages && estimate && !status && (
          <div className={reg.running}>
            <b>
              目安 {minutesText(estimate.seconds)}・
              {estimate.usd > 0 ? `約${estimate.usd}ドル` : "費用なし"}
            </b>
            <small>
              全 {pages.length} ページのうち {estimate.read} ページを読みます。
              {estimate.reused > 0 &&
                `うち ${estimate.reused} ページは読み取り済みです。`}
              {estimate.read === 0 &&
                "3Dの材料になるページがないので、3Dなしで登録します。"}
            </small>
          </div>
        )}
        {done && summary && (
          <div className={reg.result}>
            <h2>読み取れた概要</h2>
            {hasModel ? (
              <dl>
                <dt>通り</dt>
                <dd className="mono">{summary.grids}</dd>
                <dt>階</dt>
                <dd className="mono">{summary.levels}</dd>
                <dt>柱</dt>
                <dd className="mono">{summary.columns}</dd>
                <dt>梁</dt>
                <dd className="mono">{summary.beams}</dd>
              </dl>
            ) : (
              <p>3Dは作れませんでした（3Dなし）。施工図のチェックは使えます。</p>
            )}
            <ChecksList summary={summary} />
          </div>
        )}
      </aside>
    </div>
  );
}
