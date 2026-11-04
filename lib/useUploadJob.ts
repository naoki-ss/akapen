"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckResult } from "./check";
import type { Sheet } from "./sheets";

const POLL_MS = 3000;

export type JobStatus = {
  state: "running" | "done" | "error" | "stopped";
  message: string;
  pages_total: number;
  pages_done: number;
  seconds: number;
};

// 判定するページを選んでいるPDF
export type PageThumb = { number: number; width: number; height: number };
export type Draft = { id: string; name: string; pages: PageThumb[] };

export type ResultRow = {
  id: string;
  item: string;
  content: string;
  result: string;
  pages: number[];
  reason: string;
};

export type JobResult = CheckResult & {
  sheets: Sheet[];
  // 塗りつぶした図面（masked/）があるか
  masked?: boolean;
  notes: string[];
  checklist?: ResultRow[] | null;
  minutes?: ResultRow[] | null;
  pages?: { number: number; title?: string | null }[];
  seconds: number;
};

export type JobSummary = {
  id: string;
  label?: string;
  pin?: number;
  uploaded_at: string;
  pages: { number: number; title?: string | null }[];
  counts: { design: number; minutes: number; knowledge: number };
  masked: boolean;
  stopped: boolean;
};

// 物件を切り替えて戻っても、走っているチェックを見失わないようにする
const storageKey = (slug: string) => `sekozu-job-${slug}`;

// 施工図を入れてチェックする流れ。onFinished は、この画面で始めたチェックが終わったときに呼ぶ
export function useUploadJob(
  slug: string,
  onFinished: (jobId: string) => void,
) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stopping, setStopping] = useState(false);
  // 過去の結果の一覧
  const [history, setHistory] = useState<JobSummary[]>([]);
  const startedHere = useRef(false);
  const finished = useRef(onFinished);

  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);

  const loadHistory = useCallback(async () => {
    const response = await fetch(
      `/api/check?project=${encodeURIComponent(slug)}`,
    );
    if (response.ok) setHistory((await response.json()).jobs);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 一覧はサーバーから読むまで分からない
    void loadHistory();
  }, [loadHistory]);

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
      const next = (await response.json()) as JobStatus;
      setStatus(next);
      if (next.state !== "running") setStopping(false);
      if (next.state === "stopped") {
        // 終わったページがないので、見せる結果がない
        window.localStorage.removeItem(storageKey(slug));
      } else if (next.state === "running") {
        // 読み込み直しても、走っている途中なら終わったときに結果へ進む
        startedHere.current = true;
        timer = setTimeout(poll, POLL_MS);
      } else if (next.state === "done") {
        // チェックが終わったら一覧に足す。開くのは、この画面で始めたチェックだけ
        void loadHistory();
        if (startedHere.current) {
          startedHere.current = false;
          finished.current(jobId);
        }
      }
    };
    let timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, slug, loadHistory]);

  // PDFを送り、ページの小さな画像を受け取る（AIは呼ばない）
  const prepare = useCallback(
    async (file: File) => {
      setSending(true);
      setError(null);
      setDraft(null);
      const form = new FormData();
      form.append("file", file);
      form.append("project", slug);
      const response = await fetch("/api/check", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      setSending(false);
      if (!response.ok) {
        setError(body.error);
        return;
      }
      setDraft({ id: body.id, name: file.name, pages: body.pages });
    },
    [slug],
  );

  // 選んだページの判定を始める
  const start = useCallback(
    async (pages: number[]) => {
      if (!draft) return;
      setSending(true);
      setError(null);
      const response = await fetch(`/api/check/${draft.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const body = await response.json();
      setSending(false);
      if (!response.ok) {
        setError(body.error);
        return;
      }
      setStatus(null);
      setDraft(null);
      window.localStorage.setItem(storageKey(slug), draft.id);
      startedHere.current = true;
      setJobId(draft.id);
    },
    [draft, slug],
  );

  const stop = useCallback(async () => {
    if (!jobId) return;
    setStopping(true);
    const response = await fetch(`/api/check/${jobId}/stop`, {
      method: "POST",
    });
    if (!response.ok) setStopping(false);
  }, [jobId]);

  const cancelDraft = useCallback(() => setDraft(null), []);

  return {
    status,
    error,
    history,
    draft,
    prepare,
    start,
    stop,
    stopping,
    cancelDraft,
    sending,
    running: status?.state === "running",
  };
}
