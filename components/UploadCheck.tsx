"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckResult, Finding } from "@/lib/check";
import type { Box, Sheet } from "@/lib/sheets";
import { FindingCards } from "./CheckPanel";
import type { CompareTarget } from "./CompareViewer";
import styles from "./CheckPanel.module.css";

const POLL_MS = 3000;

type Status = {
  state: "running" | "done" | "error";
  message: string;
  pages_total: number;
  pages_done: number;
  usd: number;
  seconds: number;
};

type Result = CheckResult & {
  sheets: Sheet[];
  notes: string[];
  usd: number;
  seconds: number;
};

const minutes = (seconds: number) =>
  seconds < 60
    ? `${Math.round(seconds)} 秒`
    : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;

// 物件を切り替えて戻っても、走っている判定を見失わないようにする
const storageKey = (slug: string) => `sekozu-job-${slug}`;

export default function UploadCheck({
  slug,
  activeId,
  onActivate,
  onOpenSheet,
  onCompare,
}: {
  slug: string;
  activeId: string | null;
  onActivate: (finding: Finding | null) => void;
  onOpenSheet: (
    sheet: Sheet,
    bbox: Box,
    label: string,
    sheetBase?: string,
  ) => void;
  onCompare: (target: CompareTarget) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey(slug));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザに保存した値は描画の後でしか読めない
    if (saved) setJobId(saved);
  }, [slug]);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const base = `/api/check/${jobId}`;
    const poll = async () => {
      const response = await fetch(base);
      if (stopped) return;
      if (!response.ok) {
        window.localStorage.removeItem(storageKey(slug));
        setJobId(null);
        return;
      }
      const next = (await response.json()) as Status;
      setStatus(next);
      if (next.state === "running") {
        timer = setTimeout(poll, POLL_MS);
      } else if (next.state === "done") {
        const data = await fetch(`${base}/files/result.json`);
        if (!stopped) setResult((await data.json()) as Result);
      }
    };
    let timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, slug]);

  const send = useCallback(async () => {
    const file = input.current?.files?.[0];
    if (!file) {
      setError("PDFを選んでください");
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    setStatus(null);
    onActivate(null);
    const form = new FormData();
    form.append("file", file);
    form.append("project", slug);
    const response = await fetch("/api/check", { method: "POST", body: form });
    const body = await response.json();
    setSending(false);
    if (!response.ok) {
      setError(body.error);
      return;
    }
    window.localStorage.setItem(storageKey(slug), body.id);
    setJobId(body.id);
  }, [slug, onActivate]);

  const running = sending || status?.state === "running";
  const base = `/api/check/${jobId}/files`;
  const percent = status?.pages_total
    ? Math.round((status.pages_done / status.pages_total) * 100)
    : 0;

  return (
    <div className={styles.upload}>
      <h3>施工図PDFを判定して朱書きを返す</h3>
      <p className={styles.notice}>
        図面はClaude APIで処理されます。アップロードした図面と結果は、このサーバーのリポジトリの外に保存します。
      </p>
      <p className={styles.lead}>
        選択中の物件の設計図書（構造図・差替図面）と照らし合わせます。議事録とナレッジの照合はこれから追加します。1ページで数分、約1〜2ドル掛かります。
      </p>
      <input ref={input} type="file" accept="application/pdf,.pdf" disabled={running} aria-label="施工図PDF" />
      <button className={styles.openCompare} onClick={send} disabled={running}>
        判定を始める
      </button>
      {error && <p className={styles.uploadError}>{error}</p>}

      {status && (
        <div className={styles.progress} role="status">
          <b>{status.message}</b>
          {status.state === "running" && (
            <div className={styles.bar}>
              <div style={{ width: `${percent}%` }} />
            </div>
          )}
          <small>
            経過 {minutes(status.seconds)}・費用 {status.usd.toFixed(2)} ドル（定価換算）
          </small>
        </div>
      )}

      {result && status?.state === "done" && (
        <>
          <a className={styles.download} href={`${base}/marked.pdf`} download>
            朱書きPDFをダウンロード
          </a>
          <p className={styles.lead}>
            {result.mode} {minutes(result.seconds)}、{result.usd.toFixed(2)} ドル。
          </p>
          {result.notes.map((note) => (
            <p key={note} className={styles.notice}>
              {note}
            </p>
          ))}
          <FindingCards
            findings={result.findings}
            activeId={activeId}
            onActivate={onActivate}
            base={base}
            sheets={result.sheets}
            onOpenSheet={(sheet, bbox, label) =>
              onOpenSheet(sheet, bbox, label, base)
            }
            onCompare={onCompare}
          />
        </>
      )}
    </div>
  );
}
