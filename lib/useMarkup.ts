"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_MARKUP, type Markup } from "./markup";

const HISTORY = 50;

// 書き足した朱書きと文面の直しを読み、変えるたびにサーバーへ保存する。Ctrl+Z 用に前の状態を残す
export function useMarkup(jobId: string | null) {
  const [markup, setMarkup] = useState<Markup>(EMPTY_MARKUP);
  const history = useRef<Markup[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stale = false;
    void (async () => {
      const response = await fetch(`/api/check/${jobId}/markup`);
      if (!stale && response.ok) setMarkup((await response.json()) as Markup);
    })();
    return () => {
      stale = true;
    };
  }, [jobId]);

  const save = useCallback(
    (next: Markup) => {
      if (!jobId) return;
      void fetch(`/api/check/${jobId}/markup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).then((response) => setError(response.ok ? null : "朱書きを保存できませんでした"));
    },
    [jobId],
  );

  // 保存は state の更新の外で行う（開発時は更新の関数が2回呼ばれる）
  const update = useCallback(
    (change: (current: Markup) => Markup) => {
      const next = change(markup);
      if (next === markup) return;
      history.current = [...history.current.slice(-HISTORY + 1), markup];
      setCanUndo(true);
      setMarkup(next);
      save(next);
    },
    [markup, save],
  );

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return false;
    setCanUndo(history.current.length > 0);
    setMarkup(previous);
    save(previous);
    return true;
  }, [save]);

  return { markup, update, undo, canUndo, error };
}
