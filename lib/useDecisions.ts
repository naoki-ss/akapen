"use client";

import { useCallback, useEffect, useState } from "react";

// 朱書きから外した指摘の番号。判定ジョブの結果はサーバーに残し、PDFにも反映する。
// デモ用に固定した結果（jobId が null）は、この画面の間だけ持つ
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

  const setKept = useCallback(
    (number: number, kept: boolean) => {
      setExcluded((current) => {
        const next = new Set(current);
        if (kept) next.delete(number);
        else next.add(number);
        if (jobId) {
          void fetch(`/api/check/${jobId}/decisions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ excluded: [...next] }),
          });
        }
        return next;
      });
    },
    [jobId],
  );

  return { excluded, setKept };
}
