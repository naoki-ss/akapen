"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckResult } from "./check";
import type { Sheet } from "./sheets";

const POLL_MS = 3000;

export type JobStatus = {
  state: "running" | "done" | "error";
  message: string;
  pages_total: number;
  pages_done: number;
  seconds: number;
};

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

// 物件を切り替えて戻っても、走っているチェックを見失わないようにする
const storageKey = (slug: string) => `sekozu-job-${slug}`;

// 施工図を入れてチェックする流れ。onFinished は、この画面で始めたチェックが終わったときに呼ぶ
export function useUploadJob(slug: string, onFinished: () => void) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const startedHere = useRef(false);
  const finished = useRef(onFinished);

  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);

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
      if (next.state === "running") {
        // 読み込み直しても、走っている途中なら終わったときに結果へ進む
        startedHere.current = true;
        timer = setTimeout(poll, POLL_MS);
      } else if (next.state === "done") {
        const data = await fetch(`${base}/files/result.json`);
        const body = (await data.json()) as JobResult;
        if (stopped) return;
        setResult(body);
        if (startedHere.current) {
          startedHere.current = false;
          finished.current();
        }
      }
    };
    let timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, slug]);

  const send = useCallback(
    async (file: File) => {
      setSending(true);
      setError(null);
      setResult(null);
      setStatus(null);
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
      startedHere.current = true;
      setJobId(body.id);
    },
    [slug],
  );

  return {
    status,
    result,
    error,
    send,
    running: sending || status?.state === "running",
    base: `/api/check/${jobId}/files`,
  };
}
