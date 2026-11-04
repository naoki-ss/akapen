"use client";

import { useEffect, useState } from "react";
import type { JobResult } from "./useUploadJob";

// 判定ジョブの結果を読む。id が null のとき（デモ用に固定した結果）は何もしない
export function useJobResult(id: string | null) {
  const [result, setResult] = useState<JobResult | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!id) return;
    let stale = false;
    void (async () => {
      const response = await fetch(`/api/check/${id}/files/result.json`);
      if (stale) return;
      if (response.ok) setResult((await response.json()) as JobResult);
      else setMissing(true);
    })();
    return () => {
      stale = true;
    };
  }, [id]);

  return { result, missing };
}
