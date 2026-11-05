"use client";

import { useEffect, useRef, useState } from "react";

const DURATION = 600;

// 件数を 0 から数え上げて見せる。件数が減ったときは今の値から動く。動きを減らす設定なら止める
export default function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = value;
      setShown(value);
      return;
    }
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - started) / DURATION);
      const eased = 1 - (1 - t) ** 3;
      current.current = Math.round(from + (value - from) * eased);
      setShown(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    // 描画が止まっていても（裏のタブなど）、途中の数のまま残さない
    const finish = setTimeout(() => {
      current.current = value;
      setShown(value);
    }, DURATION + 200);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(finish);
    };
  }, [value]);

  return <span aria-label={String(value)}>{shown}</span>;
}
