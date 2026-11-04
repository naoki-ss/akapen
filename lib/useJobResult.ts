"use client";

import { useEffect, useState } from "react";
import type { JobResult } from "./useUploadJob";

// 判定ジョブの結果を読む。id が null のとき（デモ用に固定した結果）は何もしない
export function useJobResult(id: string | null) {
  const [loaded, setLoaded] = useState<{
    id: string;
    result: JobResult | null;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    let stale = false;
    void (async () => {
      const response = await fetch(`/api/check/${id}/files/result.json`);
      if (stale) return;
      setLoaded({
        id,
        result: response.ok ? ((await response.json()) as JobResult) : null,
      });
    })();
    return () => {
      stale = true;
    };
  }, [id]);

  const current = loaded?.id === id ? loaded : null;
  return { result: current?.result ?? null, missing: Boolean(current && !current.result) };
}
