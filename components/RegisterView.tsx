"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "./App.module.css";

export type ProjectSummary = {
  model_status: string;
  grids: string;
  levels: number;
  columns: number;
  beams: number;
  checks: { kind: string; result: string; message: string }[];
};

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
  usd?: number;
  seconds?: number;
  summary?: ProjectSummary | null;
};

const STORAGE_KEY = "sekozu-register";
const POLL_MS = 2000;
const SOURCE_NAMES: Record<string, string> = { D1: "構造図", D2: "差替図面" };

const minutesText = (seconds: number) =>
  seconds < 60 ? "1分以内" : `約${Math.ceil(seconds / 60)}分`;

// 要確認と参考の一覧。登録の直後と、物件を選んだあとの両方で使う
export function ChecksList({ summary }: { summary: ProjectSummary }) {
  const need = summary.checks.filter((c) => c.result === "要確認");
  const notes = summary.checks.filter((c) => c.result !== "要確認");
  return (
    <div className={styles.checks}>
      <p>
        <b>{summary.model_status === "作成済み" ? "3D あり" : "3D なし"}</b>
        {summary.model_status === "作成済み"
          ? `：通り ${summary.grids}、階 ${summary.levels}、柱 ${summary.columns}、梁 ${summary.beams}`
          : "：図面から建物の形を作れませんでした。施工図チェックは使えます"}
      </p>
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

function FileField({
  label,
  name,
  note,
  required,
  multiple,
  accept = "application/pdf,.pdf",
}: {
  label: string;
  name: string;
  note?: string;
  required?: boolean;
  multiple?: boolean;
  accept?: string;
}) {
  return (
    <label className={styles.formRow}>
      <span>
        {label}
        {required ? "" : "（あれば）"}
      </span>
      <input
        type="file"
        name={name}
        accept={accept}
        required={required}
        multiple={multiple}
      />
      {note && <small>{note}</small>}
    </label>
  );
}

// 新しい物件の登録。図面を入れる → 読むページと見込みを確かめる → 読み取り → 要確認を見る
export default function RegisterView({
  maskChoices,
  onDone,
  onCancel,
}: {
  maskChoices: { slug: string; name: string }[];
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  // 走っている登録の進み具合を見に行くか
  const [watching, setWatching] = useState(false);

  const poll = (target: string) => {
    setWatching(true);
    setSlug(target);
    window.localStorage.setItem(STORAGE_KEY, target);
  };

  // 読み込み直しても、走っている登録を見失わない
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザに保存した値は描画の後でしか読めない
      setSlug(saved);
      setWatching(true);
    }
  }, []);

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    setName(String(form.get("name")));
    const response = await fetch("/api/projects", {
      method: "POST",
      body: form,
    });
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
    const response = await fetch(`/api/projects/${slug}/start`, {
      method: "POST",
    });
    setSending(false);
    if (!response.ok) {
      setError((await response.json()).error);
      return;
    }
    setStatus({ state: "running", message: "準備中です" });
    poll(slug);
  };

  const stop = async () => {
    if (!slug) return;
    setStopping(true);
    await fetch(`/api/projects/${slug}/stop`, { method: "POST" });
  };

  const backToForm = () => {
    setSlug(null);
    setPages(null);
    setEstimate(null);
    setStatus(null);
    setError(null);
  };

  let content;
  if (status?.state === "running") {
    const total = status.pages_total ?? 0;
    const percent = total
      ? Math.round(((status.pages_done ?? 0) / total) * 100)
      : 0;
    content = (
      <section className={styles.startStep}>
        <div className={styles.drop}>
          <div className={styles.progress} role="status">
            <b>{status.message}</b>
            <div className={styles.bar}>
              <div style={{ width: `${percent}%` }} />
            </div>
            <small>{status.stage}</small>
            <button
              className={styles.secondary}
              disabled={stopping}
              onClick={stop}
            >
              {stopping ? "止めています…" : "登録を止める"}
            </button>
            <small>
              止めても、読み終えたページは次に使い回します。画面を閉じても登録は止まりません。
            </small>
          </div>
        </div>
      </section>
    );
  } else if (status?.state === "done" && status.summary) {
    content = (
      <section className={styles.startStep}>
        <h2>{name ? `「${name}」を登録しました` : "登録しました"}</h2>
        <ChecksList summary={status.summary} />
        <div className={styles.dropActions}>
          <button className={styles.primary} onClick={() => onDone(name)}>
            この物件を開く
          </button>
          <small>
            {status.usd !== undefined &&
              `費用 ${status.usd.toFixed(2)} ドル・時間 ${Math.round(status.seconds ?? 0)} 秒`}
          </small>
        </div>
      </section>
    );
  } else if (status && ["stopped", "error"].includes(status.state)) {
    content = (
      <section className={styles.startStep}>
        <p className={status.state === "error" ? styles.error : undefined}>
          {status.message}
        </p>
        <div className={styles.dropActions}>
          {pages && status.state === "stopped" && (
            <button className={styles.primary} onClick={start}>
              続きから読む
            </button>
          )}
          <button className={styles.secondary} onClick={backToForm}>
            最初に戻る
          </button>
        </div>
      </section>
    );
  } else if (pages && estimate) {
    const count = (kind: string) =>
      pages.filter((p) => p.read && p.kind === kind).length;
    content = (
      <section className={`${styles.startStep} ${styles.grow}`}>
        <h2>読むページを確かめる</h2>
        <p className={styles.estimate}>
          全 {pages.length} ページのうち <b>{estimate.read} ページ</b>
          を読みます（伏図 {count("伏図")}、軸組図 {count("軸組図")}、リスト{" "}
          {count("リスト")}）。
          {estimate.reused > 0 &&
            `うち ${estimate.reused} ページは読み取り済みなので費用はかかりません。`}
          {estimate.unknown > 0 &&
            `種類が分からない ${estimate.unknown} ページは小さな画像で判定します。`}
          <br />
          <b>
            見込み {minutesText(estimate.seconds)}・
            {estimate.usd > 0 ? `約${estimate.usd}ドル` : "費用なし"}
          </b>
          {estimate.read === 0 &&
            "。3Dの材料になるページがないので、3Dなしで登録します"}
        </p>
        <div className={styles.pageTable}>
          <table>
            <thead>
              <tr>
                <th>図面</th>
                <th>ページ</th>
                <th>種類</th>
                <th>題名</th>
                <th>読むか</th>
              </tr>
            </thead>
            <tbody>
              {[...pages]
                .sort((a, b) => Number(b.read) - Number(a.read))
                .map((row) => (
                  <tr key={`${row.source}-${row.page}`} data-read={row.read}>
                    <td>{SOURCE_NAMES[row.source]}</td>
                    <td>{row.page}</td>
                    <td>{row.kind ?? "未判定"}</td>
                    <td>{row.title ?? ""}</td>
                    <td>
                      {row.read
                        ? "読む"
                        : row.replaced_by
                          ? `差替 p.${row.replaced_by.page} を読む`
                          : ""}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className={styles.dropActions}>
          <button className={styles.primary} disabled={sending} onClick={start}>
            読み取りを始める
          </button>
          <button className={styles.secondary} onClick={backToForm}>
            戻る
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </section>
    );
  } else {
    content = (
      <form className={styles.registerForm} onSubmit={submit}>
        <label className={styles.formRow}>
          <span>物件名</span>
          <input type="text" name="name" required maxLength={60} />
        </label>
        <label className={styles.formRow}>
          <span>構造</span>
          <select name="structure" defaultValue="S造">
            <option>S造</option>
            <option>RC造</option>
          </select>
        </label>
        <FileField
          label="構造図"
          name="design"
          required
          note="ページの種類を文字で判定し、必要なページだけを読みます"
        />
        <FileField
          label="差替図面"
          name="revised"
          note="同じ題名のページは差替図面を読みます"
        />
        <FileField
          label="議事録"
          name="minutes"
          multiple
          accept="application/pdf,.pdf,.md,.txt"
          note="施工図チェックの基準になります"
        />
        <FileField
          label="意匠図"
          name="architectural"
          note="保存します。外観の3Dに使うのはこれからです"
        />
        <label className={styles.formRow}>
          <span>名前の欄の塗りつぶし</span>
          <select name="masks_from" defaultValue="">
            <option value="">登録しない（公開用の図面を作りません）</option>
            {maskChoices.map((choice) => (
              <option key={choice.slug} value={choice.slug}>
                {choice.name} と同じ図面枠
              </option>
            ))}
          </select>
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.dropActions}>
          <button className={styles.primary} disabled={sending}>
            {sending ? "図面を読み込んでいます…" : "図面を読み込む"}
          </button>
          <button type="button" className={styles.secondary} onClick={onCancel}>
            やめる
          </button>
          <small>
            ここではAIを呼びません。次の画面で読むページと費用の見込みを確かめます。
          </small>
        </div>
      </form>
    );
  }

  return (
    <div className={styles.start}>
      <div className={styles.hero}>
        <h1>新しい物件を登録</h1>
        <p>
          設計図書から建物データと3Dを作り、施工図チェックの基準にします。3Dを作れなくても、施工図チェックは使えます。
        </p>
      </div>
      {content}
    </div>
  );
}
