"use client";

import { useCallback, useEffect, useState } from "react";

export const REMOVE_REASONS = [
  "矛盾ではない（表記だけ）",
  "誤検出",
  "対応済み",
  "その他",
] as const;

export type RemoveReason = { reason: string; note: string };

// 朱書きから消した指摘の番号。判定ジョブの結果はサーバーに残し、PDFにも反映する。
export function useDecisions(jobId: string | null) {
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (!jobId) return;
    let stale = false;
    void (async () => {
      const response = await fetch(`/api/check/${jobId}/decisions`);
      if (!stale && response.ok) {
        const body = (await response.json()) as { excluded: number[] };
        setExcluded(new Set(body.excluded));
      }
    })();
    return () => {
      stale = true;
    };
  }, [jobId]);

  const send = useCallback(
    (next: ReadonlySet<number>, why?: RemoveReason) => {
      if (!jobId) return;
      void fetch(`/api/check/${jobId}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excluded: [...next], ...why }),
      });
    },
    [jobId],
  );

  // 保存は state の更新の外で行う（開発時は更新の関数が2回呼ばれ、2回送ってしまう）
  const remove = useCallback(
    (number: number, why: RemoveReason) => {
      const next = new Set(excluded).add(number);
      setExcluded(next);
      send(next, why);
    },
    [excluded, send],
  );

  const restore = useCallback(
    (number: number) => {
      const next = new Set(excluded);
      next.delete(number);
      setExcluded(next);
      send(next);
    },
    [excluded, send],
  );

  return { excluded, remove, restore };
}
