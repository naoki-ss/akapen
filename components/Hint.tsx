"use client";

import { useEffect, useState } from "react";
import styles from "./screens/screens.module.css";

// 初めて開いたときだけ出す1行の案内。画面ごとに一度だけ
export default function Hint({ id, text }: { id: string; text: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const key = `sekozu-hint-${id}`;
    if (!window.localStorage.getItem(key)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザに保存した値は描画の後でしか読めない
      setShown(true);
      window.localStorage.setItem(key, "1");
    }
  }, [id]);
  if (!shown) return null;
  return (
    <p className={styles.hint} role="note">
      {text}
      <button aria-label="案内を閉じる" onClick={() => setShown(false)}>
        ×
      </button>
    </p>
  );
}
